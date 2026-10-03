import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import type { LeadStatus } from '../types'
import { ROTULO_LEAD, STATUS_LEAD, type EstiloStatus } from './statusLead'

/**
 * As etapas do funil, como a instalação as configurou (tabela `etapas_funil`).
 *
 * As 8 CHAVES são fixas (o banco tem triggers que dependem delas); rótulo, cor
 * e ordem são da equipe. Enquanto a tabela não carrega — ou se a leitura
 * falhar — valem os padrões de `statusLead.ts`, e a tela nunca fica sem nome.
 */

export type CorEtapa = 'accent' | 'info' | 'success' | 'warning' | 'purple' | 'danger'
export type TipoEtapa = 'aberta' | 'ganho' | 'perdido'

export interface Etapa {
  chave: LeadStatus
  rotulo: string
  cor: CorEtapa
  ordem: number
  tipo: TipoEtapa
  /** Horas de silêncio que esfriam um negócio nesta etapa (radar, migração 0021). Vazio = padrão do banco (48). */
  esfria_apos_horas: number | null
}

export const CORES_ETAPA: CorEtapa[] = ['accent', 'info', 'success', 'warning', 'purple', 'danger']

export function estiloDaEtapa(e: Pick<Etapa, 'cor' | 'tipo'>): EstiloStatus {
  if (e.tipo === 'ganho') return { bg: 'var(--success-solid)', color: 'var(--on-solid)' }
  return { bg: `var(--${e.cor}-soft)`, color: `var(--${e.cor})` }
}

const PADRAO: Etapa[] = [
  ['novo_lead', 'accent', 'aberta'], ['qualificacao', 'info', 'aberta'], ['diagnostico', 'success', 'aberta'],
  ['diagnostico_realizado', 'success', 'aberta'], ['proposta', 'warning', 'aberta'], ['negociacao', 'purple', 'aberta'],
  ['ganho', 'success', 'ganho'], ['perdido', 'danger', 'perdido'],
].map(([chave, cor, tipo], i) => ({ chave: chave as LeadStatus, rotulo: ROTULO_LEAD[chave as LeadStatus], cor: cor as CorEtapa, ordem: i + 1, tipo: tipo as TipoEtapa, esfria_apos_horas: null }))

let etapas: Etapa[] = PADRAO
let carregou = false
const ouvintes = new Set<() => void>()
const avisar = () => ouvintes.forEach(f => f())

export async function recarregarFunil() {
  const { data, error } = await supabase.from('etapas_funil').select('chave, rotulo, cor, ordem, tipo, esfria_apos_horas').order('ordem')
  if (error || !data?.length) return
  etapas = data as Etapa[]
  avisar()
}

function assinar(f: () => void) {
  ouvintes.add(f)
  return () => { ouvintes.delete(f) }
}

export interface Funil {
  etapas: Etapa[]
  /** Só as etapas em andamento, na ordem — as colunas do quadro. */
  abertas: Etapa[]
  rotulo: (chave: string) => string
  estilo: (chave: string) => EstiloStatus
}

export function useFunil(): Funil {
  const lista = useSyncExternalStore(assinar, () => etapas)
  useEffect(() => {
    if (carregou) return
    carregou = true
    void recarregarFunil()
  }, [])
  return {
    etapas: lista,
    abertas: lista.filter(e => e.tipo === 'aberta'),
    rotulo: chave => lista.find(e => e.chave === chave)?.rotulo ?? ROTULO_LEAD[chave as LeadStatus] ?? chave,
    estilo: chave => {
      const e = lista.find(x => x.chave === chave)
      return e ? estiloDaEtapa(e) : STATUS_LEAD[chave as LeadStatus] ?? { bg: 'var(--surface-subtle)', color: 'var(--muted)' }
    },
  }
}
