/**
 * O período que os filtros de Dashboard, Leads e Clientes recortam.
 *
 * ── POR QUE ISTO SAIU DAS PÁGINAS ──────────────────────────────────────────
 *
 * [`Dashboard.tsx`](../pages/Dashboard.tsx) e
 * [`PessoasPage.tsx`](../components/PessoasPage.tsx) tinham **a mesma**
 * `getPeriodRange` — palavra por palavra, e já com formatação diferente uma da
 * outra, que é como duas cópias começam a divergir. As três telas respondem
 * "quantos no mês passado?" e precisam responder igual.
 *
 * ⚠️ **Os nomes aqui estão em inglês**, ao contrário do resto de `src/lib/`.
 * É código **mudado de lugar**, não reescrito: renomear na mesma mexida faria
 * o diff parecer uma reescrita e esconderia que o comportamento é idêntico.
 */

export type PeriodKey =
  | 'today' | 'yesterday' | 'last7' | 'last14'
  | 'this_month' | 'last_month' | 'this_year' | 'last_year'
  | 'all' | 'custom'
  /**
   * Um mês fechado, `month:AAAA-MM`. **A chave carrega o mês de verdade**, e
   * não "dois meses atrás": guardada numa URL ou num estado, uma chave
   * relativa apontaria para outro mês no dia seguinte.
   */
  | `month:${string}`

export interface DateRange { start: Date; end: Date }

const NOMES_MES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

/**
 * Os períodos prontos, na ordem em que aparecem na lista.
 *
 * **`custom` não está aqui, de propósito.** Ele não é um período: é um modo.
 * Dentro da lista, escolher "Personalizado" fechava a lista e obrigava a abrir
 * de novo para ver o que tinha sido escolhido — e a lista passava a mostrar uma
 * palavra que não diz de quando até quando. Na tela ele é um botão ao lado, com
 * as datas do lado dele.
 *
 * ── POR QUE ISTO VIROU FUNÇÃO ──────────────────────────────────────────────
 *
 * Por causa dos três meses fechados no meio da lista (*Julho*, *Junho*,
 * *Maio*): eles dependem de que dia é hoje. Como constante, a lista seria
 * montada uma vez quando o módulo carrega e ficaria **presa no mês em que a
 * aba foi aberta** — quem deixa o sistema aberto viraria o mês vendo os meses
 * errados.
 *
 * ⚠️ Ela lê o relógio, então **não chame durante a renderização**: use
 * `useState(() => periodosFixos())`. O `react-hooks/purity` reprova, com razão.
 */
export function periodosFixos(hoje: Date = new Date()): { chave: PeriodKey; rotulo: string }[] {
  const meses: { chave: PeriodKey; rotulo: string }[] = []
  // 2, 3 e 4 meses atrás — o de 1 mês atrás já é o "Mês passado" acima.
  for (let i = 2; i <= 4; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    meses.push({
      chave: `month:${d.getFullYear()}-${mm}`,
      // O ano só aparece quando não é o corrente: em janeiro, "Novembro" sem
      // ano ao lado de "Este ano" faria pensar que é novembro deste ano.
      rotulo: d.getFullYear() === hoje.getFullYear()
        ? NOMES_MES[d.getMonth()]
        : `${NOMES_MES[d.getMonth()]} de ${d.getFullYear()}`,
    })
  }

  return [
    { chave: 'today', rotulo: 'Hoje' },
    { chave: 'yesterday', rotulo: 'Ontem' },
    { chave: 'last7', rotulo: 'Últimos 7 dias' },
    { chave: 'last14', rotulo: 'Últimos 14 dias' },
    { chave: 'this_month', rotulo: 'Este mês' },
    { chave: 'last_month', rotulo: 'Mês passado' },
    ...meses,
    { chave: 'this_year', rotulo: 'Este ano' },
    { chave: 'last_year', rotulo: 'Ano passado' },
    // Por último porque é o mais largo, e porque é o que menos se escolhe nas
    // telas de relatório. No CRM ele é o padrão — lá a pergunta é outra.
    { chave: 'all', rotulo: 'Todo o período' },
  ]
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
}

export function getPeriodRange(key: PeriodKey, custom?: DateRange): DateRange {
  const now = new Date()
  const today = startOfDay(now)

  // `month:AAAA-MM` — um mês fechado, do dia 1 ao último. O dia 0 do mês
  // seguinte é o último do mês pedido, e o Date resolve virada de ano sozinho.
  if (key.startsWith('month:')) {
    const [ano, mes] = key.slice(6).split('-').map(Number)
    if (Number.isFinite(ano) && Number.isFinite(mes)) {
      return {
        start: new Date(ano, mes - 1, 1),
        end: endOfDay(new Date(ano, mes, 0)),
      }
    }
  }

  switch (key) {
    case 'today':
      return { start: today, end: endOfDay(now) }
    case 'yesterday': {
      const y = new Date(today); y.setDate(y.getDate() - 1)
      return { start: y, end: endOfDay(y) }
    }
    case 'last7': {
      const s = new Date(today); s.setDate(s.getDate() - 6)
      return { start: s, end: endOfDay(now) }
    }
    case 'last14': {
      const s = new Date(today); s.setDate(s.getDate() - 13)
      return { start: s, end: endOfDay(now) }
    }
    case 'this_month':
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: endOfDay(now) }
    case 'last_month': {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const e = new Date(now.getFullYear(), now.getMonth(), 0)
      return { start: s, end: endOfDay(e) }
    }
    case 'this_year':
      return { start: new Date(now.getFullYear(), 0, 1), end: endOfDay(now) }
    case 'last_year': {
      const s = new Date(now.getFullYear() - 1, 0, 1)
      const e = new Date(now.getFullYear() - 1, 11, 31)
      return { start: s, end: endOfDay(e) }
    }
    // Começa na origem do tempo em vez de num "sem filtro": assim quem usa
    // este módulo continua tendo SEMPRE uma faixa, e nenhuma tela precisa de um
    // caminho especial para "não filtrar".
    case 'all':
      return { start: new Date(0), end: endOfDay(now) }
    case 'custom':
      return custom ?? { start: today, end: endOfDay(now) }
    default:
      return { start: today, end: endOfDay(now) }
  }
}

export function inRange(dateStr: string | null, range: DateRange): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr)
  return d >= range.start && d <= range.end
}
