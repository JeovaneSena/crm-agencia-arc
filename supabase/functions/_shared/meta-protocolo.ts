import type { MensagemRecebida } from './whatsapp.ts'

export interface EventoMeta {
  chave: string
  numero_id: string
  externo: string
  tipo: 'mensagem' | 'status'
  dados: Record<string, unknown>
}
export interface EventoContaMeta {
  chave: string
  numero_id: string
  tipo: 'modelo_status' | 'modelo_qualidade' | 'capacidade'
  modelo_id?: string | null
  modelo_nome?: string | null
  valor?: string | null
  dados: Record<string, unknown>
}
type Objeto = Record<string, unknown>
const objeto = (v: unknown): Objeto => v && typeof v === 'object' && !Array.isArray(v) ? v as Objeto : {}
const lista = (v: unknown): unknown[] => Array.isArray(v) ? v : []

function limiteDiarioMeta(dados: Objeto): number | null {
  const bruto = dados.max_daily_conversations_per_business ??
    dados.max_daily_conversation_per_phone ?? dados.messaging_limit_tier
  const valor = String(bruto ?? '').trim().toUpperCase()
  const niveis: Record<string, number> = {
    TIER_250: 250,
    TIER_1K: 1_000,
    TIER_2K: 2_000,
    TIER_10K: 10_000,
    TIER_100K: 100_000,
    TIER_UNLIMITED: 1_000_000,
    UNLIMITED: 1_000_000,
    '-1': 1_000_000,
  }
  if (valor in niveis) return niveis[valor]
  if (!/^\d+$/.test(valor)) return null
  const numero = Number(valor)
  return Number.isSafeInteger(numero) && numero > 0 ? Math.min(numero, 1_000_000) : null
}

export function eventosMeta(corpo: unknown, waba: string, numero: string): EventoMeta[] {
  const raiz = objeto(corpo)
  if (raiz.object !== 'whatsapp_business_account') return []
  const eventos: EventoMeta[] = []
  for (const rawEntry of lista(raiz.entry)) {
    const entry = objeto(rawEntry)
    if (entry.id !== waba) continue
    for (const rawChange of lista(entry.changes)) {
      const change = objeto(rawChange), value = objeto(change.value)
      if (change.field !== 'messages' || objeto(value.metadata).phone_number_id !== numero) continue
      for (const raw of lista(value.messages)) {
        const m = objeto(raw)
        if (m.type === 'reaction') continue
        if (typeof m.id !== 'string' || !/^\d{6,16}$/.test(String(m.from)) || !dataMeta(m.timestamp)) continue
        eventos.push({ chave: `m:${m.id}`, numero_id: numero, externo: m.id, tipo: 'mensagem', dados: m })
      }
      for (const raw of lista(value.statuses)) {
        const s = objeto(raw)
        if (typeof s.id !== 'string' || !['sent','delivered','read','failed'].includes(String(s.status)) || !dataMeta(s.timestamp)) continue
        eventos.push({ chave: `s:${s.id}:${s.status}:${s.timestamp}`, numero_id: numero, externo: s.id, tipo: 'status', dados: s })
      }
    }
  }
  return eventos
}

/**
 * Eventos que não pertencem a uma mensagem individual.
 *
 * Eles ficam fora de `whatsapp_eventos_meta`: aquela fila tem leases e regras
 * próprias para mensagens recebidas/status. Mudanças de modelo e capacidade
 * são fatos idempotentes da conta e alimentam a pausa preventiva de campanhas.
 */
