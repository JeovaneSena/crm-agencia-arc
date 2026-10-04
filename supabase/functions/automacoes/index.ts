import { rpc, selecionar } from '../_shared/db.ts'
import { processarAutomacoes, type ContextoAutomacao, type DepsAutomacoes, type RegraAutomacao } from '../_shared/automacoes.ts'
import { modelosMeta, enviarModelo, metaConfigurada } from '../_shared/meta-api.ts'
import { UAZAPI } from '../_shared/uazapi.ts'
const deps: DepsAutomacoes = {
 reivindicar: () => rpc('automacao_reivindicar', { p_limite: 10 }),
 async contexto(e) {
 const regras = await selecionar<RegraAutomacao>(`automacao_regras?id=eq.${e.regra_id}`)
 const marketing = regras[0]?.canal === 'meta' ? await selecionar<{ativo:boolean}>(`marketing_consentimentos?select=ativo&contato_id=eq.${e.contato_id}&limit=1`) : []
 const contatos = await selecionar<{nome: string | null; whatsapp: string}>(`contatos_dados?select=nome,whatsapp&id=eq.${e.contato_id}`)
 const config = await selecionar<{fuso_horario: string}>('configuracoes_negocio?select=fuso_horario&limit=1')
 const msgs = await selecionar<{conteudo: string | null}>(`mensagens_whatsapp?select=conteudo&contato_id=eq.${e.contato_id}&autor=eq.cliente&order=criada_em.desc&limit=1`)
 const assunto = e.reuniao_id ? (await selecionar<{assunto: string}>(`reunioes?select=assunto&id=eq.${e.reuniao_id}`))[0]?.assunto
 : (await selecionar<{nome: string}>(`oportunidades?select=nome&id=eq.${e.oportunidade_id}`))[0]?.nome
 if (!regras[0] || !contatos[0] || !assunto) throw Error('Contato ou compromisso não encontrado.')
 return { regra: regras[0], numero: contatos[0].whatsapp, nome: contatos[0].nome, assunto, fuso: config[0]?.fuso_horario ?? 'America/Sao_Paulo', ultimaMensagem: msgs[0]?.conteudo ?? null, marketingAutorizado: marketing[0]?.ativo === true } satisfies ContextoAutomacao
 },
 modelos: async () => { if (!metaConfigurada()) throw Error('Configure a Meta nesta instalação.'); return await modelosMeta() },
 bloquear: (id) => rpc('automacao_bloquear', {p_contato:id,p_marketing:false}),
 marcar: (e,c,p) => rpc('automacao_marcar_chamada', {p_id:e.id,p_token:e.token,p_texto:p.texto,p_numero:c.numero,p_regra:c.regra,p_marketing:p.marketing}),
 async enviar(e,c,p) {
 if (c.regra.canal === 'uazapi') { if (!UAZAPI.configurada()) throw Error('Configure a uazapi.'); return await UAZAPI.enviarTexto(c.numero,p.texto) }
 const r = await enviarModelo(c.numero,c.regra.modelo_nome!,c.regra.modelo_idioma,p.componentes,e.id); return r.id
 },
 finalizar: (e,estado,externo,erro) => rpc('automacao_finalizar', {p_id:e.id,p_token:e.token,p_estado:estado,p_externo:externo,p_erro:erro}),
}
export async function handler(req: Request): Promise<Response> {
 const segredo=Deno.env.get('AUTOMACOES_SEGREDO') ?? ''
 if(req.method!=='POST' || segredo.length<24 || req.headers.get('authorization')!==`Bearer ${segredo}`) return Response.json({ok:false,motivo:'nao_autorizado'},{status:401})
 const rota=new URL(req.url).pathname.replace(/^\/(?:functions\/v1\/)?automacoes/,'').replace(/\/+$/,'')
 if(rota!=='/processar') return Response.json({ok:false,motivo:'rota_desconhecida'},{status:404})
 try { const resultado=await processarAutomacoes(deps); return Response.json({ok:true,...resultado},{status:resultado.erros.length ? 500 : 200}) }
 catch { return Response.json({ok:false,motivo:'erro_interno'},{status:500}) }
}
if(import.meta.main) Deno.serve(handler)
