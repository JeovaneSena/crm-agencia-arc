/**
 * Função do módulo CONVERSAS: a ponte entre o WhatsApp (uazapi) e a tela
 * Conversas. Só isto — sem assistente, campanhas, Meta ou suporte; esses
 * módulos trazem as próprias rotas quando forem ligados.
 *
 * Rotas (prefixo `/functions/v1/whatsapp`):
 *   POST /                       webhook da uazapi (segredo em x-webhook-segredo ou ?segredo=)
 *   POST /enviar                 equipe envia texto ao contato (idempotente por pedido_id)
 *   POST /enviar-midia           equipe envia foto, vídeo, áudio ou documento (multipart; idempotente por pedido_id)
 *   GET  /conexao                estado da conexão, sem nunca devolver chave ou URL do webhook
 *   POST /conexao/conectar       inicia a conexão (QR / código)
 *   POST /conexao/desconectar
 *   GET  /foto?whatsapp=         foto de perfil
 *   POST /apagar-pessoa          só gestor: mídias do Storage + contato (o resto cai em cascata)
 *   POST /rascunho               equipe pede um rascunho de resposta da IA (só com o módulo assistente); NÃO envia nada
 *   POST /vigiar                 o vigia (Authorization: Bearer VIGIA_SEGREDO), a cada 5 min: mensagem presa,
 *                                conexão caída, assistente esquecido em teste; abre e fecha avisos na Central
 *
 * Escreve em `mensagens_whatsapp` com a service_role; a equipe só lê.
 */
import { apagar, apagarMidias, assinarMidia, atualizar, inserir, listarMidias, rpc, selecionar, subirMidia } from '../_shared/db.ts'
import { UAZAPI } from '../_shared/uazapi.ts'
import { avaliarWebhook } from '../_shared/whatsapp.ts'
import { usuarioDaSessao } from '../_shared/sessao.ts'
import { aposReceber, camposDoContatoNovo, rascunhoDaIA } from '../_shared/gancho.ts'
import { vigiar, type DepsVigia } from '../_shared/vigia.ts'
import { classificarAnexo } from '../_shared/anexos.ts'

const SEGREDO = Deno.env.get('WEBHOOK_SEGREDO') ?? ''
const URL_SUPABASE = Deno.env.get('SUPABASE_URL')!
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-segredo',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const rota = new URL(req.url).pathname.replace(/^\/(?:functions\/v1\/)?whatsapp/, '').replace(/\/+$/, '')
  try {
    if (req.method === 'POST' && rota === '') return await rotaWebhook(req)
    if (req.method === 'POST' && rota === '/enviar') return await rotaEnviar(req)
    if (req.method === 'POST' && rota === '/enviar-midia') return await rotaEnviarMidia(req)
    if (req.method === 'GET' && rota === '/conexao') return await rotaConexao(req)
    if (req.method === 'POST' && rota === '/conexao/conectar') return await rotaConectar(req)
    if (req.method === 'POST' && rota === '/conexao/desconectar') return await rotaDesconectar(req)
    if (req.method === 'GET' && rota === '/foto') return await rotaFoto(req)
    if (req.method === 'POST' && rota === '/apagar-pessoa') return await rotaApagarPessoa(req)
    if (req.method === 'POST' && rota === '/rascunho') return await rotaRascunho(req)
    if (req.method === 'POST' && rota === '/vigiar') return await rotaVigiar(req)
    return json({ ok: false, motivo: 'rota_desconhecida' }, 404)
  } catch (e) {
    console.error('erro na entrada:', e instanceof Error ? e.message : 'erro')
    return json({ ok: false, motivo: 'erro_interno' }, 500)
  }
}
if (import.meta.main) Deno.serve(handler)

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

