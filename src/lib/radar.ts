import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { NegocioDoRadar } from './radarRegras'

export type { NegocioDoRadar } from './radarRegras'

/**
 * Os negócios que esfriaram, já classificados pelo banco (`radar_negocios`, migração 0021) e na ordem de triagem:
 * críticos, em risco, em voo; dentro de cada faixa, o mais frio primeiro. A equipe vê o que já vê nas oportunidades.
 */
export function useRadar() {
  const [negocios, setNegocios] = useState<NegocioDoRadar[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(false)
  const [versao, setVersao] = useState(0)

  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('radar_negocios')
        if (error) throw error
        if (!vivo) return
        setNegocios(((data ?? []) as NegocioDoRadar[]).map((n) => ({ ...n, valor_proposta: n.valor_proposta == null ? null : Number(n.valor_proposta) })))
        setErro(false)
      } catch { if (vivo) setErro(true) }
      finally { if (vivo) setCarregando(false) }
    })()
    return () => { vivo = false }
  }, [versao])

  const recarregar = useCallback(() => setVersao((v) => v + 1), [])
  return { negocios, carregando, erro, recarregar }
}