export function eventosContaMeta(corpo: unknown, waba: string, numero: string): EventoContaMeta[] {
  const raiz = objeto(corpo)
  if (raiz.object !== 'whatsapp_business_account') return []
  const eventos: EventoContaMeta[] = []
  for (const rawEntry of lista(raiz.entry)) {
    const entry = objeto(rawEntry)
    if (entry.id !== waba) continue
    for (const rawChange of lista(entry.changes)) {
      const change = objeto(rawChange), dados = objeto(change.value)
      const field = String(change.field ?? '')
      const tipo = field === 'message_template_status_update'
        ? 'modelo_status'
        : field === 'message_template_quality_update'
        ? 'modelo_qualidade'
        : field === 'business_capability_update'
        ? 'capacidade'
        : null
      if (!tipo) continue

      // Alguns payloads de capacidade trazem o número; os de template são do
      // WABA inteiro. Quando vier, ele nunca pode contaminar outra instalação.
      const eventoNumero = String(
        dados.phone_number_id ?? objeto(dados.metadata).phone_number_id ?? numero,
      )
      if (eventoNumero !== numero) continue
      const identidade = tipo === 'capacidade'
        ? `${dados.max_daily_conversations_per_business ?? dados.max_daily_conversation_per_phone ?? dados.messaging_limit_tier ?? ''}`
        : `${dados.message_template_id ?? dados.message_template_name ?? ''}:${dados.message_template_language ?? ''}`
      const mudanca = tipo === 'modelo_status'
        ? String(dados.event ?? dados.status ?? '')
        : tipo === 'modelo_qualidade'
        ? String(dados.new_quality_score ?? dados.quality_score ?? '')
        : JSON.stringify(dados)
      if (!identidade && tipo !== 'capacidade') continue
      const limiteDiario = tipo === 'capacidade' ? limiteDiarioMeta(dados) : null
      eventos.push({
        chave: `conta:${tipo}:${hashCurto(`${identidade}:${mudanca}:${dados.timestamp ?? ''}`)}`,
        numero_id: numero,
        tipo,
        modelo_id: tipo === 'capacidade' ? null : String(dados.message_template_id ?? '') || null,
        modelo_nome: tipo === 'capacidade' ? null : String(dados.message_template_name ?? '') || null,
        valor: mudanca || null,
        dados: limiteDiario === null ? dados : { ...dados, limite_diario: limiteDiario },
      })
    }
  }
  return eventos
}

