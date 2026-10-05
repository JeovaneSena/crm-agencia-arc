import { supabase } from './supabase'
import type { LeadStatus } from '../types'

export interface Oportunidade {
  fechamento_previsto?: string | null
  id: string; contato_id: string; nome: string; status: LeadStatus
  valor_proposta: number | null; servicos_contratados: string[]; escopo: string
  fechado_em: string | null; cancelado_em: string | null; motivo_cancelamento: string | null
  created_at: string; updated_at: string
  /** Quem responde pela venda (migração 0018). Nulo = sem responsável. */
  motivo_perda: string | null; retomar_em: string | null
  campos_custom: import('./camposRegras').ValoresCampos
  responsavel_id: string | null
  contato: { nome: string | null; empresa: string | null; whatsapp: string | null } | null
}
export const SELECT_OPORTUNIDADE = '*, contato:contatos_dados(nome,empresa,whatsapp)'
export async function listarOportunidades(leadId?: string) {
  const lista: Oportunidade[] = []
  for (let inicio = 0; ; inicio += 500) {
    let q = supabase.from('oportunidades').select(SELECT_OPORTUNIDADE).order('created_at', { ascending: false }).order('id').range(inicio, inicio + 499)
    if (leadId) q = q.eq('contato_id', leadId)
    const { data, error } = await q
    if (error) throw error
    lista.push(...data as unknown as Oportunidade[])
    if (data.length < 500) return lista
  }
}
export function erroOportunidade(error: { message?: string } | null) {
  if (!error) return 'A oportunidade mudou em outra sessão. Atualize e tente novamente.'
  if (/Informe o valor|Escolha serviços|Venda encerrada|Para cancelar|nova compra|Campos obrigatórios|Valor inválido|motivo de perda|quando retomar|Campo arquivado/i.test(error.message ?? '')) return error.message!
  return 'Não foi possível salvar a oportunidade. Atualize e tente novamente.'
}

export const moeda = (valor: number | null) => valor == null ? 'Valor a definir' : Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
