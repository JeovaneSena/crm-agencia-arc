/** Ideia adaptada do DeskcommCRM (MIT, © 2026 Rafael Melgaço): lib/webhooks/inbound.ts.
 * Contrato da primeira versão: JSON ou formulário plano enviado pelo servidor do site.
 * Apenas campos conhecidos atravessam; nunca registra autorização de envio.
 */
export class ErroCaptacao extends Error {
  constructor(message: string, readonly status = 422) { super(message) }
}

export const CHAVES_UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const
export interface DadosCaptacao {
  nome: string | null
  whatsapp: string
  email: string | null
  empresa: string | null
  utm: Record<string, string>
}

export function prepararCaptacao(entrada: unknown): { dados: DadosCaptacao | null; motivo: string | null; evento: string | null } {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada))
    return { dados: null, motivo: 'formato_invalido', evento: null }
  const campos = Object.fromEntries(Object.entries(entrada).map(([k, v]) => [k.toLowerCase(), v]))
  const pega = (aliases: string[], max: number): string | null => {
    for (const chave of aliases) {
      const v = campos[chave]
      if (typeof v === 'string' && v.trim()) {
        if (v.trim().length > max) throw new ErroCaptacao('Campo acima do limite.')
        return v.trim()
      }
    }
    return null
  }
  let evento: string | null = null
  try {
    evento = pega(['id_externo', 'event_id'], 120)
    const bruto = pega(['whatsapp', 'telefone', 'phone', 'celular', 'tel'], 40) ?? ''
    let numero = bruto.replace(/\D/g, '').replace(/^0+/, '')
    if (!bruto.startsWith('+') && (numero.length === 10 || numero.length === 11)) numero = `55${numero}`
    if (!/^[1-9][0-9]{11,14}$/.test(numero)) return { dados: null, motivo: 'telefone_invalido', evento }
    const email = pega(['email', 'e-mail'], 254)?.toLowerCase() ?? null
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { dados: null, motivo: 'email_invalido', evento }
    const utm: Record<string, string> = {}
    for (const chave of CHAVES_UTM) { const v = pega([chave], 200); if (v) utm[chave] = v }
    return { dados: { nome: pega(['nome', 'name', 'full_name'], 200), whatsapp: numero,
      email, empresa: pega(['empresa', 'company'], 200), utm }, motivo: null, evento }
  } catch {
    return { dados: null, motivo: 'campo_longo', evento }
  }
}

export async function hashSegredo(segredo: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(segredo)))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export async function lerCaptacao(req: Request): Promise<unknown> {
  const tipo = req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  if (tipo !== 'application/json' && tipo !== 'application/x-www-form-urlencoded')
    throw new ErroCaptacao('Envie JSON ou formulário codificado.', 415)
  const leitor = req.body?.getReader()
  if (!leitor) throw new ErroCaptacao('Corpo vazio.', 400)
  const pedacos: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { value, done } = await leitor.read()
      if (done) break
      total += value.byteLength
      if (total > 16384) { await leitor.cancel(); throw new ErroCaptacao('Corpo acima de 16 KB.', 413) }
      pedacos.push(value)
    }
  } finally { leitor.releaseLock() }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const p of pedacos) { bytes.set(p, offset); offset += p.length }
  const texto = new TextDecoder().decode(bytes)
  if (tipo === 'application/x-www-form-urlencoded') return Object.fromEntries(new URLSearchParams(texto))
  try { return JSON.parse(texto) } catch { throw new ErroCaptacao('JSON inválido.', 400) }
}

type Resultado = { resultado: 'criado' | 'existente' | 'recusado' | 'nao_autorizado' | 'limite'; repetido?: boolean }
type ChamadaBanco = (nome: string, args: Record<string, unknown>) => Promise<Resultado>

export async function atenderCaptacao(req: Request, banco: ChamadaBanco): Promise<Response> {
  const responder = (status: number, corpo: unknown) => Response.json(corpo, { status })
  if (req.method !== 'POST') return responder(405, { ok: false, motivo: 'Use POST.' })
  const fonte = new URL(req.url).pathname.match(/\/captacao\/receber\/([0-9a-f-]{36})$/i)?.[1]
  if (!fonte || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(fonte)) return responder(404, { ok: false })
  const segredo = req.headers.get('x-captacao-segredo') ?? ''
  if (!/^[0-9a-f]{64}$/.test(segredo)) return responder(401, { ok: false, motivo: 'Fonte indisponível ou segredo inválido.' })
  try {
    const preparado = prepararCaptacao(await lerCaptacao(req))
    const r = await banco('captacao_receber', { p_fonte: fonte, p_hash: await hashSegredo(segredo),
      p_evento: preparado.evento, p_dados: preparado.dados, p_motivo: preparado.motivo })
    if (r.resultado === 'nao_autorizado') return responder(401, { ok: false, motivo: 'Fonte indisponível ou segredo inválido.' })
    if (r.resultado === 'limite') return responder(429, { ok: false, motivo: 'Limite da fonte atingido. Tente em um minuto.' })
    return responder(r.resultado === 'recusado' ? 422 : 200, { ok: r.resultado !== 'recusado', ...r })
  } catch (e) {
    if (e instanceof ErroCaptacao) return responder(e.status, { ok: false, motivo: e.message })
    // Nenhum dado ou segredo do formulário vai para o log.
    console.error('captacao: falha ao registrar o recebimento')
    return responder(503, { ok: false, motivo: 'Não foi possível registrar. Reenvie com o mesmo id_externo.' })
  }
}

/** Metadados mínimos: não guarda corpo do anúncio, mídia nem URLs externas. */
export function prepararOrigem(texto: string | null, referral: unknown): Record<string, unknown> | null {
  if (referral && typeof referral === 'object' && !Array.isArray(referral)) {
    const m = referral as Record<string, unknown>
    if ((m.source_type === 'ad' || m.source_type === 'post') && typeof m.source_id === 'string' && /^[0-9]{1,80}$/.test(m.source_id)) {
      const meta: Record<string, string> = { source_type: m.source_type, source_id: m.source_id }
      if (typeof m.ctwa_clid === 'string' && /^[a-zA-Z0-9_-]{1,512}$/.test(m.ctwa_clid)) meta.ctwa_clid = m.ctwa_clid
      return { canal: 'meta', meta }
    }
  }
  const ref = texto?.match(/\[ref:([a-zA-Z0-9_-]{3,64})\]/)?.[1]
  return ref ? { canal: 'referencia', referencia: ref } : null
}
