/**
 * Função do módulo CAMPANHAS: a ponte com a API oficial da Meta. A tela lê e configura direto no banco (com
 * RLS); aqui ficam só as coisas que precisam de segredo ou da Meta.
 *
 * Rotas (prefixo `/functions/v1/campanhas`):
 *   GET  /webhook?hub.*          verificação do webhook pela Meta
 *   POST /webhook                recibos (enviado/entregue/lido/falhou) e mensagens recebidas, assinados (x-hub-signature-256)
 *   GET  /modelos                só gestor: modelos aprovados de MARKETING, com o que impede cada um de ser usado
 *   GET  /modelos/todos          só gestor: todos os modelos da conta (qualquer categoria e estado), com o motivo de reprovação
 *   POST /modelos                só gestor: cria um modelo na Meta (texto, variáveis, rodapé, respostas rápidas); fica em análise
 *   POST /modelos/apagar         só gestor: apaga um modelo pelo nome (recusa se uma campanha em aberto o usa)
 *   GET  /conta                  só gestor: o número da Meta (nome, qualidade, limite), sem nenhuma chave
 *   POST /processar              o trabalhador (Authorization: Bearer CAMPANHAS_WORKER_SECRET): envia um lote da fila
 *
 * Secrets: META_ACCESS_TOKEN, META_APP_SECRET, META_VERIFY_TOKEN, META_PHONE_NUMBER_ID, META_WABA_ID,
 * META_GRAPH_VERSION (ex.: v21.0) e CAMPANHAS_WORKER_SECRET.
 */
import { inserir, rpc, selecionar } from '../_shared/db.ts'
import { usuarioDaSessao } from '../_shared/sessao.ts'
import { apagarModeloMeta, criarModeloMeta, enviarModelo, ErroMeta, estadoDoNumero, metaConfig, metaConfigurada, modelosMeta } from '../_shared/meta-api.ts'
import { assinaturaValida, descreverModeloCampanha, descreverModeloGestao, montarCriacaoDeModelo, type EntradaDeModelo } from '../_shared/meta-protocolo.ts'
import { processarLote, tratarWebhook, type DepsCampanhas, type DepsWebhook } from '../_shared/campanhas.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = new URL(req.url)
  const rota = url.pathname.replace(/^\/(?:functions\/v1\/)?campanhas/, '').replace(/\/+$/, '')
  try {
    if (rota === '/webhook' && req.method === 'GET') return verificarWebhook(url)
    if (rota === '/webhook' && req.method === 'POST') return await receberWebhook(req)
    if (rota === '/modelos' && req.method === 'GET') return await rotaModelos(req)
    if (rota === '/modelos/todos' && req.method === 'GET') return await rotaModelosTodos(req)
    if (rota === '/modelos' && req.method === 'POST') return await rotaCriarModelo(req)
    if (rota === '/modelos/apagar' && req.method === 'POST') return await rotaApagarModelo(req)
    if (rota === '/conta' && req.method === 'GET') return await rotaConta(req)
    if (rota === '/processar' && req.method === 'POST') return await rotaProcessar(req)
    return json({ ok: false, motivo: 'rota_desconhecida' }, 404)
  } catch (e) {
    console.error('campanhas: erro na entrada:', e instanceof Error ? e.message.slice(0, 160) : 'erro')
    return json({ ok: false, motivo: 'erro_interno' }, 500)
  }
}
if (import.meta.main) Deno.serve(handler)

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

function verificarWebhook(url: URL): Response {
  const c = metaConfig()
  const ok = url.searchParams.get('hub.mode') === 'subscribe' && !!c.verify && url.searchParams.get('hub.verify_token') === c.verify
  return ok ? new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 }) : json({ ok: false, motivo: 'verificacao_recusada' }, 403)
}


