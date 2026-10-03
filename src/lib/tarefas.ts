import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Tarefa } from './tarefasRegras'

export type { Tarefa } from './tarefasRegras'

/** A tarefa com o nome do contato, para a lista não precisar de uma leitura por linha. */
export interface TarefaComContato extends Tarefa { contato: { id: string; nome: string | null } | null }

const COLUNAS = 'id,titulo,detalhe,vence_em,contato_id,oportunidade_id,responsavel_id,origem,criada_por,concluida_em,concluida_por,created_at,contato:contatos_dados(id,nome)'
/** As concluídas ficam visíveis por uma semana: tempo de desfazer um clique sem virar histórico eterno. */
const DIAS_DE_CONCLUIDAS = 7
const LIMITE = 500

/**
 * As tarefas abertas (todas) e as concluídas na última semana. `contatoId` limita à ficha de uma pessoa.
 * Uma leitura só: uma instalação não chega perto do teto de 500 abertas, e se chegasse o excesso é problema de
 * processo, não de tela.
 */
export function useTarefas(contatoId?: string) {
  const [tarefas, setTarefas] = useState<TarefaComContato[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(false)
  const [versao, setVersao] = useState(0)

  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const corte = new Date(Date.now() - DIAS_DE_CONCLUIDAS * 86_400_000).toISOString()
        let q = supabase.from('tarefas').select(COLUNAS).or(`concluida_em.is.null,concluida_em.gte.${corte}`).order('vence_em').limit(LIMITE)
        if (contatoId) q = q.eq('contato_id', contatoId)
        const { data, error } = await q
        if (error) throw error
        if (!vivo) return
        // Defesa em profundidade: com `contatoId`, nunca mostramos tarefa de outra pessoa.
        setTarefas(((data ?? []) as unknown as TarefaComContato[]).filter((t) => !contatoId || t.contato_id === contatoId))
        setErro(false)
      } catch { if (vivo) setErro(true) }
      finally { if (vivo) setCarregando(false) }
    })()
    return () => { vivo = false }
  }, [contatoId, versao])

  const recarregar = useCallback(() => setVersao((v) => v + 1), [])
  return { tarefas, carregando, erro, recarregar }
}

export interface NovaTarefa {
  titulo: string
  /** ISO. */
  vence_em: string
  detalhe?: string | null
  contato_id?: string | null
  oportunidade_id?: string | null
  /** Vazio = quem cria (o banco decide). */
  responsavel_id?: string | null
}

export async function criarTarefa(t: NovaTarefa): Promise<void> {
  const { error } = await supabase.from('tarefas').insert({
    titulo: t.titulo.trim(), vence_em: t.vence_em, detalhe: t.detalhe?.trim() || null,
    contato_id: t.contato_id ?? null, oportunidade_id: t.oportunidade_id ?? null, responsavel_id: t.responsavel_id ?? null,
  })
  if (error) throw error
}

export async function concluirTarefa(id: string, feita = true): Promise<void> {
  const { error } = await supabase.rpc('tarefa_concluir', { p_id: id, p_feita: feita })
  if (error) throw error
}

export async function mudarPrazo(id: string, venceEm: string): Promise<void> {
  const { error } = await supabase.from('tarefas').update({ vence_em: venceEm }).eq('id', id)
  if (error) throw error
}

export async function trocarResponsavel(id: string, responsavel: string | null): Promise<void> {
  const { error } = await supabase.from('tarefas').update({ responsavel_id: responsavel }).eq('id', id)
  if (error) throw error
}

export async function apagarTarefa(id: string): Promise<void> {
  // Sem permissão, o banco não dá erro: só não apaga ninguém. Por isso conferimos quantas linhas saíram.
  const { data, error } = await supabase.from('tarefas').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Só quem criou a tarefa, o responsável ou o gestor pode apagá-la.')
}
