import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { normalizarNome, type CorEtiqueta, type Etiqueta } from './etiquetasRegras'

export type { Etiqueta, CorEtiqueta } from './etiquetasRegras'

const PAGINA = 1000

/**
 * Todas as etiquetas e quem tem quais (migração 0017). O mapa `porContato` serve às listas (chips e filtro) e
 * `usos` à tela de gestão. Uma leitura só, paginada: a equipe de uma instalação não chega perto do teto.
 */
export function useEtiquetas() {
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([])
  const [pares, setPares] = useState<{ contato_id: string; etiqueta_id: string }[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(false)
  const [versao, setVersao] = useState(0)

  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const e = await supabase.from('etiquetas').select('id,nome,cor').order('nome')
        if (e.error) throw e.error
        const todos: { contato_id: string; etiqueta_id: string }[] = []
        for (let inicio = 0; ; inicio += PAGINA) {
          const p = await supabase.from('contato_etiquetas').select('contato_id,etiqueta_id').order('contato_id').order('etiqueta_id').range(inicio, inicio + PAGINA - 1)
          if (p.error) throw p.error
          todos.push(...(p.data ?? []))
          if ((p.data?.length ?? 0) < PAGINA) break
        }
        if (!vivo) return
        setEtiquetas((e.data ?? []) as Etiqueta[]); setPares(todos); setErro(false)
      } catch { if (vivo) setErro(true) }
      finally { if (vivo) setCarregando(false) }
    })()
    return () => { vivo = false }
  }, [versao])

  const porContato = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const p of pares) (m.get(p.contato_id) ?? m.set(p.contato_id, new Set()).get(p.contato_id)!).add(p.etiqueta_id)
    return m
  }, [pares])
  const usos = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of pares) m.set(p.etiqueta_id, (m.get(p.etiqueta_id) ?? 0) + 1)
    return m
  }, [pares])
  const recarregar = useCallback(() => setVersao((v) => v + 1), [])
  return { etiquetas, porContato, usos, carregando, erro, recarregar }
}

export async function criarEtiqueta(nome: string, cor: CorEtiqueta = 'accent'): Promise<Etiqueta> {
  const { data, error } = await supabase.from('etiquetas').insert({ nome: normalizarNome(nome), cor }).select('id,nome,cor').single()
  if (error) throw error
  return data as Etiqueta
}
export async function marcarContato(contatoId: string, etiquetaId: string): Promise<void> {
  const { error } = await supabase.from('contato_etiquetas').insert({ contato_id: contatoId, etiqueta_id: etiquetaId })
  if (error && error.code !== '23505') throw error   // já estava marcado: tudo bem
}
export async function desmarcarContato(contatoId: string, etiquetaId: string): Promise<void> {
  const { error } = await supabase.from('contato_etiquetas').delete().eq('contato_id', contatoId).eq('etiqueta_id', etiquetaId)
  if (error) throw error
}
export async function alterarEtiqueta(id: string, campos: { nome?: string; cor?: CorEtiqueta }): Promise<void> {
  const { data, error } = await supabase.from('etiquetas').update({ ...campos, ...(campos.nome !== undefined ? { nome: normalizarNome(campos.nome) } : {}) }).eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('sem_permissao')   // a policy filtrou a linha: quem não é gestor
}
export async function excluirEtiqueta(id: string): Promise<void> {
  const { data, error } = await supabase.from('etiquetas').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('sem_permissao')
}
export async function juntarEtiquetas(origem: string, destino: string): Promise<number> {
  const { data, error } = await supabase.rpc('etiqueta_juntar', { p_origem: origem, p_destino: destino })
  if (error) throw error
  return Number(data) || 0
}
