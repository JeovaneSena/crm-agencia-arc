/**
 * Quem está logado, e o que essa pessoa pode.
 *
 * Antes, `Sidebar`, `Configuracoes` e `Dashboard` buscavam a linha de
 * `usuarios` cada um por si — três idas ao banco pela mesma resposta. Agora a
 * busca é uma, no `SessaoProvider`, e as telas leem daqui.
 *
 * ⚠️ ISTO É INTERFACE, NÃO SEGURANÇA. O que este contexto diz decide o que
 * aparece na tela. Quem recusa de verdade é o banco: as policies da migração
 * 0033 e o `exigir_gestor` nas rotas `/equipe/*`. Uma pessoa que forje
 * `papel: 'gestor'` no navegador vê os botões e leva 403 ao clicar.
 *
 * O contexto e o gancho moram aqui, separados do provedor, porque um arquivo
 * que exporta componente e função junto quebra o recarregamento rápido do Vite.
 */

import { createContext, useContext } from 'react'
import type { Usuario } from '../types'

export interface Sessao {
  usuario: Usuario | null
  carregando: boolean
  gestor: boolean
  podeGerenciarCampanhas: boolean
  /** Relê o perfil. Usada quando a própria pessoa muda nome ou foto. */
  recarregar: () => Promise<void>
}

export const ContextoSessao = createContext<Sessao | null>(null)

export function useSessao(): Sessao {
  const valor = useContext(ContextoSessao)
  if (!valor) throw new Error('useSessao precisa estar dentro de <SessaoProvider>.')
  return valor
}
