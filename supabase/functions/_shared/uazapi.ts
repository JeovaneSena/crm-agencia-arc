/**
 * uazapi — a segunda ponte com o WhatsApp.
 *
 * ⚠️ ESCRITO CONTRA A **v2** (confirmado 2.1.9 na instância da clínica), lendo
 * a API de verdade e não a documentação: `docs.uazapi.com` é uma página que
 * monta a referência por JavaScript, e os markdown por trás dela são rascunho
 * de template. Cada rota abaixo foi verificada contra o servidor.
 *
 * ── O QUE ELA TEM DE DIFERENTE DA INTEGRAÇÃO ANTERIOR ────────────────────────────────
 *
 * 1. **O texto vem plano.** `text`, e não a árvore do Baileys
 *    (`message.conversation`, `message.extendedTextMessage.text`, …).
 * 2. **`isGroup` é booleano.** A integração anterior obriga a olhar o sufixo do jid.
 * 3. **A mídia sai por um POST próprio.** `/message/download` com o
 *    `messageid` devolve uma URL do servidor da uazapi, já descriptografada.
 *    (O `fileURL` do evento existe, mas chega **vazio** nesta instalação — e
 *    a `content.URL` ao lado dele é a CDN do WhatsApp, criptografada.)
 *
 * Autenticação: header `token` com o token **da instância**. O token de admin
 * (que cria e apaga instâncias) não entra aqui — este sistema nunca cria
 * instância, só conversa com a que existe.
 */

import {
  foraDoAr, soDigitos,
  type Conexao, type Estado, type Midia, type Ponte, type Recebimento,
  type WebhookLido,
} from './whatsapp.ts'

const URL_BASE = (Deno.env.get('UAZAPI_API_URL') ?? '').replace(/\/+$/, '')
const TOKEN = Deno.env.get('UAZAPI_TOKEN') ?? ''

/** O mesmo prazo da integração anterior: passou disso, para quem olha a tela é "fora do ar". */
const PRAZO_MS = 8_000

const CABECALHOS = {
  token: TOKEN,
  'Content-Type': 'application/json',
}

async function chamar<T>(
  caminho: string,
  corpo?: Record<string, unknown>,
  metodo = 'POST',
  prazo = PRAZO_MS,
): Promise<T | null> {
  try {
    const r = await fetch(`${URL_BASE}${caminho}`, {
      method: metodo,
      headers: CABECALHOS,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(prazo),
    })
    if (!r.ok) return null
    return await r.json() as T
  } catch {
    // Timeout, DNS, recusa: para quem chama, é tudo "não respondeu".
    return null
  }
}

// ---------------------------------------------------------------------------
// O que chega
// ---------------------------------------------------------------------------

/**
 * Os tipos que a uazapi usa, mapeados para os nossos.
 *
 * `ReactionMessage`, `PollUpdateMessage` e `error` ficam de fora **de
 * propósito**: um "❤️" numa mensagem antiga não é uma pergunta, e responder a
 * ele é a Gabriela falando sozinha.
 */
const TIPOS: Record<string, string> = {
  Conversation: 'texto',
  ExtendedTextMessage: 'texto',
  AudioMessage: 'audio',
  ImageMessage: 'imagem',
  VideoMessage: 'video',
  DocumentMessage: 'documento',
}

/**
 * Só áudio e imagem são baixados — a mesma política da integração anterior.
 *
 * Vídeo e documento ficam de fora porque a Gabriela não faz nada com eles: o
 * modelo não assiste vídeo, e baixar um PDF de 8 MB para guardar sem ler é
 * custo de Storage sem retorno. O balão aparece na tela do jeito certo, e a
 * recepção abre no celular se precisar.
 */
const BAIXAVEIS = new Set(['audio', 'imagem'])

interface MensagemUazapi {
  chatid?: string
  sender?: string
  fromMe?: boolean
  isGroup?: boolean
  messageid?: string
  id?: string
  messageType?: string
  text?: string
  fileURL?: string
}