async function rotaWebhook(req: Request): Promise<Response> {
  const enviado = req.headers.get('x-webhook-segredo') ?? new URL(req.url).searchParams.get('segredo') ?? ''
  if (!SEGREDO || enviado !== SEGREDO) return json({ ok: false, motivo: 'nao_autorizado' }, 401)

  const corpo = await req.json().catch(() => null)
  if (!corpo) return json({ ok: true, ignorado: 'corpo_invalido' })

  const lido = UAZAPI.lerWebhook(corpo)
  if (lido.tipo === 'ignorar') {
    // Sempre com motivo: o defeito clássico deste tipo de integração é o silêncio.
    console.log(`webhook ignorado: ${lido.motivo}`)
    return json({ ok: true, ignorado: lido.motivo })
  }

  const recebida = lido.mensagem
  const contatoId = await acharOuCriarContato(recebida.whatsapp)
  const criadas = await inserir<{ id: string }>('mensagens_whatsapp', {
    contato_id: contatoId,
    autor: 'cliente',
    tipo: recebida.tipo,
    conteudo: recebida.texto,
    id_externo: recebida.idExterno,
    provedor: 'uazapi',
    lida: false,
  }, true, 'provedor,id_externo')
  if (!criadas.length) return json({ ok: true, ignorado: 'duplicada' })

  if (recebida.midia) {
    const midia = recebida.midia
    await emSegundoPlano(guardarMidia(contatoId, criadas[0].id, midia).catch((e) => console.error('midia:', e instanceof Error ? e.message : 'erro')))
  }
  // Módulos que reagem à mensagem (ex.: assistente) entram por aqui; sem módulo, `gancho.ts` não faz nada.
  await emSegundoPlano(aposReceber({ contatoId, mensagemId: criadas[0].id, whatsapp: recebida.whatsapp, tipo: recebida.tipo, texto: recebida.texto }))
  return json({ ok: true })
}

/** Na borda, termina depois da resposta ao webhook; fora dela (testes), espera. */
async function emSegundoPlano(trabalho: Promise<unknown>): Promise<void> {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime
  if (rt?.waitUntil) rt.waitUntil(trabalho); else await trabalho
}

async function guardarMidia(contatoId: string, mensagemId: string, midia: NonNullable<Parameters<typeof UAZAPI.baixarMidia>[0]>): Promise<void> {
  const baixada = await UAZAPI.baixarMidia(midia)
  if (!baixada) return
  const bytes = Uint8Array.from(atob(baixada.base64), (c) => c.charCodeAt(0))
  const extensao = (baixada.tipoMime.split('/')[1] ?? 'bin').split(';')[0]
  const caminho = `${contatoId}/${mensagemId}.${extensao}`
  await subirMidia(caminho, bytes, baixada.tipoMime)
  await atualizar('mensagens_whatsapp', `id=eq.${mensagemId}`, { midia_url: caminho })
}

