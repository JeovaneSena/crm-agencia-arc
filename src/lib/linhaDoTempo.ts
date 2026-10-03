/**
 * A linha do tempo do contato: tudo o que aconteceu com ele, numa ordem só.
 *
 * Antes, o histórico morava em três lugares que não se falavam: as mudanças de etapa na
 * oportunidade aberta, as reuniões numa tabela, os avisos na Central. Quem abria a ficha
 * não via a história inteira, e "o que aconteceu com esta pessoa?" exigia abrir tudo.
 *
 * Esta função é PURA: recebe as linhas já lidas e devolve os eventos, do mais novo para o
 * mais velho. Quem lê do banco é o componente. Ideia adaptada do DeskcommCRM (MIT,
 * © 2026 Rafael Melgaço): timeline única do contato.
 */
export type TipoDeEvento = 'contato' | 'oportunidade' | 'reuniao' | 'aviso' | 'mensagem' | 'nota' | 'conversa' | 'tarefa'

export interface EventoDoTempo {
  id: string
  /** ISO. */
  quando: string
  tipo: TipoDeEvento
  titulo: string
  detalhe?: string
}

export interface EventoDeOportunidade { id: string; status_anterior: string | null; status_novo: string; motivo: string | null; created_at: string; oportunidade_nome: string }
export interface ReuniaoDoTempo { id: string; assunto: string; data_reuniao: string; status: 'agendada' | 'realizada' | 'cancelada' | 'faltou'; created_at: string; updated_at: string; cancelado_em: string | null; motivo_cancelamento: string | null }
export interface AvisoDoTempo { id: string; titulo: string; detalhe: string | null; criado_em: string; resolvido_em: string | null; resolucao: 'manual' | 'automatica' | null }

export interface NotaDoTempo { id: string; texto: string; created_at: string; autor_nome: string | null }
export interface EventoDeConversa { id: string; tipo: 'assumiu' | 'transferiu' | 'devolveu'; created_at: string; por_nome: string | null; para_nome: string | null }

/** Só as concluídas contam como história; as abertas ficam na seção Tarefas da ficha. */
export interface TarefaDoTempo { id: string; titulo: string; concluida_em: string | null; concluida_por_nome: string | null }

export interface EntradaDaLinha {
  contato: { id: string; created_at: string }
  eventos: EventoDeOportunidade[]
  reunioes: ReuniaoDoTempo[]
  avisos: AvisoDoTempo[]
  /** Só instalações com o módulo conversas. */
  notas?: NotaDoTempo[]
  conversaEventos?: EventoDeConversa[]
  tarefas?: TarefaDoTempo[]
  /** Última mensagem do cliente (só instalações com o módulo conversas). */
  ultimaMensagem?: string | null
  rotuloEtapa: (chave: string) => string
}

const ROTULO_REUNIAO = { realizada: 'Reunião realizada', cancelada: 'Reunião cancelada', faltou: 'Contato faltou à reunião' } as const
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const valido = (iso: string | null | undefined): iso is string => !!iso && Number.isFinite(Date.parse(iso))

export function montarLinhaDoTempo(e: EntradaDaLinha): EventoDoTempo[] {
  const saida: EventoDoTempo[] = []
  const add = (ev: EventoDoTempo) => { if (valido(ev.quando)) saida.push(ev) }

  add({ id: `contato-${e.contato.id}`, quando: e.contato.created_at, tipo: 'contato', titulo: 'Contato criado' })
  if (valido(e.ultimaMensagem)) add({ id: 'ultima-mensagem', quando: e.ultimaMensagem, tipo: 'mensagem', titulo: 'Última mensagem do cliente' })

  for (const v of e.eventos) {
    const para = e.rotuloEtapa(v.status_novo)
    add({
      id: `op-${v.id}`, quando: v.created_at, tipo: 'oportunidade',
      titulo: v.status_anterior ? `${v.oportunidade_nome}: ${e.rotuloEtapa(v.status_anterior)} → ${para}` : `${v.oportunidade_nome}: aberta em ${para}`,
      detalhe: v.motivo?.trim() || undefined,
    })
  }

  for (const r of e.reunioes) {
    add({ id: `reuniao-${r.id}`, quando: r.created_at, tipo: 'reuniao', titulo: `Reunião marcada: ${r.assunto}`, detalhe: `Para ${dataHora(r.data_reuniao)}` })
    if (r.status !== 'agendada') {
      add({
        id: `reuniao-${r.id}-fim`, quando: (r.status === 'cancelada' && valido(r.cancelado_em) ? r.cancelado_em : r.updated_at), tipo: 'reuniao',
        titulo: `${ROTULO_REUNIAO[r.status]}: ${r.assunto}`, detalhe: r.status === 'cancelada' ? r.motivo_cancelamento?.trim() || undefined : undefined,
      })
    }
  }

  for (const a of e.avisos) {
    add({ id: `aviso-${a.id}`, quando: a.criado_em, tipo: 'aviso', titulo: `Aviso: ${a.titulo}`, detalhe: a.detalhe ?? undefined })
    if (valido(a.resolvido_em)) add({ id: `aviso-${a.id}-fim`, quando: a.resolvido_em, tipo: 'aviso', titulo: `Aviso ${a.resolucao === 'automatica' ? 'resolvido sozinho' : 'dispensado'}: ${a.titulo}` })
  }

  for (const n of e.notas ?? []) {
    const texto = n.texto.trim().replace(/\s+/g, ' ')
    add({ id: `nota-${n.id}`, quando: n.created_at, tipo: 'nota', titulo: `Nota interna${n.autor_nome ? ` de ${n.autor_nome}` : ''}`, detalhe: texto.length > 160 ? `${texto.slice(0, 159)}…` : texto })
  }
  for (const c of e.conversaEventos ?? []) {
    const quem = c.por_nome ?? 'Alguém da equipe'
    const titulo = c.tipo === 'assumiu' ? `${quem} assumiu a conversa`
      : c.tipo === 'devolveu' ? `${quem} devolveu a conversa`
      : c.para_nome && c.para_nome !== quem ? `${quem} passou a conversa para ${c.para_nome}` : `${quem} assumiu a conversa`
    add({ id: `conversa-${c.id}`, quando: c.created_at, tipo: 'conversa', titulo })
  }

  for (const t of e.tarefas ?? []) {
    if (!valido(t.concluida_em)) continue
    add({ id: `tarefa-${t.id}`, quando: t.concluida_em, tipo: 'tarefa', titulo: `Tarefa concluída: ${t.titulo}`, detalhe: t.concluida_por_nome ? `Por ${t.concluida_por_nome}` : undefined })
  }

  // Mais novo primeiro; em empate, a ordem em que entraram (o id desempata, para não tremer entre renderizações).
  return saida.sort((x, y) => Date.parse(y.quando) - Date.parse(x.quando) || (x.id < y.id ? -1 : 1))
}