function lerWebhook(corpo: Record<string, unknown>): Recebimento {
  // O envelope da entrega varia com a versão e com as opções de webhook
  // (`addUrlEvents`, `addUrlTypesMessages`), então procuramos o objeto da
  // mensagem em vez de exigir uma forma. Se um dia ele mudar de lugar de novo,
  // o pior que acontece é cair no `formato_desconhecido` — com log, não em
  // silêncio.
  const m = (corpo.message ?? corpo.data ?? corpo) as MensagemUazapi

  const evento = String(corpo.event ?? corpo.EventType ?? '').toLowerCase()
  if (evento && !evento.includes('message')) {
    return { tipo: 'ignorar', motivo: `evento_${evento}` }
  }

  if (!m || typeof m !== 'object' || (!m.chatid && !m.sender)) {
    return { tipo: 'ignorar', motivo: 'formato_desconhecido' }
  }

  // Mensagem que nós mesmos mandamos volta pelo webhook. Sem este corte, a
  // Gabriela responderia a si mesma, para sempre.
  if (m.fromMe) return { tipo: 'ignorar', motivo: 'propria' }

  // Grupo não é atendimento. E não é hipótese remota: na instância de teste,
  // 207 das 238 mensagens recebidas eram de grupo.
  if (m.isGroup || String(m.chatid ?? '').endsWith('@g.us')) {
    return { tipo: 'ignorar', motivo: 'grupo' }
  }

  const tipo = TIPOS[String(m.messageType ?? '')]
  if (!tipo) return { tipo: 'ignorar', motivo: `tipo_${m.messageType ?? 'vazio'}` }

  const whatsapp = soDigitos(m.chatid ?? m.sender ?? '')
  if (!whatsapp) return { tipo: 'ignorar', motivo: 'sem_numero' }

  // `messageid` é o id do WhatsApp — o mesmo que a integração anterior chama de
  // `key.id`. O `id` da uazapi vem prefixado com o número da instância, e
  // mudaria se a clínica trocasse de número.
  const id = m.messageid ?? m.id ?? null

  return {
    tipo: 'mensagem',
    mensagem: {
      whatsapp,
      idExterno: id,
      tipo,
      texto: (m.text ?? '').trim() || null,
      midia: BAIXAVEIS.has(tipo) ? referencia(m, id) : null,
    },
  }
}

/**
 * De onde esta mensagem vai ser baixada.
 *
 * ⚠️ **O `fileURL` do webhook chega VAZIO**, e foi assim que o áudio e a foto
 * sumiram na estreia: sem referência, o `index.ts` não baixava nada, e a
 * Gabriela respondia a uma foto que nunca viu. A `content.URL` que vem ao lado
 * não salva — é a CDN do WhatsApp, com o arquivo criptografado pela
 * `mediaKey`.
 *
 * O `fileURL` continua sendo preferido porque é uma requisição a menos, e
 * porque um servidor configurado para hospedar a mídia o preenche.
 */
function referencia(m: MensagemUazapi, id: string | null): Midia | null {
  const url = (m.fileURL ?? '').trim()
  if (url) return { via: 'url', url }
  return id ? { via: 'uazapi', id } : null
}

// ---------------------------------------------------------------------------
// O que sai
// ---------------------------------------------------------------------------

async function digitando(numero: string, ms: number): Promise<void> {
  await chamar('/message/presence', {
    number: numero,
    presence: 'composing',
    delay: ms,
  })
  // Presença é cosmética: `chamar` já engole o erro, e a mensagem sai mesmo
  // que o "digitando…" não apareça.
}

async function enviarTexto(numero: string, texto: string): Promise<string | null> {
  const r = await chamar<{ messageid?: string; id?: string }>('/send/text', {
    number: numero,
    text: texto,
  })
  // Diferente da integração anterior, aqui o `null` é silencioso — `chamar` não lança.
  // Quem chama precisa saber que não saiu.
  if (!r) throw new Error('uazapi /send/text: sem resposta')
  return r.messageid ?? r.id ?? null
}

/**
 * Pede à uazapi que descriptografe a mídia e a hospede.
 *
 * `POST /message/download` com o `messageid` devolve
 * `{ cached, fileURL, mimetype }` — uma URL do próprio servidor dela, que
 * responde 200 sem token. O prazo é maior que o padrão: aqui pode haver
 * download e conversão do lado de lá, e 8 segundos é curto para um áudio
 * longo.
 *
 * ⚠️ O `mimetype` daqui **não é o do WhatsApp**: um áudio que chegou como
 * `audio/ogg; codecs=opus` volta convertido em `audio/mpeg`. É este que vale
 * — é o do arquivo que vamos buscar.
 */
async function urlDoArquivo(id: string): Promise<string | null> {
  const r = await chamar<{ fileURL?: string }>(
    '/message/download',
    { id },
    'POST',
    20_000,
  )
  return r?.fileURL || null
}

async function baixarMidia(
  midia: Midia,
): Promise<{ base64: string; tipoMime: string } | null> {
  let alvo: string | null = null
  if (midia.via === 'url') alvo = midia.url
  else if (midia.via === 'uazapi') alvo = await urlDoArquivo(midia.id)
  if (!alvo) return null

  try {
    const r = await fetch(alvo, { signal: AbortSignal.timeout(20_000) })
    if (!r.ok) return null
    const bytes = new Uint8Array(await r.arrayBuffer())

    // Em blocos: `String.fromCharCode(...bytes)` de um áudio de 1 MB estoura a
    // pilha de argumentos e derruba a função inteira.
    let bruto = ''
    for (let i = 0; i < bytes.length; i += 8192) {
      bruto += String.fromCharCode(...bytes.subarray(i, i + 8192))
    }

    return {
      base64: btoa(bruto),
      tipoMime: r.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream',
    }
  } catch {
    return null
  }
}