async function acharOuCriarContato(whatsapp: string): Promise<string> {
  const achar = async () => (await selecionar<{ id: string }>(`contatos_dados?select=id&whatsapp=eq.${whatsapp}&limit=1`))[0]?.id
  const existente = await achar()
  if (existente) return existente
  const criados = await inserir<{ id: string }>('contatos_dados', { whatsapp, status: 'novo_lead', ...await camposDoContatoNovo() }, true, 'whatsapp')
  // Corrida: outra execução criou entre o select e o insert.
  return criados[0]?.id ?? (await achar())!
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

async function rotaEnviar(req: Request): Promise<Response> {
  const usuario = await usuarioDaSessao(req)
  if (!usuario) return json({ ok: false, motivo: 'sem_sessao' }, 401)

  const corpo = await req.json().catch(() => ({})) as { contato_id?: string; texto?: string; pedido_id?: string }
  const contatoId = String(corpo.contato_id ?? '')
  const texto = String(corpo.texto ?? '').trim()
  const pedido = String(corpo.pedido_id ?? '')
  if (!UUID.test(contatoId) || !UUID.test(pedido) || !texto || texto.length > 4096) return json({ ok: false, motivo: 'dados_invalidos' }, 400)

  const contato = (await selecionar<{ whatsapp: string | null; assumido_por: string | null }>(`contatos_dados?select=whatsapp,assumido_por&id=eq.${contatoId}&limit=1`))[0]
  const whatsapp = contato?.whatsapp
  if (!whatsapp) return json({ ok: false, motivo: 'contato_sem_whatsapp' }, 400)
  // Conversa com dono: só ele escreve. Quem quiser falar assume (ou o gestor toma) antes; assim dois não respondem juntos.
  if (contato.assumido_por && contato.assumido_por !== usuario.id) return json({ ok: false, motivo: 'conversa_com_outra_pessoa' }, 409)

  // Reserva primeiro, envia depois: um duplo clique ou reenvio do navegador
  // bate no mesmo `pedido_id` e nunca manda a mensagem duas vezes.
  const reservadas = await inserir<{ id: string }>('mensagens_whatsapp', {
    contato_id: contatoId, autor: 'atendente', tipo: 'texto', conteudo: texto, provedor: 'uazapi',
    pedido_id: pedido, estado_envio: 'pendente', origem_envio: 'atendimento', enviada_por: usuario.id, lida: true,
  }, true, 'pedido_id')
  if (!reservadas.length) return json({ ok: true, repetido: true })

  const id = reservadas[0].id
  try {
    const idExterno = await UAZAPI.enviarTexto(whatsapp, texto)
    await atualizar('mensagens_whatsapp', `id=eq.${id}`, { id_externo: idExterno, estado_envio: 'enviado' })
    return json({ ok: true })
  } catch (e) {
    console.error('envio:', e instanceof Error ? e.message : 'erro')
    await atualizar('mensagens_whatsapp', `id=eq.${id}`, { estado_envio: 'falhou', erro_envio: 'Não foi possível enviar pela conexão do WhatsApp.' })
    return json({ ok: false, motivo: 'falha_no_envio' }, 502)
  }
}

/**
 * Envia um anexo. Mesma disciplina do texto: reserva a linha ANTES (o `pedido_id` impede o duplo clique de mandar
 * duas vezes), guarda o arquivo no Storage, entrega à uazapi uma URL assinada de 10 minutos e registra o resultado.
 * Qualquer falha deixa a mensagem `falhou` na conversa; nada é reenviado sozinho.
 *
 * ⚠️ A chamada à uazapi (`enviarMidia`) ainda não foi conferida contra o servidor real.
 */
async function rotaEnviarMidia(req: Request): Promise<Response> {
  const usuario = await usuarioDaSessao(req)
  if (!usuario) return json({ ok: false, motivo: 'sem_sessao' }, 401)
  const tamanho = Number(req.headers.get('content-length') ?? 0)
  if (tamanho > 20 * 1024 * 1024) return json({ ok: false, motivo: 'arquivo_grande' }, 413)

  let form: FormData
  try { form = await req.formData() } catch { return json({ ok: false, motivo: 'dados_invalidos' }, 400) }
  const contatoId = String(form.get('contato_id') ?? '')
  const pedido = String(form.get('pedido_id') ?? '')
  const legenda = String(form.get('legenda') ?? '').trim()
  const arquivo = form.get('arquivo')
  if (!UUID.test(contatoId) || !UUID.test(pedido) || !(arquivo instanceof File) || legenda.length > 1024) return json({ ok: false, motivo: 'dados_invalidos' }, 400)

  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  const aceito = classificarAnexo(arquivo.name, arquivo.type, bytes)
  if (!aceito.ok) return json({ ok: false, motivo: 'anexo_recusado', erro: aceito.erro }, 400)

  const contato = (await selecionar<{ whatsapp: string | null; assumido_por: string | null }>(`contatos_dados?select=whatsapp,assumido_por&id=eq.${contatoId}&limit=1`))[0]
  if (!contato?.whatsapp) return json({ ok: false, motivo: 'contato_sem_whatsapp' }, 400)
  if (contato.assumido_por && contato.assumido_por !== usuario.id) return json({ ok: false, motivo: 'conversa_com_outra_pessoa' }, 409)

  const { anexo } = aceito
  const reservadas = await inserir<{ id: string }>('mensagens_whatsapp', {
    contato_id: contatoId, autor: 'atendente', tipo: anexo.tipo, conteudo: legenda || null, provedor: 'uazapi',
    pedido_id: pedido, estado_envio: 'pendente', origem_envio: 'atendimento', enviada_por: usuario.id, lida: true,
  }, true, 'pedido_id')
  if (!reservadas.length) return json({ ok: true, repetido: true })

  const id = reservadas[0].id
  const falhou = async (erro: string, status: number, motivo: string) => {
    await atualizar('mensagens_whatsapp', `id=eq.${id}`, { estado_envio: 'falhou', erro_envio: erro }).catch(() => {})
    return json({ ok: false, motivo }, status)
  }
  try {
    const caminho = `${contatoId}/saida-${id}.${anexo.extensao}`   // sob a pasta do contato: "apagar pessoa" leva junto
    await subirMidia(caminho, bytes, anexo.mime)
    await atualizar('mensagens_whatsapp', `id=eq.${id}`, { midia_url: caminho })
    const url = await assinarMidia(caminho, 600)
    const idExterno = await UAZAPI.enviarMidia(contato.whatsapp, anexo.uazapi, url, legenda || null, anexo.tipo === 'documento' ? anexo.nomeSeguro : null)
    await atualizar('mensagens_whatsapp', `id=eq.${id}`, { id_externo: idExterno, estado_envio: 'enviado' })
    return json({ ok: true })
  } catch (e) {
    console.error('envio de anexo:', e instanceof Error ? e.message.slice(0, 160) : 'erro')
    return await falhou('Não foi possível enviar o anexo pela conexão do WhatsApp.', 502, 'falha_no_envio')
  }
}

// ---------------------------------------------------------------------------
// Conexão
// ---------------------------------------------------------------------------

async function rotaConexao(req: Request): Promise<Response> {
  if (!await usuarioDaSessao(req)) return json({ ok: false, motivo: 'sem_sessao' }, 401)
  // Em paralelo: são dois servidores lentos quando algo está errado.
  const [estado, config] = await Promise.all([UAZAPI.estadoDaConexao(), UAZAPI.webhook()])
  // Do webhook sai só o veredito, nunca a URL: ela carrega o segredo.
  return json({
    ok: true, provedor: 'uazapi', ...UAZAPI.identificacao(), ...estado,
    webhook: avaliarWebhook(config, `${URL_SUPABASE}/functions/v1/whatsapp`),
  })
}

async function rotaConectar(req: Request): Promise<Response> {
  if (!await usuarioDaSessao(req)) return json({ ok: false, motivo: 'sem_sessao' }, 401)
  if (!UAZAPI.configurada()) return json({ ok: false, motivo: 'nao_configurado' }, 400)
  const corpo = await req.json().catch(() => ({})) as { numero?: string }
  const r = await UAZAPI.iniciarConexao(corpo.numero)
  return r ? json({ ok: true, ...r }) : json({ ok: false, motivo: 'servidor_fora' }, 502)
}

async function rotaDesconectar(req: Request): Promise<Response> {
  if (!await usuarioDaSessao(req)) return json({ ok: false, motivo: 'sem_sessao' }, 401)
  if (!UAZAPI.configurada()) return json({ ok: false, motivo: 'nao_configurado' }, 400)
  return (await UAZAPI.desconectar()) ? json({ ok: true }) : json({ ok: false, motivo: 'servidor_fora' }, 502)
}

async function rotaFoto(req: Request): Promise<Response> {
  if (!await usuarioDaSessao(req)) return json({ ok: false, motivo: 'sem_sessao' }, 401)
  const numero = (new URL(req.url).searchParams.get('whatsapp') ?? '').replace(/\D/g, '')
  if (!numero) return json({ ok: false, motivo: 'sem_numero' }, 400)
  return json({ ok: true, url: await UAZAPI.fotoDoPerfil(numero) })
}

// ---------------------------------------------------------------------------
// Apagar uma pessoa inteira
// ---------------------------------------------------------------------------

/**
 * Sem volta: LGPD, número errado, lixo de teste. Os ARQUIVOS exigem esta função: o
 * Postgres recusa `delete from storage.objects`, e só a Storage API (service_role)
 * os remove. Ordem: mídia primeiro, ficha depois — o caminho é `{contato_id}/...`,
 * e sem a ficha não se sabe mais quais arquivos eram dela.
 */
async function rotaApagarPessoa(req: Request): Promise<Response> {
  const usuario = await usuarioDaSessao(req)
  if (!usuario) return json({ ok: false, motivo: 'sem_sessao' }, 401)
  if (usuario.papel !== 'gestor') return json({ ok: false, motivo: 'somente_gestor' }, 403)

  const corpo = await req.json().catch(() => ({})) as { contato_id?: string }
  const contatoId = String(corpo.contato_id ?? '').trim()
  if (!UUID.test(contatoId)) return json({ ok: false, motivo: 'contato_invalido' }, 400)
  if (!(await selecionar(`contatos_dados?select=id&id=eq.${contatoId}&limit=1`)).length) return json({ ok: false, motivo: 'nao_encontrada' }, 404)

  let midias = 0
  try { midias = await apagarMidias(await listarMidias(contatoId)) }
  catch (e) { console.error('apagar midias:', e instanceof Error ? e.message : 'erro'); return json({ ok: false, motivo: 'falha_na_midia' }, 500) }

  await apagar('contatos_dados', `id=eq.${contatoId}`)
  console.log(`pessoa apagada: ${contatoId} por ${usuario.id} (${midias} arquivo(s))`)
  return json({ ok: true, midias })
}

// ---------------------------------------------------------------------------
// Vigia
// ---------------------------------------------------------------------------

/** Tabela que não existe (módulo não instalado) não é erro: é "nada a vigiar". */
const semTabela = (e: unknown) => e instanceof Error && /PGRST205|42P01|does not exist/i.test(e.message)

function depsDoVigia(): DepsVigia {
  return {
    agora: () => new Date(),
    esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
    rpc,
    async mensagensPendentes(antesDe) {
      const m = await selecionar<{ id: string; contato_id: string }>(
        `mensagens_whatsapp?select=id,contato_id&estado_envio=eq.pendente&autor=in.(agente,atendente)&criada_em=lt.${encodeURIComponent(antesDe.toISOString())}&order=criada_em&limit=200`)
      return m.map((x) => ({ id: x.id, contatoId: x.contato_id }))
    },
    async marcarIncertas(ids) {
      // Só as que continuam pendentes: se o envio terminou no meio, o estado dele vale mais.
      for (let i = 0; i < ids.length; i += 50) {
        await atualizar('mensagens_whatsapp', `id=in.(${ids.slice(i, i + 50).join(',')})&estado_envio=eq.pendente`,
          { estado_envio: 'incerto', erro_envio: 'O envio não foi confirmado. Confira antes de reenviar.' })
      }
    },
    async estadoDaConexao() {
      // Só a uazapi tem conexão para vigiar; com a Meta oficial não há QR a cair.
      const provedor = (await selecionar<{ provedor: string }>('conversas_config?select=provedor&limit=1'))[0]?.provedor
      if (provedor !== 'uazapi' || !UAZAPI.configurada()) return null
      return (await UAZAPI.estadoDaConexao()).estado
    },
    async reabrirAdiadas() {
      const v = await rpc<{ contato_id: string; nome: string | null }[]>('conversas_adiadas_vencidas', {})
      return (v ?? []).map((x) => ({ contatoId: x.contato_id, nome: x.nome }))
    },
    async removerMidiasVencidas() {
      // Arquivo primeiro, registro depois: se o Storage falhar nada é marcado e a próxima rodada tenta de novo.
      const vencidas = await rpc<{ id: string; midia_url: string }[]>('midias_vencidas', { p_limite: 50 })
      if (!vencidas?.length) return 0
      await apagarMidias(vencidas.map((m) => m.midia_url))
      await rpc('midias_marcar_removidas', { p_ids: vencidas.map((m) => m.id) })
      return vencidas.length
    },
    async assistente() {
      try {
        const c = (await selecionar<{ modo: string; updated_at: string }>('assistente_config?select=modo,updated_at&limit=1'))[0]
        return c ? { modo: c.modo, desde: new Date(c.updated_at) } : null
      } catch (e) { if (semTabela(e)) return null; throw e }
    },
  }
}

async function rotaVigiar(req: Request): Promise<Response> {
  const segredo = Deno.env.get('VIGIA_SEGREDO') ?? ''
  const enviado = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (segredo.length < 24 || enviado !== segredo) return json({ ok: false, motivo: 'nao_autorizado' }, 401)
  const r = await vigiar(depsDoVigia(), async () => Number(await rpc<number>('avisos_expurgar', { p_dias: 90 })) || 0)
  return json({ ok: r.erros.length === 0, ...r }, r.erros.length ? 500 : 200)
}

// ---------------------------------------------------------------------------
// Rascunho
// ---------------------------------------------------------------------------

/** A IA escreve, a pessoa revisa e envia: esta rota só devolve texto, nunca manda mensagem. */
async function rotaRascunho(req: Request): Promise<Response> {
  const usuario = await usuarioDaSessao(req)
  if (!usuario) return json({ ok: false, motivo: 'sem_sessao' }, 401)
  const corpo = await req.json().catch(() => ({})) as { contato_id?: string }
  const contatoId = String(corpo.contato_id ?? '')
  if (!UUID.test(contatoId)) return json({ ok: false, motivo: 'dados_invalidos' }, 400)
  const r = await rascunhoDaIA(contatoId)
  if (r.ok) return json({ ok: true, texto: r.texto })
  const status = r.motivo === 'indisponivel' ? 404 : r.motivo === 'falha_no_modelo' ? 502 : 400
  return json({ ok: false, motivo: r.motivo }, status)
}
