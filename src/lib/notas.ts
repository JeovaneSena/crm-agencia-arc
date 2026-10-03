/**
 * Notas internas da conversa (tabela `notas_conversa`, migração 0014): anotações da equipe que NUNCA saem
 * para o WhatsApp. Ficam fora de `mensagens_whatsapp` de propósito: nenhum caminho de envio as lê.
 */
import { supabase } from './supabase'
import type { NotaConversa } from './conversaMesclada'

export type { NotaConversa } from './conversaMesclada'

export const LIMITE_DA_NOTA = 2000

export async function carregarNotas(contatoId: string): Promise<NotaConversa[]> {
  const { data, error } = await supabase.from('notas_conversa')
    .select('id,contato_id,texto,autor_id,created_at,autor:usuarios(nome)')
    .eq('contato_id', contatoId).order('created_at', { ascending: true }).limit(200)
  if (error) throw error
  // Defesa em profundidade: nunca mostra nota de outro contato, mesmo que a consulta venha larga.
  return ((data ?? []) as unknown as NotaConversa[]).filter((n) => n.contato_id === contatoId)
}

export async function criarNota(contatoId: string, texto: string, autorId: string): Promise<void> {
  const limpo = texto.trim()
  if (!limpo || limpo.length > LIMITE_DA_NOTA) throw new Error('nota_invalida')
  const { error } = await supabase.from('notas_conversa').insert({ contato_id: contatoId, texto: limpo, autor_id: autorId })
  if (error) throw error
}

export async function apagarNota(id: string): Promise<void> {
  const { error } = await supabase.from('notas_conversa').delete().eq('id', id)
  if (error) throw error
}