/** Hash determinístico, só para chave de idempotência; não é usado em segurança. */
function hashCurto(valor: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < valor.length; i++) {
    hash ^= valor.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
export function dataMeta(timestamp: unknown): string | null {
  if (!/^\d+$/.test(String(timestamp))) return null
  const n = Number(timestamp) * 1000
  // Never let an implausible future event open a service window.
  return n > 0 && n <= Date.now() + 60_000 ? new Date(n).toISOString() : null
}
export function mensagemMeta(m: Record<string, unknown>): MensagemRecebida {
  const tipo = { text:'texto', audio:'audio', image:'imagem', video:'video', document:'documento' }[String(m.type)] ?? 'texto'
  const media = objeto(m[m.type as string])
  let texto = String(objeto(m.text).body ?? media.caption ?? '') || null
  if (m.type === 'button') texto = String(objeto(m.button).text ?? '') || '[Botão recebido]'
  else if (m.type === 'interactive') {
    const i = objeto(m.interactive)
    texto = String(objeto(i.button_reply ?? i.list_reply).title ?? '') || '[Resposta interativa]'
  } else if (!['text','audio','image','video','document'].includes(String(m.type))) texto = '[Tipo de mensagem não suportado; atendimento humano necessário]'
  return { whatsapp:String(m.from), idExterno:String(m.id), tipo, texto,
    midia: ['audio','image','video','document'].includes(String(m.type)) && typeof media.id === 'string' ? { via:'meta', id:media.id } : null }
}
export async function assinaturaValida(raw: string, assinatura: string | null, segredo: string): Promise<boolean> {
  if (!segredo || !assinatura || !/^sha256=[a-f0-9]{64}$/.test(assinatura)) return false
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(segredo),{name:'HMAC',hash:'SHA-256'},false,['verify'])
  const bytes = Uint8Array.from(assinatura.slice(7).match(/../g)!,h=>parseInt(h,16))
  return crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(raw))
}
export interface ModeloMeta {
  id: string; name: string; language: string; status: string; category?: string; parameter_format?: string
  quality_score?: { score?: string; date?: number } | string
  components: { type: string; format?: string; text?: string; buttons?: {type:string;url?:string;text?:string;phone_number?:string}[] }[]
}
export function camposModelo(m: ModeloMeta): {tipo:string; quantidade:number; texto:string}[] | null {
  if (m.status !== 'APPROVED' || m.parameter_format === 'NAMED' || m.category === 'AUTHENTICATION') return null
  const campos = []
  for (const c of m.components ?? []) {
    if (!['HEADER','BODY','FOOTER','BUTTONS'].includes(c.type)) return null
    if (c.type === 'HEADER' && c.format !== 'TEXT') return null
    if (c.type === 'BUTTONS') {
      if (c.buttons?.some(b=> !['QUICK_REPLY','URL','PHONE_NUMBER'].includes(b.type) || b.url?.includes('{{'))) return null
      continue
    }
    const texto = c.text ?? '', ids = [...texto.matchAll(/\{\{(\d+)\}\}/g)].map(x=>Number(x[1]))
    if (/\{\{[^\d]/.test(texto)) return null
    const quantidade = Math.max(0,...ids)
    if (quantidade > 20 || new Set(ids).size !== quantidade) return null
    campos.push({tipo:c.type.toLowerCase(),quantidade,texto})
  }
  return campos
}
export function preencherModelo(m: ModeloMeta, valores: Record<string,string[]>): {components: unknown[]; texto: string} {
  const campos = camposModelo(m)
  if (!campos) throw new Error('Este modelo ainda não é suportado. Use modelo de texto com parâmetros numéricos.')
  const components: unknown[] = [], textos: string[] = []
  for (const c of campos) {
    const itens = valores[c.tipo] ?? []
    if (!Array.isArray(itens) || itens.length !== c.quantidade || itens.some(v=>typeof v !== 'string' || !v.trim() || v.length > 1000)) throw new Error('Confira os parâmetros do modelo.')
    if (itens.length) components.push({type:c.tipo,parameters:itens.map(text=>({type:'text',text}))})
    textos.push(c.texto.replace(/\{\{(\d+)\}\}/g,(_,i)=>itens[Number(i)-1]))
  }
  return {components,texto:textos.join('\n')}
}

export interface ModeloCampanha {
  id: string
  nome: string
  idioma: string
  status: string
  categoria: string | null
  qualidade: string | null
  compativel: boolean
  motivo: string | null
  campos: { tipo: string; quantidade: number; texto: string }[]
  botoes: { tipo: string; texto?: string; url?: string }[]
  componentes: ModeloMeta['components']
}

/** Catálogo seguro para campanhas; criação/aprovação continua no WhatsApp Manager. */
export function descreverModeloCampanha(m: ModeloMeta): ModeloCampanha {
  return descreverModelo(m, 'MARKETING', 'A primeira versão de Campanhas aceita somente modelos de marketing.')
}

/**
 * Lembrete é mensagem de utilidade: existe um compromisso marcado por trás.
 * Usar marketing aqui gastaria o limite por usuário da Meta sem necessidade.
 */
export function descreverModeloLembrete(m: ModeloMeta): ModeloCampanha {
  return descreverModelo(m, 'UTILITY', 'O lembrete exige um modelo de utilidade aprovado na Meta.')
}

function descreverModelo(m: ModeloMeta, categoria: string, recusa: string): ModeloCampanha {
  const campos = camposModelo(m)
  let motivo: string | null = null
  if (m.status !== 'APPROVED') motivo = `Modelo ${m.status.toLowerCase()}; aguarde aprovação na Meta.`
  else if (m.category !== categoria) motivo = recusa
  else if (!campos) motivo = m.parameter_format === 'NAMED'
    ? 'Parâmetros nomeados ainda não são suportados em campanhas.'
    : 'Use um modelo de texto com parâmetros numéricos e botões estáticos.'
  const qualidade = typeof m.quality_score === 'string'
    ? m.quality_score
    : m.quality_score?.score ?? null
  if (!motivo && qualidade?.toUpperCase() === 'RED') motivo = 'A qualidade do modelo está crítica na Meta.'
  return {
    id: m.id,
    nome: m.name,
    idioma: m.language,
    status: m.status,
    categoria: m.category ?? '',
    qualidade,
    compativel: !motivo,
    motivo,
    campos: campos ?? [],
    botoes: (m.components ?? [])
      .filter((componente) => componente.type === 'BUTTONS')
      .flatMap((componente) => componente.buttons ?? [])
      .map((botao) => ({ tipo: botao.type, texto: botao.text, url: botao.url })),
    componentes: m.components ?? [],
  }
}
