import { supabase } from './supabase'

/**
 * A baixa da consulta: compareceu ou faltou.
 *
 * ── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
 *
 * Marcar consulta é o começo; **dar baixa é o que fecha o funil**. É a baixa
 * que promove a pessoa de Contato a Cliente (`src/lib/pessoas.ts`), que
 * alimenta a conversão do Dashboard e que enche o histórico que o assistente lê
 * antes de responder.
 *
 * Sem ela, o cliente é atendido e continua em "Consulta Agendada" para
 * sempre. Por isso não basta existir um botão na Agenda: quem passa o dia em
 * Contatos e Clientes nunca abriria o calendário para lembrar. **O aviso vai
 * atrás da pessoa**, nas telas onde ela já está.
 *
 * ── O QUE CONTA COMO PENDENTE ──────────────────────────────────────────────
 *
 * Consulta ainda `agendada` cuja hora de TÉRMINO já passou. Usa `data_fim`, e
 * não `data_reuniao`: às 14h05 de uma consulta das 14h às 15h a recepcionista
 * ainda está com o cliente na cadeira, e cobrar baixa ali é ruído.
 *
 * Quem escreve o resultado no funil é o trigger `consultas_sincroniza_lead`
 * (migração 0015), no banco — não este arquivo. Aqui só se grava o status da
 * consulta; a promoção a Cliente é consequência, e é consequência ATÔMICA.
 */

/** Uma consulta que já terminou e ninguém confirmou. */
export interface ConsultaPendente {
  id: string
  contato_id: string
  assunto: string
  data_reuniao: string
  data_fim: string
  lead: { id: string; nome: string | null } | null
}

/**
 * As consultas esperando baixa, da mais antiga para a mais recente.
 *
 * A mais antiga primeiro de propósito: é a que corre risco de ninguém lembrar
 * mais se a pessoa apareceu ou não.
 *
 * @param leadId Sem ele, traz as de todo mundo (o aviso das telas de lista).
 *               Com ele, só as de uma pessoa (o painel da conversa).
 */
export async function listarConsultasPendentes(leadId?: string): Promise<ConsultaPendente[]> {
  let q = supabase
    .from('reunioes')
    .select('id, contato_id, assunto, data_reuniao, data_fim, lead:contatos_dados(id, nome)')
    .eq('status', 'agendada')
    .lt('data_fim', new Date().toISOString())
    .order('data_fim', { ascending: true })
    .limit(50)

  if (leadId) q = q.eq('contato_id', leadId)

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as unknown as ConsultaPendente[]
}

/**
 * Dá a baixa. `compareceu` decide entre `realizada` e `faltou`.
 *
 * Não grava `cancelado_em` na falta: quem não apareceu não cancelou nada, e
 * carimbar a coluna de cancelamento faria a falta se passar por desmarcação no
 * primeiro relatório que alguém escrevesse.
 */
export async function darBaixa(consultaId: string, compareceu: boolean): Promise<void> {
  const { error } = await supabase
    .from('reunioes')
    .update({ status: compareceu ? 'realizada' : 'faltou' })
    .eq('id', consultaId)

  if (error) throw error
}

/** `hoje, 14h` · `ontem, 9h30` · `28 ago, 14h` — sempre no passado. */
export function quandoPassou(iso: string): string {
  const d = new Date(iso)
  const hoje = new Date()
  const ontem = new Date()
  ontem.setDate(hoje.getDate() - 1)

  const mesmoDia = (a: Date, b: Date) =>
    a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()

  const min = d.getMinutes()
  const relogio = min === 0 ? `${d.getHours()}h` : `${d.getHours()}h${String(min).padStart(2, '0')}`

  if (mesmoDia(d, hoje)) return `hoje, ${relogio}`
  if (mesmoDia(d, ontem)) return `ontem, ${relogio}`

  const dia = d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '')
  return `${dia}, ${relogio}`
}
