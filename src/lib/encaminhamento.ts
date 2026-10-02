import type { ConversaResumo } from '../types'

/**
 * Conversa que o assistente passou para a equipe (`chamar_equipe`): a IA parou, guardou um resumo
 * e espera alguém assumir. Vem direto da lista de conversas; não há fila separada.
 */
export interface Encaminhamento {
  contato_id: string
  resumo: string
  desde: string
}

/** Quem está esperando a equipe: encaminhada e ainda sem ninguém que a tenha assumido. */
export function encaminhamentos(conversas: ConversaResumo[]): Map<string, Encaminhamento> {
  const mapa = new Map<string, Encaminhamento>()
  for (const c of conversas) {
    if (c.ia_encaminhada_em && !c.assumida) mapa.set(c.contato_id, { contato_id: c.contato_id, resumo: c.ia_resumo ?? '', desde: c.ia_encaminhada_em })
  }
  return mapa
}

/** `12 min`, `3 h`, `2 d` — há quanto tempo a conversa espera. */
export function espera(iso: string): string {
  const minutos = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (minutos < 60) return `${minutos} min`
  if (minutos < 1440) return `${Math.round(minutos / 60)} h`
  return `${Math.round(minutos / 1440)} d`
}
