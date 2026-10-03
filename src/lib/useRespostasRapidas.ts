import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { RespostaRapida } from './respostasRapidas'

/** As respostas que a pessoa enxerga (da equipe + as dela; o banco já filtra). Recarrega ao pedir. */
export function useRespostasRapidas() {
  const [respostas, setRespostas] = useState<RespostaRapida[]>([])
  const [versao, setVersao] = useState(0)
  const [erro, setErro] = useState(false)
  useEffect(() => {
    let vivo = true
    void Promise.resolve(supabase.from('respostas_rapidas').select('id,titulo,texto,atalho,dono_id').order('titulo')).then(({ data, error }) => {
      if (!vivo) return
      setErro(!!error)
      if (!error) setRespostas((data ?? []) as RespostaRapida[])
    })
    return () => { vivo = false }
  }, [versao])
  const recarregar = useCallback(() => setVersao((v) => v + 1), [])
  return { respostas, erro, recarregar }
}
