import { classificarOptOut } from './optout.ts'
import { preencherModelo, type ModeloMeta } from './meta-protocolo.ts'
export interface RegraAutomacao {
 id: string; nome: string; tipo: 'lembrete' | 'followup'; ativa: boolean; canal: 'uazapi' | 'meta';
 minutos: number; etapa: string | null; texto: string; modelo_nome: string | null; modelo_idioma: string;
 parametros: Record<string, string[]>; created_at: string;
}
export interface EnvioAutomacao { id: string; token: string; regra_id: string; contato_id: string; reuniao_id: string | null; oportunidade_id: string | null; referencia_em: string }
export interface ContextoAutomacao { regra: RegraAutomacao; numero: string; nome: string | null; assunto: string; fuso: string; ultimaMensagem: string | null; marketingAutorizado?: boolean }
export function preencherAutomacao(texto: string, valores: Record<string, string>): string {
 const pronto = texto.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k: string) => {
 const valor = valores[k.toLowerCase()]
 if (valor === undefined || !valor.trim()) throw Error('Confira o texto e as variáveis da regra.')
 return valor
 })
 if (/\{\{|\}\}/.test(pronto) || !pronto.trim() || pronto.length > 4000) throw Error('Confira o texto e as variáveis da regra.')
 return pronto
}
export function prepararAutomacao(e: EnvioAutomacao, c: ContextoAutomacao, modelos: ModeloMeta[]) {
 if (classificarOptOut(c.ultimaMensagem) !== 'nenhum') throw Error('O contato pediu para parar ou precisa de revisão.')
 const data = new Date(e.referencia_em)
 const valores = { nome: c.nome?.trim() ?? '', primeiro_nome: c.nome?.trim().split(/\s+/)[0] ?? '', assunto: c.assunto,
 dia: data.toLocaleDateString('pt-BR', { timeZone: c.fuso }), hora: data.toLocaleTimeString('pt-BR', { timeZone: c.fuso, hour: '2-digit', minute: '2-digit' }) }
 if (c.regra.canal === 'uazapi') return { texto: preencherAutomacao(c.regra.texto, valores), componentes: [], marketing: false }
 const modelo = modelos.find(m => m.name === c.regra.modelo_nome && m.language === c.regra.modelo_idioma)
 if (!modelo || modelo.status !== 'APPROVED' || (c.regra.tipo === 'lembrete' && modelo.category !== 'UTILITY')) throw Error('O modelo precisa estar aprovado; lembretes exigem categoria UTILITY.')
 if (modelo.category === 'MARKETING' && !c.marketingAutorizado) throw Error('Modelo MARKETING exige consentimento de campanhas ativo.')
 const params = Object.fromEntries(Object.entries(c.regra.parametros).map(([k, itens]) => {
 if (!Array.isArray(itens)) throw Error('Parâmetros inválidos.')
 return [k, itens.map(v => preencherAutomacao(v, valores))]
 }))
 const pronto = preencherModelo(modelo, params)
 return { texto: pronto.texto, componentes: pronto.components, marketing: modelo.category === 'MARKETING' }
}
export interface DepsAutomacoes {
 reivindicar(): Promise<EnvioAutomacao[]>;
 contexto(e: EnvioAutomacao): Promise<ContextoAutomacao>;
 modelos(): Promise<ModeloMeta[]>;
 bloquear(contato: string): Promise<void>;
 marcar(e: EnvioAutomacao, c: ContextoAutomacao, p: ReturnType<typeof prepararAutomacao>): Promise<string | null>;
 enviar(e: EnvioAutomacao, c: ContextoAutomacao, p: ReturnType<typeof prepararAutomacao>): Promise<string | null>;
 finalizar(e: EnvioAutomacao, estado: 'enviado' | 'falhou' | 'incerto' | 'cancelado', externo: string | null, erro: string | null): Promise<void>;
}
export async function processarAutomacoes(d: DepsAutomacoes) {
 let enviados = 0, falhas = 0, cancelados = 0
 const erros: string[] = []
 for (const e of await d.reivindicar()) {
 let iniciou = false
 try {
 const c = await d.contexto(e)
 if (classificarOptOut(c.ultimaMensagem) !== 'nenhum') {
 await d.bloquear(e.contato_id); await d.finalizar(e, 'cancelado', null, 'Pedido de parada.'); cancelados++; continue
 }
 const pronto = prepararAutomacao(e, c, c.regra.canal === 'meta' ? await d.modelos() : [])
 if (!await d.marcar(e, c, pronto)) { cancelados++; continue }
 iniciou = true
 const externo = await d.enviar(e, c, pronto)
 if (!externo) throw Error('O provedor não confirmou o identificador da mensagem.')
 await d.finalizar(e, 'enviado', externo, null); enviados++
 } catch (err) {
 falhas++
 // Qualquer erro depois do início do HTTP é incerto. Jamais repetir automaticamente.
 try { await d.finalizar(e, iniciou ? 'incerto' : 'falhou', null, err instanceof Error ? err.message : 'Falha no envio.') }
 catch { erros.push(e.id) } // Lease vencido será recuperado como incerto; resposta do worker sinaliza falha.
 }
 }
 return { enviados, falhas, cancelados, erros }
}
