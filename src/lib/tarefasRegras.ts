/**
 * Tarefas (migração 0020): as regras que não precisam de navegador nem de banco.
 *
 * Quem decide o que é "vencida" aqui é só a tela; o servidor usa a mesma definição (aberta com prazo no passado)
 * em `tarefas_vencidas_por_responsavel`. Todas as funções recebem o "agora" por parâmetro, para o teste não
 * depender do relógio. Os dias valem no fuso do navegador, que é o da equipe.
 *
 * Ideia adaptada do DeskcommCRM (MIT, © 2026 Rafael Melgaço): `lib/tarefas`.
 */
export interface Tarefa {
  id: string
  titulo: string
  detalhe: string | null
  vence_em: string
  contato_id: string | null
  oportunidade_id: string | null
  responsavel_id: string | null
  origem: 'manual' | 'sistema'
  criada_por: string | null
  concluida_em: string | null
  concluida_por: string | null
  created_at: string
}

export type GrupoDeTarefa = 'vencidas' | 'hoje' | 'proximas'
export const ROTULO_GRUPO: Record<GrupoDeTarefa, string> = { vencidas: 'Vencidas', hoje: 'Hoje', proximas: 'Próximas' }

export const TITULO_MAXIMO = 200

const inicioDoDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const DIA_MS = 86_400_000
/** Dias de calendário entre duas datas (não de 24 h: respeita a virada do horário de verão). */
const diasEntre = (de: Date, ate: Date) => Math.round((inicioDoDia(ate).getTime() - inicioDoDia(de).getTime()) / DIA_MS)
const hhmm = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
const valida = (iso: string) => Number.isFinite(Date.parse(iso))

/** Vencida: o prazo já passou, mesmo que seja de hoje. Hoje: ainda vai vencer hoje. Próximas: de amanhã em diante. */
export function grupoDaTarefa(venceEm: string, agora: Date): GrupoDeTarefa {
  const v = new Date(venceEm)
  if (v.getTime() < agora.getTime()) return 'vencidas'
  return diasEntre(agora, v) === 0 ? 'hoje' : 'proximas'
}

/** Só as abertas, separadas em grupos, cada uma com a mais urgente primeiro. Tarefa com data inválida é ignorada. */
export function agruparTarefas<T extends Tarefa>(tarefas: T[], agora: Date): Record<GrupoDeTarefa, T[]> {
  const g: Record<GrupoDeTarefa, T[]> = { vencidas: [], hoje: [], proximas: [] }
  for (const t of tarefas) {
    if (t.concluida_em || !valida(t.vence_em)) continue
    g[grupoDaTarefa(t.vence_em, agora)].push(t)
  }
  for (const lista of Object.values(g)) lista.sort((a, b) => Date.parse(a.vence_em) - Date.parse(b.vence_em) || a.created_at.localeCompare(b.created_at))
  return g
}

/** "venceu há 3 dias", "hoje às 14:00", "amanhã às 09:00", "qui., 09/10 às 09:00". */
export function rotuloDoPrazo(venceEm: string, agora: Date): string {
  if (!valida(venceEm)) return 'sem prazo válido'
  const v = new Date(venceEm)
  const dias = diasEntre(v, agora) // positivo quando o prazo ficou para trás
  if (v.getTime() < agora.getTime()) {
    if (dias <= 0) return `venceu hoje às ${hhmm(v)}`
    return dias === 1 ? 'venceu ontem' : `venceu há ${dias} dias`
  }
  if (dias === 0) return `hoje às ${hhmm(v)}`
  if (dias === -1) return `amanhã às ${hhmm(v)}`
  return `${v.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })} às ${hhmm(v)}`
}

export interface PrazoRapido { chave: string; rotulo: string; data: Date }

const as9 = (base: Date, somarDias: number) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + somarDias, 9, 0, 0, 0)

/** Atalhos de prazo a partir de agora. "Hoje" só existe enquanto ainda dá tempo (até 17h → 18h). */
export function prazosRapidos(agora: Date): PrazoRapido[] {
  const lista: PrazoRapido[] = []
  const hoje18 = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 18, 0, 0, 0)
  if (hoje18.getTime() - agora.getTime() >= 60 * 60_000) lista.push({ chave: 'hoje', rotulo: 'Hoje, 18h', data: hoje18 })
  lista.push({ chave: 'amanha', rotulo: 'Amanhã, 9h', data: as9(agora, 1) })
  lista.push({ chave: 'tres-dias', rotulo: 'Em 3 dias, 9h', data: as9(agora, 3) })
  // Próxima segunda-feira (se hoje é segunda, a de daqui a 7 dias).
  const ateSegunda = ((8 - agora.getDay()) % 7) || 7
  lista.push({ chave: 'semana', rotulo: 'Semana que vem, 9h', data: as9(agora, ateSegunda) })
  return lista
}

/** Para o `<input type="datetime-local">`: "2026-10-09T09:00" no horário do navegador. */
export function paraCampoDeData(d: Date): string {
  const dois = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}T${dois(d.getHours())}:${dois(d.getMinutes())}`
}

/** Do campo de data para ISO (UTC); `null` se estiver vazio ou inválido. */
export function doCampoDeData(valor: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(valor)) return null
  const d = new Date(valor)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

/** Mensagem de erro para quem tenta criar, ou `null` se está tudo certo. */
export function validarNovaTarefa(titulo: string, prazo: string): string | null {
  const t = titulo.trim()
  if (!t) return 'Escreva o que precisa ser feito.'
  if (t.length > TITULO_MAXIMO) return `O título passa de ${TITULO_MAXIMO} caracteres.`
  if (!doCampoDeData(prazo)) return 'Escolha o prazo.'
  return null
}

/** As vencidas de uma lista (qualquer pessoa), para o selo da barra lateral e do painel. */
export function contarVencidas(tarefas: Pick<Tarefa, 'vence_em' | 'concluida_em' | 'responsavel_id'>[], agora: Date, responsavel?: string | null): number {
  return tarefas.filter((t) => !t.concluida_em && valida(t.vence_em) && Date.parse(t.vence_em) < agora.getTime()
    && (responsavel === undefined || t.responsavel_id === responsavel)).length
}