function depsDoWebhook(): DepsWebhook {
  return {
    async status(idExterno, status, erro) { return await rpc<boolean>('campanha_status_meta', { p_id_externo: idExterno, p_status: status, p_erro: erro }) },
    async contatoDaMensagem(idExterno) {
      return (await selecionar<{ contato_id: string }>(`mensagens_whatsapp?select=contato_id&provedor=eq.meta&id_externo=eq.${encodeURIComponent(idExterno)}&limit=1`))[0]?.contato_id ?? null
    },
    async contatoPorWhatsapp(whatsapp) {
      return (await selecionar<{ id: string }>(`contatos_dados?select=id&whatsapp=eq.${encodeURIComponent(whatsapp)}&limit=1`))[0]?.id ?? null
    },
    async revogarConsentimento(contatoId, fonte) { await rpc('marketing_registrar_preferencia', { p_contato: contatoId, p_ativo: false, p_fonte: fonte }) },
    async gravarRecebida(whatsapp, idExterno, tipo, texto) {
      const achar = async () => (await selecionar<{ id: string }>(`contatos_dados?select=id&whatsapp=eq.${encodeURIComponent(whatsapp)}&limit=1`))[0]?.id
      const contato = await achar() ?? (await inserir<{ id: string }>('contatos_dados', { whatsapp, status: 'novo_lead' }, true, 'whatsapp'))[0]?.id ?? await achar()
      if (!contato) throw new Error('contato não criado')
      await inserir('mensagens_whatsapp', {
        contato_id: contato, autor: 'cliente', tipo: ['texto', 'audio', 'imagem', 'video', 'documento'].includes(tipo) ? tipo : 'texto',
        conteudo: texto, id_externo: idExterno, provedor: 'meta', lida: false,
      }, true, 'provedor,id_externo')
    },
  }
}

async function receberWebhook(req: Request): Promise<Response> {
  const c = metaConfig()
  const bruto = await req.text()
  if (!(await assinaturaValida(bruto, req.headers.get('x-hub-signature-256'), c.appSecret))) return json({ ok: false, motivo: 'assinatura_invalida' }, 401)
  let corpo: unknown
  try { corpo = JSON.parse(bruto) } catch { return json({ ok: true, ignorado: 'corpo_invalido' }) }
  // Erro de banco devolve 500 e a Meta reenvia: tudo aqui é idempotente (recibo monotônico, mensagem por id).
  const r = await tratarWebhook(depsDoWebhook(), corpo, c.waba, c.numero)
  return json({ ok: true, ...r })
}

// ---------------------------------------------------------------------------
// Telas do gestor
// ---------------------------------------------------------------------------

async function exigirGestor(req: Request): Promise<Response | null> {
  const u = await usuarioDaSessao(req)
  if (!u) return json({ ok: false, motivo: 'sem_sessao' }, 401)
  if (u.papel !== 'gestor') return json({ ok: false, motivo: 'somente_gestor' }, 403)
  return null
}

async function rotaModelos(req: Request): Promise<Response> {
  const negado = await exigirGestor(req); if (negado) return negado
  if (!metaConfigurada()) return json({ ok: false, motivo: 'nao_configurado' }, 400)
  const modelos = await modelosMeta()
  // Só marketing aparece: é o que esta tela dispara. Os demais não são mostrados nem como "indisponíveis".
  return json({ ok: true, modelos: modelos.filter(m => m.category === 'MARKETING').map(descreverModeloCampanha) })
}

async function rotaModelosTodos(req: Request): Promise<Response> {
  const negado = await exigirGestor(req); if (negado) return negado
  if (!metaConfigurada()) return json({ ok: false, motivo: 'nao_configurado' }, 400)
  return json({ ok: true, modelos: (await modelosMeta()).map(descreverModeloGestao) })
}

/** Cria o modelo. Conferido antes (`montarCriacaoDeModelo`) para a Meta não reprovar por algo que já se sabia. */
async function rotaCriarModelo(req: Request): Promise<Response> {
  const negado = await exigirGestor(req); if (negado) return negado
  if (!metaConfigurada()) return json({ ok: false, motivo: 'nao_configurado' }, 400)
  const entrada = await req.json().catch(() => null) as Partial<EntradaDeModelo> | null
  if (!entrada || typeof entrada !== 'object') return json({ ok: false, motivo: 'dados_invalidos' }, 400)
  const pronto = montarCriacaoDeModelo({
    nome: String(entrada.nome ?? ''), idioma: String(entrada.idioma ?? ''), categoria: entrada.categoria as EntradaDeModelo['categoria'],
    corpo: String(entrada.corpo ?? ''), exemplos: Array.isArray(entrada.exemplos) ? entrada.exemplos.map(String) : [],
    rodape: typeof entrada.rodape === 'string' ? entrada.rodape : undefined, botoes: Array.isArray(entrada.botoes) ? entrada.botoes.map(String) : [],
  })
  if (!pronto.ok) return json({ ok: false, motivo: 'modelo_invalido', erro: pronto.erro }, 400)
  try {
    const criado = await criarModeloMeta(pronto.corpo)
    return json({ ok: true, ...criado })
  } catch (e) {
    // "Incerto" = a Meta pode ter criado: a tela manda conferir a lista antes de tentar de novo.
    const incerto = e instanceof ErroMeta && e.incerto
    return json({ ok: false, motivo: incerto ? 'incerto' : 'recusado_pela_meta', erro: e instanceof Error ? e.message : 'Erro' }, incerto ? 502 : 400)
  }
}

