import type { LeadStatus, ReuniaoStatus } from '../types'

/**
 * As cores e os rótulos do status de um lead.
 *
 * **Cor de status não é cor de marca.** Ela comunica significado — verde é
 * consulta marcada, vermelho é cancelada — e não muda junto com a identidade
 * visual da empresa.
 *
 * ⚠️ ESTE ARQUIVO É A FONTE, MAS AINDA NÃO É A ÚNICA. O mesmo mapa está
 * repetido em `CRM.tsx` (como array, que também define a ordem das colunas do
 * Kanban), em `Dashboard.tsx` (com rótulos curtos, que cabem no gráfico) e em
 * `PessoasPage.tsx` / `LeadDetail.tsx` (idênticos a este). Unificar os quatro
 * exige decidir o que fazer com os rótulos curtos — e isso é tarefa própria,
 * não um efeito colateral. Enquanto isso: **código novo importa daqui.**
 *
 * Os valores precisam bater com o `CHECK` de `contatos_dados.status` e com
 * `LeadStatus` em `src/types/index.ts`. Nada sincroniza isso sozinho.
 */

export interface EstiloStatus {
  bg: string
  color: string
  /** Pisca. Só o lead recém-chegado, que é quem pede atenção. */
  pulse?: boolean
}

export const STATUS_LEAD: Record<LeadStatus, EstiloStatus> = {
  novo_lead: { bg: 'var(--accent-soft)', color: 'var(--accent)', pulse: true },
  qualificacao: { bg: 'var(--info-soft)', color: 'var(--info)' },
  diagnostico: { bg: 'var(--success-soft)', color: 'var(--success)' },
  diagnostico_realizado: { bg: 'var(--success-soft)', color: 'var(--success)' },
  proposta: { bg: 'var(--warning-soft)', color: 'var(--warning)' },
  negociacao: { bg: 'var(--purple-soft)', color: 'var(--purple)' },
  ganho: { bg: 'var(--success-solid)', color: 'var(--on-solid)' },
  perdido: { bg: 'var(--danger-soft)', color: 'var(--danger)' },
}

export const ROTULO_LEAD: Record<LeadStatus, string> = {
  novo_lead: 'Novo lead',
  qualificacao: 'Qualificação',
  diagnostico: 'Diagnóstico',
  diagnostico_realizado: 'Diagnóstico realizado',
  proposta: 'Proposta',
  negociacao: 'Negociação',
  ganho: 'Ganho',
  perdido: 'Perdido',
}

export const ETAPAS_COMERCIAIS: LeadStatus[] = ['novo_lead', 'qualificacao', 'diagnostico', 'diagnostico_realizado', 'proposta', 'negociacao', 'ganho', 'perdido']

export const STATUS_CONSULTA: Record<ReuniaoStatus, EstiloStatus> = {
  agendada:  { bg: 'var(--success-soft)', color: 'var(--success)' },
  realizada: { bg: 'var(--success-solid)', color: 'var(--on-solid)' },
  cancelada: { bg: 'var(--danger-soft)', color: 'var(--danger)' },
  // Falta é âmbar, não vermelha: o vermelho já é cancelamento, e as duas
  // precisam se separar de longe — é a distinção que a 0015 existe para
  // preservar.
  faltou:    { bg: 'var(--warning-soft)', color: 'var(--warning)' },
}

export const ROTULO_CONSULTA: Record<ReuniaoStatus, string> = {
  agendada:  'Agendada',
  realizada: 'Realizada',
  cancelada: 'Cancelada',
  faltou:    'Faltou',
}
