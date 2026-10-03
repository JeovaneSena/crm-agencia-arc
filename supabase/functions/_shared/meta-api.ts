/**
 * Cliente da API oficial da Meta (WhatsApp Cloud) só do que o módulo CAMPANHAS usa: listar os modelos
 * aprovados, enviar um modelo e olhar o estado do número. Credenciais só nas secrets da função.
 *
 * ⚠️ A distinção que importa aqui é entre "a Meta recusou" (nada saiu, pode tratar como falha) e "não sei se
 * saiu" (timeout, 5xx): esta última é `incerto` e NUNCA vira reenvio automático.
 */
import type { ModeloMeta } from './meta-protocolo.ts'

export const metaConfig = () => ({
  token: Deno.env.get('META_ACCESS_TOKEN') ?? '', appSecret: Deno.env.get('META_APP_SECRET') ?? '',
  verify: Deno.env.get('META_VERIFY_TOKEN') ?? '', numero: Deno.env.get('META_PHONE_NUMBER_ID') ?? '',
  waba: Deno.env.get('META_WABA_ID') ?? '', versao: Deno.env.get('META_GRAPH_VERSION') ?? '',
})

export function metaConfigurada(): boolean {
  const c = metaConfig()
  return !!(c.token && c.appSecret && c.verify && /^\d+$/.test(c.numero) && /^\d+$/.test(c.waba) && /^v\d+\.\d+$/.test(c.versao))
}

export class ErroMeta extends Error {
  constructor(
    message: string,
    public incerto = false,
    public codigo: number | null = null,
    public httpStatus: number | null = null,
    public repetivel = false,
  ) { super(message) }
}

export async function graph<T>(caminho: string, corpo?: Record<string, unknown>, metodo?: 'DELETE'): Promise<T> {
  const c = metaConfig()
  if (!/^v\d+\.\d+$/.test(c.versao) || !c.token) throw new ErroMeta('Configure as credenciais e a versão da API Meta no servidor.')
  let r: Response
  try {
    r = await fetch(`https://graph.facebook.com/${c.versao}/${caminho}`, {
      method: metodo ?? (corpo ? 'POST' : 'GET'),
      headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
      body: corpo && metodo !== 'DELETE' ? JSON.stringify(corpo) : undefined, signal: AbortSignal.timeout(20_000),
    })
  } catch { throw new ErroMeta('A Meta não confirmou o envio. Confira o histórico antes de tentar novamente.', !!corpo) }
  const dados = await r.json().catch(() => null)
  if (!r.ok) {
    const codigo = Number(dados?.error?.code ?? r.status)
    const incerto = r.status >= 500 && (!!corpo || metodo === 'DELETE')
    // Só limitação explícita é repetível; qualquer outra recusa é definitiva.
    const repetivel = !incerto && !!corpo && (r.status === 429 || [4, 80007, 130429].includes(codigo))
    throw new ErroMeta(`A Meta recusou a solicitação (código ${codigo}). Confira credenciais, permissões e situação do número.`, incerto, codigo, r.status, repetivel)
  }
  if (!dados) throw new ErroMeta('Resposta inválida da Meta.', !!corpo)
  return dados as T
}

/** Envia um modelo aprovado. `aceito` = a Meta recebeu; `retido` = recebeu mas segurou (nunca repetir). */
export async function enviarModelo(
  numero: string, nome: string, idioma: string, componentes: unknown[], correlacao: string,
): Promise<{ id: string; estado: 'aceito' | 'retido'; resposta: string }> {
  const r = await graph<{ messages?: { id: string; message_status?: string }[] }>(`${metaConfig().numero}/messages`, {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: numero, type: 'template',
    template: { name: nome, language: { code: idioma }, components: componentes }, biz_opaque_callback_data: correlacao,
  })
  if (!r.messages?.[0]?.id) throw new ErroMeta('A Meta não confirmou o identificador da mensagem.', true)
  // Ausência do campo = aceito. Qualquer estado presente que não seja `accepted` é conservado como retido.
  const resposta = r.messages[0].message_status || 'accepted'
  return { id: r.messages[0].id, estado: resposta === 'accepted' ? 'aceito' : 'retido', resposta }
}

export async function modelosMeta(): Promise<ModeloMeta[]> {
  const todos: ModeloMeta[] = []
  let depois = ''
  for (let pagina = 0; pagina < 20; pagina++) {
    const r = await graph<{ data: ModeloMeta[]; paging?: { next?: string; cursors?: { after?: string } } }>(
      `${metaConfig().waba}/message_templates?fields=id,name,language,status,category,parameter_format,quality_score,rejected_reason,components&limit=100${depois ? '&after=' + encodeURIComponent(depois) : ''}`)
    todos.push(...r.data)
    if (!r.paging?.next) return todos
    depois = r.paging.cursors?.after ?? ''
    if (!depois) throw new ErroMeta('Não foi possível completar a lista de modelos.')
  }
  throw new ErroMeta('Catálogo de modelos excede o limite desta instalação.')
}

/** O número como a Meta o mostra, sem nenhuma chave. */
export async function estadoDoNumero(): Promise<{ numero: string | null; nome: string | null; qualidade: string | null; limite: string | null }> {
  const r = await graph<{ display_phone_number?: string; verified_name?: string; quality_rating?: string; messaging_limit_tier?: string }>(
    `${metaConfig().numero}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier`)
  return { numero: r.display_phone_number ?? null, nome: r.verified_name ?? null, qualidade: r.quality_rating ?? null, limite: r.messaging_limit_tier ?? null }
}

/** Cria um modelo na conta da Meta. Fica `PENDING` até a Meta aprovar (de minutos a horas). */
export async function criarModeloMeta(corpo: Record<string, unknown>): Promise<{ id: string; status: string }> {
  const r = await graph<{ id?: string; status?: string }>(`${metaConfig().waba}/message_templates`, corpo)
  if (!r.id) throw new ErroMeta('A Meta não devolveu o identificador do modelo. Confira a lista antes de tentar de novo.', true)
  return { id: r.id, status: r.status ?? 'PENDING' }
}

/** Apaga TODAS as línguas do modelo de mesmo nome. Não tem volta, e o nome só pode ser reaproveitado depois de um tempo. */
export async function apagarModeloMeta(nome: string): Promise<void> {
  await graph<{ success?: boolean }>(`${metaConfig().waba}/message_templates?name=${encodeURIComponent(nome)}`, {}, 'DELETE')
}
