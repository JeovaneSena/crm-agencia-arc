/**
 * As chamadas da tela de Usuários.
 *
 * Tudo bate na função `equipe` (`supabase/functions/equipe`): ela confere a
 * sessão e exige gestor no banco.
 */

import { supabase } from './supabase'
import type { MembroEquipe, PapelUsuario } from '../types'

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/equipe`

export class ErroEquipe extends Error {
  codigo?: string
  status?: number

  constructor(mensagem: string, codigo?: string, status?: number) {
    super(mensagem)
    this.name = 'ErroEquipe'
    this.codigo = codigo
    this.status = status
  }
}

async function chamar<T>(caminho: string, corpo?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession()
  if (!data.session) throw new ErroEquipe('Sua sessão expirou. Entre novamente.', 'SESSAO_EXPIRADA', 401)

  let resposta: Response
  try {
    resposta = await fetch(`${BASE}${caminho}`, {
      method: corpo === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        Accept: 'application/json',
        ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    })
  } catch {
    throw new ErroEquipe('Não foi possível falar com o servidor. Confira a conexão e tente novamente.', 'REDE')
  }

  let dados: unknown = null
  try { dados = await resposta.json() } catch { /* resposta sem JSON */ }
  const objeto = dados && typeof dados === 'object' ? dados as Record<string, unknown> : null

  if (!resposta.ok || objeto?.ok === false) {
    throw new ErroEquipe(
      typeof objeto?.motivo === 'string' ? objeto.motivo : 'Não foi possível concluir a operação.',
      typeof objeto?.codigo === 'string' ? objeto.codigo : undefined,
      resposta.status,
    )
  }
  return dados as T
}

function lista(resposta: { usuarios?: MembroEquipe[] }): MembroEquipe[] {
  return Array.isArray(resposta.usuarios) ? resposta.usuarios : []
}

export async function listarEquipe(): Promise<MembroEquipe[]> {
  return lista(await chamar<{ usuarios?: MembroEquipe[] }>('/usuarios'))
}

export async function convidar(dados: { email: string; nome: string; papel: PapelUsuario }): Promise<void> {
  await chamar('/convidar', dados)
}

export async function reenviarConvite(usuarioId: string): Promise<void> {
  await chamar('/reenviar-convite', { usuario_id: usuarioId })
}

export async function criarLinkConvite(dados: { email: string; nome: string; papel: PapelUsuario }): Promise<string> {
  const resposta = await chamar<{ link: string }>('/criar', dados)
  return resposta.link
}

export async function gerarLinkAcesso(usuarioId: string): Promise<string> {
  const resposta = await chamar<{ link: string }>('/recuperar', { usuario_id: usuarioId })
  return resposta.link
}

export async function excluirUsuario(usuarioId: string): Promise<void> {
  await chamar('/excluir', { usuario_id: usuarioId })
}

/** As três abaixo devolvem a lista já atualizada: a tela não precisa recarregar. */
export async function definirPapel(usuarioId: string, papel: PapelUsuario): Promise<MembroEquipe[]> {
  return lista(await chamar<{ usuarios?: MembroEquipe[] }>('/papel', { usuario_id: usuarioId, papel }))
}

export async function definirAtivacao(usuarioId: string, ativo: boolean): Promise<MembroEquipe[]> {
  return lista(await chamar<{ usuarios?: MembroEquipe[] }>('/ativacao', { usuario_id: usuarioId, ativo }))
}
