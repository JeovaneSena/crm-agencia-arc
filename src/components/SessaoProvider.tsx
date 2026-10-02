import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { ContextoSessao, type Sessao } from '../lib/sessao'
import type { Usuario } from '../types'

/** Carrega o perfil uma vez por sessão e mantém atualizado. Ver `lib/sessao.ts`. */
export default function SessaoProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [carregando, setCarregando] = useState(true)

  const recarregar = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setUsuario(null); setCarregando(false); return }
    const { data } = await supabase.from('usuarios').select('*').eq('id', user.id).single()
    setUsuario(data ?? null)
    setCarregando(false)
  }, [])

  useEffect(() => {
    async function carregar() { await recarregar() }
    void carregar()

    // A tela de Configurações avisa quando o nome ou a foto mudam. Sem isso, a
    // barra lateral só acompanhava no próximo F5 — na tela em que a pessoa
    // acabou de mexer.
    const aoAtualizar = () => { void carregar() }
    window.addEventListener('usuario-atualizado', aoAtualizar)

    const { data: { subscription } } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_OUT') setUsuario(null)
      if (evento === 'SIGNED_IN' || evento === 'USER_UPDATED') void carregar()
    })

    return () => {
      window.removeEventListener('usuario-atualizado', aoAtualizar)
      subscription.unsubscribe()
    }
  }, [recarregar])

  const valor = useMemo<Sessao>(() => ({
    usuario,
    carregando,
    gestor: usuario?.papel === 'gestor' && usuario.ativo !== false,
    // Gestor não depende da coluna: pausar e cancelar campanha é freio de
    // emergência. A coluna serve para conceder campanhas a um consultor.
    podeGerenciarCampanhas: usuario?.papel === 'gestor',
    recarregar,
  }), [usuario, carregando, recarregar])

  return <ContextoSessao.Provider value={valor}>{children}</ContextoSessao.Provider>
}