async function fotoDoPerfil(numero: string): Promise<string | null> {
  const r = await chamar<{ image?: string }>('/chat/details', {
    number: soDigitos(numero),
    preview: false,
  })
  return r?.image || null
}

// ---------------------------------------------------------------------------
// A conexão
// ---------------------------------------------------------------------------

interface StatusUazapi {
  instance?: {
    status?: string
    owner?: string
    profileName?: string
    profilePicUrl?: string
    paircode?: string
    qrcode?: string
  }
  status?: { connected?: boolean; jid?: string }
  connected?: boolean
}

function traduzEstado(bruto: string, conectado: boolean | undefined): Estado {
  if (conectado === true) return 'conectado'
  const s = (bruto ?? '').toLowerCase()
  if (s === 'connected') return 'conectado'
  if (s === 'connecting' || s === 'pairing') return 'conectando'
  return 'desconectado'
}

async function estadoDaConexao(): Promise<Conexao> {
  if (!configurada()) return foraDoAr('nao_configurado')

  const r = await chamar<StatusUazapi>('/instance/status', undefined, 'GET')
  if (!r) return foraDoAr('indisponivel')

  const i = r.instance ?? {}
  return {
    estado: traduzEstado(i.status ?? '', r.status?.connected),
    numero: i.owner ? soDigitos(i.owner) : null,
    perfil: i.profileName ?? null,
    foto: i.profilePicUrl ?? null,
  }
}

async function iniciarConexao(
  numero?: string,
): Promise<{ codigo: string | null; qr: string | null } | null> {
  const limpo = (numero ?? '').replace(/\D/g, '')
  const r = await chamar<StatusUazapi>(
    '/instance/connect',
    limpo ? { phone: limpo } : {},
  )
  if (!r) return null
  return { codigo: r.instance?.paircode || null, qr: r.instance?.qrcode || null }
}

/**
 * ⚠️ ÚNICA ROTA DESTE ARQUIVO NÃO TESTADA CONTRA O SERVIDOR.
 *
 * Escrita pela simetria com `/instance/connect`, que foi verificada. Testar
 * significaria derrubar a sessão do WhatsApp da clínica de verdade, e não há
 * nada que se aprenda com isso que compense o telefone mudo enquanto alguém
 * repareia.
 *
 * O primeiro clique no botão "Desconectar" com a uazapi ativa é o teste. Se
 * devolver `false` sem derrubar, o caminho é outro — e o `/instance/status`
 * responde na hora qual foi.
 */
async function desconectar(): Promise<boolean> {
  return await chamar<unknown>('/instance/disconnect', {}) !== null
}

function configurada(): boolean {
  return Boolean(URL_BASE && TOKEN)
}

function identificacao() {
  return {
    servidor: URL_BASE ? URL_BASE.replace(/^https?:\/\//i, '') : null,
    // A uazapi não tem "nome de instância" como a integração anterior: a instância É o
    // token. Mostrar o token aqui seria entregar o WhatsApp da clínica a quem
    // abrir o DevTools — então a linha simplesmente não existe na tela.
    instancia: null,
    chaveFinal: TOKEN.length >= 4 ? TOKEN.slice(-4) : null,
  }
}

/**
 * `GET /webhook` devolve uma **lista** — a uazapi aceita mais de um destino.
 *
 * Vale o primeiro que estiver ligado e com URL; se nenhum estiver, o primeiro
 * da lista serve para dizer "existe, mas desligado". Lista vazia é `ausente`.
 *
 * A uazapi não tem campo de cabeçalho customizado, então o `WEBHOOK_SEGREDO`
 * viaja na query da própria URL. É por isso que `avaliarWebhook()` compara só
 * origem e caminho.
 */
async function webhook(): Promise<WebhookLido | null> {
  const r = await chamar<{ url?: string; enabled?: boolean }[]>('/webhook', undefined, 'GET')
  if (!Array.isArray(r)) return null
  const w = r.find((x) => x?.enabled && x?.url) ?? r[0]
  if (!w) return { url: null, ativo: false }
  return { url: w.url ?? null, ativo: w.enabled === true }
}

export const UAZAPI: Ponte = {
  nome: 'uazapi',
  configurada,
  lerWebhook,
  webhook,
  digitando,
  enviarTexto,
  baixarMidia,
  fotoDoPerfil,
  estadoDaConexao,
  iniciarConexao,
  desconectar,
  identificacao,
}
