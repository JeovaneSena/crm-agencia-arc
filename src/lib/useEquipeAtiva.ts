import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface MembroAtivo { id: string; nome: string }

/** As pessoas ativas da equipe (para transferir conversa e atribuir responsável). */
export function useEquipeAtiva(): MembroAtivo[] {
  const [equipe, setEquipe] = useState<MembroAtivo[]>([])
  useEffect(() => {
    let vivo = true
    void Promise.resolve(supabase.from('usuarios').select('id,nome').eq('ativo', true).order('nome')).then(({ data, error }) => {
      if (vivo && !error) setEquipe(((data ?? []) as MembroAtivo[]).filter((m) => m.nome?.trim()))
    })
    return () => { vivo = false }
  }, [])
  return equipe
}

/** O nome de TODA a equipe, inclusive quem foi desligado: serve para mostrar de quem era algo, não para escolher. */
export function useNomesDaEquipe(): Map<string, string> {
  const [nomes, setNomes] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    let vivo = true
    void Promise.resolve(supabase.from('usuarios').select('id,nome')).then(({ data, error }) => {
      if (vivo && !error) setNomes(new Map(((data ?? []) as MembroAtivo[]).map((u) => [u.id, u.nome?.trim() || 'Sem nome'])))
    })
    return () => { vivo = false }
  }, [])
  return nomes
}
