import { Navigate, Outlet } from 'react-router-dom'
import { useSessao } from '../lib/sessao'
import { LoadingState } from './ui'

/**
 * As telas que só o gestor abre.
 *
 * ⚠️ ISTO É NAVEGAÇÃO, NÃO SEGURANÇA. Redirecionar evita que um consultor caia
 * numa tela que não vai funcionar para ele; quem recusa de verdade é o banco —
 * as policies e o `exigir_gestor` das rotas `/equipe/*`. Se algum dia esta
 * linha sumir, nada vaza: a tela abre e as ações falham com 403.
 */
export default function RotaDeGestor() {
  const { gestor, carregando } = useSessao()
  if (carregando) return <LoadingState label="Conferindo seu acesso…" />
  return gestor ? <Outlet /> : <Navigate to="/" replace />
}
