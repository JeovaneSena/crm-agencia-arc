/**
 * Campanhas: o que o servidor faz com a fila do banco (0010) e com o webhook da Meta. Só lógica: banco e Meta
 * entram por `DepsCampanhas`, para testar sem nada disso.
 *
 * A ordem de um envio é sempre a mesma, e cada passo é à prova de repetição no banco:
 *   reivindicar (lease) → modelo vivo da Meta confere → reservar (confere consentimento DE NOVO e grava a
 *   mensagem) → marcar chamada (ponto sem volta) → enviar → finalizar.
 * Depois de "marcar chamada", qualquer dúvida sobre o resultado vira INCERTO. Nunca reenvio automático.
 */
import { descreverModeloCampanha, eventosMeta, mensagemMeta, preencherModelo, type ModeloMeta } from './meta-protocolo.ts'
import { ErroMeta } from './meta-api.ts'
import { ehPedidoDeOptOut } from './optout.ts'

export interface Lote {
  destinatario_id: string; campanha_id: string; contato_id: string; whatsapp: string
  valores: Record<string, string[]>; lease_token: string
  modelo_id: string; modelo_nome: string; modelo_idioma: string; pedido_id: string; tentativas: number
}
export type Resultado = 'aceito' | 'retido' | 'falhou' | 'incerto' | 'repetir'

export interface DepsCampanhas {
  reivindicar(limite: number): Promise<Lote[]>
  /** O catálogo vivo da Meta, lido uma vez por execução. */
  modelos(): Promise<ModeloMeta[]>
  reservar(destinatarioId: string, token: string, texto: string): Promise<{ ok: true; mensagem_id: string } | { ok: false; motivo: string }>
  marcarChamada(destinatarioId: string, token: string): Promise<boolean>
  /** Lança `ErroMeta` se a Meta recusar ou se o resultado for incerto. */
  enviar(numero: string, nome: string, idioma: string, componentes: unknown[], correlacao: string): Promise<{ id: string; estado: 'aceito' | 'retido' }>
  finalizar(destinatarioId: string, token: string, resultado: Resultado, idExterno: string | null, erro: string | null, repetirEmSegundos: number | null): Promise<void>
  pausarCampanha(campanhaId: string, motivo: string): Promise<void>
  revogarConsentimento(contatoId: string, fonte: string): Promise<void>
}

/** O que fazer com um erro DEPOIS de a chamada ter começado. */
export function classificarErroEnvio(erro: unknown, tentativas = 1): { resultado: Resultado; erro: string; repetirEmSegundos?: number; revogar?: boolean } {
  if (erro instanceof ErroMeta) {
    if (erro.incerto) return { resultado: 'incerto', erro: 'A Meta não confirmou o envio. Confira se a mensagem saiu antes de tentar de novo.' }
    if (erro.repetivel) return { resultado: 'repetir', erro: 'Limite temporário da Meta; nova tentativa agendada.', repetirEmSegundos: Math.min(60 * 2 ** (Math.max(tentativas, 1) - 1), 900) }
    // 131050: a pessoa pediu à Meta para não receber marketing desta empresa. Respeitar para sempre.
    if (erro.codigo === 131050) return { resultado: 'falhou', erro: 'O contato optou por não receber mensagens de marketing.', revogar: true }
    return { resultado: 'falhou', erro: erro.message }
  }
  return { resultado: 'incerto', erro: 'Falha inesperada durante o envio; confira se a mensagem saiu.' }
}

/** O modelo que a Meta devolve agora, se ainda for o mesmo e continuar aprovado e compatível. */
function modeloVivo(catalogo: ModeloMeta[], l: Lote): { modelo: ModeloMeta } | { motivo: string } {
  const m = catalogo.find(x => x.id === l.modelo_id)
  if (!m) return { motivo: `O modelo "${l.modelo_nome}" não existe mais na Meta.` }
  if (m.name !== l.modelo_nome || m.language !== l.modelo_idioma) return { motivo: `O modelo "${l.modelo_nome}" mudou de nome ou idioma na Meta.` }
  const d = descreverModeloCampanha(m)
  if (!d.compativel) return { motivo: `O modelo "${l.modelo_nome}" não pode mais ser usado: ${d.motivo}` }
  return { modelo: m }
}

export interface ResumoLote { processados: number; aceitos: number; falhas: number; incertos: number; repetidos: number; ignorados: number; pausadas: number }

