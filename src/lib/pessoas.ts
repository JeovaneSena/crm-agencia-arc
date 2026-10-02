import type { LeadStatus } from '../types'

/** O status do contato é um resumo mantido pelo banco. Ganho identifica
 * histórico de cliente, mesmo quando uma nova oportunidade está em negociação.
 * As etapas de cada venda pertencem exclusivamente a oportunidades. */
export const PATIENT_STATUS: LeadStatus[] = ['ganho']

export function isCliente(status: LeadStatus) {
  return PATIENT_STATUS.includes(status)
}