/** Apagar não tem volta. Recusa se uma campanha que ainda vai enviar usa o modelo: ela falharia na hora de enviar. */
async function rotaApagarModelo(req: Request): Promise<Response> {
  const negado = await exigirGestor(req); if (negado) return negado
  if (!metaConfigurada()) return json({ ok: false, motivo: 'nao_configurado' }, 400)
  const corpo = await req.json().catch(() => ({})) as { nome?: string }
  const nome = String(corpo.nome ?? '').trim()
  if (!/^[a-z][a-z0-9_]{0,511}$/.test(nome)) return json({ ok: false, motivo: 'dados_invalidos' }, 400)
  const emUso = await selecionar<{ id: string }>(`campanhas?select=id&modelo_nome=eq.${encodeURIComponent(nome)}&estado=in.(rascunho,pronta,enviando,pausada)&limit=1`)
  if (emUso.length) return json({ ok: false, motivo: 'em_uso', erro: 'Uma campanha em aberto usa este modelo. Conclua ou cancele a campanha antes.' }, 409)
  try {
    await apagarModeloMeta(nome)
    return json({ ok: true })
  } catch (e) {
    return json({ ok: false, motivo: 'recusado_pela_meta', erro: e instanceof Error ? e.message : 'Erro' }, 400)
  }
}

async function rotaConta(req: Request): Promise<Response> {
  const negado = await exigirGestor(req); if (negado) return negado
  if (!metaConfigurada()) return json({ ok: true, configurada: false })
  try { return json({ ok: true, configurada: true, ...(await estadoDoNumero()) }) }
  catch { return json({ ok: true, configurada: true, indisponivel: true }) }
}

// ---------------------------------------------------------------------------
// O trabalhador
// ---------------------------------------------------------------------------

function depsDaFila(): DepsCampanhas {
  return {
    reivindicar: (limite) => rpc('campanha_reivindicar', { p_limite: limite }),
    modelos: modelosMeta,
    reservar: (id, token, texto) => rpc('campanha_reservar', { p_destinatario: id, p_token: token, p_texto: texto }),
    marcarChamada: (id, token) => rpc('campanha_marcar_chamada', { p_destinatario: id, p_token: token }),
    enviar: async (numero, nome, idioma, componentes, correlacao) => {
      const r = await enviarModelo(numero, nome, idioma, componentes, correlacao)
      return { id: r.id, estado: r.estado }
    },
    finalizar: (id, token, resultado, idExterno, erro, repetirEm) => rpc('campanha_finalizar', {
      p_destinatario: id, p_token: token, p_resultado: resultado, p_id_externo: idExterno, p_erro: erro,
      p_repetir_em: repetirEm === null ? null : `${Math.round(repetirEm)} seconds`,
    }),
    pausarCampanha: (id, motivo) => rpc('campanha_pausar_sistema', { p_campanha: id, p_motivo: motivo }),
    revogarConsentimento: (contato, fonte) => rpc('marketing_registrar_preferencia', { p_contato: contato, p_ativo: false, p_fonte: fonte }),
  }
}

async function rotaProcessar(req: Request): Promise<Response> {
  const segredo = Deno.env.get('CAMPANHAS_WORKER_SECRET') ?? ''
  const enviado = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  // Comparação em tempo constante não é necessária para um segredo longo e aleatório, mas o segredo curto é recusado.
  if (segredo.length < 24 || enviado !== segredo) return json({ ok: false, motivo: 'nao_autorizado' }, 401)
  if (!metaConfigurada()) return json({ ok: false, motivo: 'nao_configurado' }, 400)
  const corpo = await req.json().catch(() => ({})) as { limite?: unknown }
  const limite = Number.isInteger(corpo.limite) ? Number(corpo.limite) : 10
  const r = await processarLote(depsDaFila(), limite)
  return json({ ok: true, ...r })
}