export async function processarLote(deps: DepsCampanhas, limite = 10): Promise<ResumoLote> {
  const r: ResumoLote = { processados: 0, aceitos: 0, falhas: 0, incertos: 0, repetidos: 0, ignorados: 0, pausadas: 0 }
  const lote = await deps.reivindicar(Math.max(1, Math.min(limite, 50)))
  if (!lote.length) return r
  let catalogo: ModeloMeta[] | null = null
  const pausadas = new Set<string>()

  for (const l of lote) {
    r.processados++
    try {
      // 1) o modelo vivo (se a Meta não responder, nada saiu: devolve à fila)
      try { catalogo ??= await deps.modelos() } catch {
        await deps.finalizar(l.destinatario_id, l.lease_token, 'repetir', null, 'Não consegui consultar os modelos na Meta.', 120); r.repetidos++; continue
      }
      const vivo = modeloVivo(catalogo, l)
      if ('motivo' in vivo) {
        if (!pausadas.has(l.campanha_id)) { await deps.pausarCampanha(l.campanha_id, vivo.motivo); pausadas.add(l.campanha_id); r.pausadas++ }
        await deps.finalizar(l.destinatario_id, l.lease_token, 'repetir', null, vivo.motivo, 3600); r.repetidos++; continue
      }
      // 2) texto e parâmetros (se não fecham com o modelo, é defeito do cadastro: falha este destinatário)
      let preenchido: { components: unknown[]; texto: string }
      try { preenchido = preencherModelo(vivo.modelo, l.valores) } catch (e) {
        await deps.finalizar(l.destinatario_id, l.lease_token, 'falhou', null, e instanceof Error ? e.message : 'Parâmetros do modelo inválidos.', null); r.falhas++; continue
      }
      // 3) reservar: o banco confere campanha e consentimento no último instante
      const reserva = await deps.reservar(l.destinatario_id, l.lease_token, preenchido.texto)
      if (!reserva.ok) { r.ignorados++; continue }   // o banco já deu o destino (fila, cancelado ou ignorado)
      // 4) ponto sem volta
      if (!(await deps.marcarChamada(l.destinatario_id, l.lease_token))) { r.ignorados++; continue }
      // 5) enviar
      try {
        const env = await deps.enviar(l.whatsapp, l.modelo_nome, l.modelo_idioma, preenchido.components, l.pedido_id)
        await deps.finalizar(l.destinatario_id, l.lease_token, env.estado, env.id, null, null); r.aceitos++
      } catch (e) {
        const c = classificarErroEnvio(e, l.tentativas)
        if (c.revogar) await deps.revogarConsentimento(l.contato_id, 'A Meta informou que o contato não quer receber marketing (erro 131050).').catch(() => {})
        await deps.finalizar(l.destinatario_id, l.lease_token, c.resultado, null, c.erro, c.repetirEmSegundos ?? null)
        if (c.resultado === 'falhou') r.falhas++; else if (c.resultado === 'incerto') r.incertos++; else r.repetidos++
      }
    } catch (e) {
      // Erro de banco no meio do caminho: a lease vence sozinha e a limpeza do banco decide (fila ou INCERTO).
      console.error('campanhas: falha ao processar um destinatário:', e instanceof Error ? e.message.slice(0, 120) : 'erro')
    }
  }
  return r
}

// ---------------------------------------------------------------------------
// Webhook da Meta: recibos de entrega e mensagens recebidas
// ---------------------------------------------------------------------------

/** Pedido inequívoco de parar de receber mensagem. A regra é a de `optout.ts`, a mesma do assistente. */
export const ehOptOut = ehPedidoDeOptOut

export interface DepsWebhook {
  status(idExterno: string, status: string, erro: string | null): Promise<boolean>
  /** O contato dono desta mensagem enviada (para o opt-out por recibo de falha). */
  contatoDaMensagem(idExterno: string): Promise<string | null>
  contatoPorWhatsapp(whatsapp: string): Promise<string | null>
  revogarConsentimento(contatoId: string, fonte: string): Promise<void>
  /** Grava a mensagem recebida na conversa (cria o contato se for novo). Idempotente por id da Meta. */
  gravarRecebida(whatsapp: string, idExterno: string, tipo: string, texto: string | null, referral?: unknown): Promise<void>
}

export async function tratarWebhook(deps: DepsWebhook, corpo: unknown, waba: string, numero: string): Promise<{ status: number; mensagens: number; optouts: number }> {
  const r = { status: 0, mensagens: 0, optouts: 0 }
  for (const ev of eventosMeta(corpo, waba, numero)) {
    if (ev.tipo === 'status') {
      const erros = Array.isArray(ev.dados.errors) ? ev.dados.errors as { code?: number; title?: string; message?: string }[] : []
      const texto = erros[0] ? String(erros[0].title ?? erros[0].message ?? 'Falha informada pela Meta.').slice(0, 300) : null
      await deps.status(ev.externo, String(ev.dados.status), texto)
      if (erros[0]?.code === 131050) {
        const contato = await deps.contatoDaMensagem(ev.externo)
        if (contato) { await deps.revogarConsentimento(contato, 'A Meta informou que o contato não quer receber marketing (erro 131050).'); r.optouts++ }
      }
      r.status++
      continue
    }
    const m = mensagemMeta(ev.dados)
    if (!m.idExterno) continue   // a Meta sempre manda; sem id não há como ser idempotente
    if (ehOptOut(m.texto)) {
      const contato = await deps.contatoPorWhatsapp(m.whatsapp)
      if (contato) { await deps.revogarConsentimento(contato, 'Pediu para parar de receber mensagens (resposta ao WhatsApp).'); r.optouts++ }
    }
    await deps.gravarRecebida(m.whatsapp, m.idExterno, m.tipo, m.texto, ev.dados.referral)
    r.mensagens++
  }
  return r
}
