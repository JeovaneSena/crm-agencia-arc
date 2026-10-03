/**
 * Radar de quem esfriou (migração 0021): o que a tela faz com as linhas que o banco já classificou.
 *
 * A CLASSIFICAÇÃO (em risco, crítico, em voo) é do banco (`radar_negocios`), num lugar só, para a tela e o vigia
 * nunca discordarem. Aqui ficam só os rótulos e o agrupamento, sem navegador nem rede.
 *
 * Ideia adaptada do DeskcommCRM (MIT, © 2026 Rafael Melgaço): `lib/leads/risk-radar.ts`.
 */
export type FaixaDoRadar = 'critico' | 'em_risco' | 'em_voo'
export type Protecao = 'tarefa' | 'reuniao' | 'retomar'

export interface NegocioDoRadar {
  oportunidade_id: string
  contato_id: string
  contato_nome: string | null
  nome: string
  etapa: string
  valor_proposta: number | null
  responsavel_id: string | null
  ultima_atividade: string
  horas_parado: number
  esfria_apos_horas: number
  faixa: FaixaDoRadar
  protegido_por: Protecao | null
}

export const FAIXAS: FaixaDoRadar[] = ['critico', 'em_risco', 'em_voo']
export const ROTULO_FAIXA: Record<FaixaDoRadar, string> = { critico: 'Críticos', em_risco: 'Em risco', em_voo: 'Em voo' }
export const EXPLICA_FAIXA: Record<FaixaDoRadar, string> = {
  critico: 'Muito tempo sem atividade e sem próximo passo. Esses morrem primeiro.',
  em_risco: 'Esfriaram e não têm próximo passo combinado.',
  em_voo: 'Esfriaram, mas há um próximo passo a caminho (tarefa, reunião ou retomada).',
}
export const ROTULO_PROTECAO: Record<Protecao, string> = { tarefa: 'tem tarefa agendada', reuniao: 'tem reunião marcada', retomar: 'retomada combinada' }

/** "5 h", "há 3 dias" — o tempo sem atividade, por extenso e curto. */
export function rotuloParado(horas: number): string {
  const h = Math.max(0, Math.floor(horas))
  if (h < 48) return `${h} h`
  return `${Math.floor(h / 24)} dias`
}

/** Separa por faixa. Cada lista mantém a ordem recebida (o banco já entrega o mais frio primeiro). */
export function agruparRadar<T extends Pick<NegocioDoRadar, 'faixa'>>(negocios: T[]): Record<FaixaDoRadar, T[]> {
  const g: Record<FaixaDoRadar, T[]> = { critico: [], em_risco: [], em_voo: [] }
  for (const n of negocios) if (n.faixa in g) g[n.faixa].push(n)
  return g
}

export type FiltroDoRadar = 'meus' | 'todos' | 'sem_responsavel'

export function filtrarRadar<T extends Pick<NegocioDoRadar, 'responsavel_id'>>(negocios: T[], filtro: FiltroDoRadar, meuId: string | null | undefined): T[] {
  if (filtro === 'todos') return negocios
  if (filtro === 'sem_responsavel') return negocios.filter((n) => n.responsavel_id === null)
  return negocios.filter((n) => !!meuId && n.responsavel_id === meuId)
}

/** Dinheiro parado em cada faixa (só as propostas com valor): mostra o tamanho do que está esfriando. */
export function valorPorFaixa(negocios: Pick<NegocioDoRadar, 'faixa' | 'valor_proposta'>[]): Record<FaixaDoRadar, number> {
  const v: Record<FaixaDoRadar, number> = { critico: 0, em_risco: 0, em_voo: 0 }
  for (const n of negocios) if (n.faixa in v && typeof n.valor_proposta === 'number' && n.valor_proposta > 0) v[n.faixa] += n.valor_proposta
  return v
}
