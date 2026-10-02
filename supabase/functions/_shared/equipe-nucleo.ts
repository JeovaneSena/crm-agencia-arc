/**
 * A equipe do núcleo: convite, papel, desligamento e exclusão de contas.
 *
 * Tudo aqui exige um GESTOR ativo, e a recusa de verdade está no banco: a
 * função `usuario_e_gestor` decide quem entra, e os gatilhos da 0001 recusam
 * tirar o último gestor (`usuarios_proteger_ultimo_gestor`) e apagar quem tem
 * histórico (`usuarios_bloquear_exclusao_com_historico`). O que este arquivo
 * faz é traduzir esses "não" para a tela.
 *
 * Precisa da `service_role key` (convidar, banir e listar e-mails só ela faz),
 * por isso é função de servidor e não um `select` do navegador.
 *
 * NENHUMA SENHA PASSA POR AQUI. O convite manda a pessoa definir a dela pelo
 * link, e o gestor nunca vê nem escolhe senha de ninguém.
 */

import { atualizar, rpc, selecionar } from './db.ts'

const URL_BASE = Deno.env.get('SUPABASE_URL')!
const CHAVE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

/** Onde o convidado cai para definir a senha. Precisa estar na lista de
 *  redirecionamentos permitidos do Auth, senão o GoTrue recusa o link. */
export const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/+$/, '')

const PAPEIS = ['gestor', 'consultor'] as const
const MAX_CORPO = 8_192
/** Banimento longo o bastante para valer como "desligado", e reversível. */
const BANIMENTO = '876000h'

export interface RespostaServico {
  corpo: unknown
  status?: number
}

interface LinhaUsuario {
  id: string
  nome: string
  papel: string
  ativo: boolean
  avatar_url: string | null
  profissional_id: string | null
  convidado_em: string | null
  created_at: string
}

interface ContaAuth {
  id: string
  email?: string | null
  hashed_token?: string
  confirmed_at?: string | null
  email_confirmed_at?: string | null
  last_sign_in_at?: string | null
}

export class ErroEquipe extends Error {
  constructor(mensagem: string, readonly status = 400, readonly codigo = 'DADOS_INVALIDOS') {
    super(mensagem)
    this.name = 'ErroEquipe'
  }
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export async function atenderEquipe(req: Request, rota: string, usuario: string): Promise<RespostaServico> {
  try {
    // A porta é uma só, e é do banco.
    if (await rpc<boolean>('usuario_e_gestor', { p_usuario: usuario }) !== true) {
      throw new ErroEquipe('Somente um gestor pode administrar a equipe.', 403, 'SEM_PERMISSAO')
    }

    if (rota === '/usuarios' && req.method === 'GET') {
      return { corpo: { ok: true, usuarios: await listar() } }
    }
    if (req.method !== 'POST') return { corpo: { ok: false, motivo: 'Rota inválida.' }, status: 404 }
    const corpo = await lerCorpo(req)

    switch (rota) {
      case '/convidar':
        return { corpo: { ok: true, usuario: await convidar(corpo) }, status: 201 }
      case '/reenviar-convite':
        return { corpo: { ok: true, usuario: await reenviar(alvoDaOperacao(corpo, usuario)) } }
      case '/criar':
        return { corpo: { ok: true, ...(await criarLink(corpo)) }, status: 201 }
      case '/recuperar':
        return { corpo: { ok: true, ...(await recuperar(alvoDaOperacao(corpo, usuario))) } }
      case '/papel': {
        const papel = texto(corpo.papel, 20)
        if (!PAPEIS.includes(papel as typeof PAPEIS[number])) throw new ErroEquipe('Escolha gestor ou consultor.')
        await atualizar('usuarios', `id=eq.${alvoDaOperacao(corpo, usuario)}`, { papel })
        return { corpo: { ok: true, usuarios: await listar() } }
      }
      case '/ativacao':
        return { corpo: { ok: true, usuarios: await ativacao(alvoDaOperacao(corpo, usuario), corpo.ativo === true) } }
      case '/excluir':
        return { corpo: { ok: true, usuario_id: await excluir(alvoDaOperacao(corpo, usuario)) } }
      default:
        return { corpo: { ok: false, motivo: 'Rota inválida.' }, status: 404 }
    }
  } catch (erro) {
    return erroEquipe(erro)
  }
}

// ---------------------------------------------------------------------------
// Operações
// ---------------------------------------------------------------------------

/** A lista da tela: o perfil vem do banco; e-mail e estado do convite vêm do
 *  Auth, que só a `service_role` enxerga. */
async function listar(): Promise<Record<string, unknown>[]> {
  const [perfis, contas] = await Promise.all([
    selecionar<LinhaUsuario>('usuarios?select=*&order=created_at.asc'),
    listarContas(),
  ])
  const porId = new Map(contas.map((c) => [c.id, c]))
  return perfis.map((p) => {
    const conta = porId.get(p.id)
    return {
      id: p.id,
      nome: p.nome,
      email: conta?.email ?? null,
      papel: p.papel,
      ativo: p.ativo,
      avatar_url: p.avatar_url,
      profissional_id: p.profissional_id,
      convidado_em: p.convidado_em,
      // "Convite pendente": o link ainda não confirmou o e-mail.
      convite_pendente: !(conta?.confirmed_at ?? conta?.email_confirmed_at),
      ultimo_acesso_em: conta?.last_sign_in_at ?? null,
      criado_em: p.created_at,
    }
  })
}

function dadosDoConvite(corpo: Record<string, unknown>) {
  const email = emailValido(corpo.email)
  const nome = texto(corpo.nome, 120)
  const papel = texto(corpo.papel, 20) || 'consultor'
  if (!nome) throw new ErroEquipe('Informe o nome de quem você está convidando.')
  if (!PAPEIS.includes(papel as typeof PAPEIS[number])) throw new ErroEquipe('Escolha gestor ou consultor.')
  return { email, nome, papel }
}

async function convidar(corpo: Record<string, unknown>): Promise<string> {
  const { email, nome, papel } = dadosDoConvite(corpo)
  const conta = await enviarConvite(email, nome, papel)
  await atualizar('usuarios', `id=eq.${conta.id}`, { convidado_em: new Date().toISOString() })
  return conta.id
}

/** Reenvia para quem ainda não abriu o convite, preservando nome e papel — é o
 *  que impede um reenvio de rebaixar em silêncio um gestor convidado. */
async function reenviar(id: string): Promise<string> {
  const perfis = await selecionar<{ nome: string; papel: string }>(`usuarios?select=nome,papel&id=eq.${id}&limit=1`)
  if (!perfis.length) throw new ErroEquipe('Conta não encontrada.', 404, 'NAO_ENCONTRADA')
  const conta = await auth<ContaAuth>(`/auth/v1/admin/users/${id}`, 'GET')
  if (conta.confirmed_at ?? conta.email_confirmed_at) {
    throw new ErroEquipe('Essa pessoa já abriu o convite. Para entrar, ela pode usar a senha criada ou recuperar a senha na tela de login.', 409, 'CONVITE_CONFIRMADO')
  }
  if (!conta.email) throw new ErroEquipe('Conta sem e-mail cadastrado.', 409, 'SEM_EMAIL')
  const novo = await enviarConvite(conta.email, perfis[0].nome, perfis[0].papel)
  await atualizar('usuarios', `id=eq.${novo.id}`, { convidado_em: new Date().toISOString() })
  return novo.id
}

/** O papel viaja em `data` e vira coluna no gatilho `handle_new_user`. */
async function enviarConvite(email: string, nome: string, papel: string): Promise<ContaAuth> {
  exigirAppUrl()
  return await auth<ContaAuth>(
    `/auth/v1/invite?redirect_to=${encodeURIComponent(`${APP_URL}/definir-senha`)}`,
    'POST',
    { email, data: { nome, papel } },
  )
}

/** Convite por LINK, sem e-mail: o gestor entrega pelo canal que preferir. */
async function criarLink(corpo: Record<string, unknown>): Promise<{ link: string; usuario_id: string }> {
  exigirAppUrl()
  const { email, nome, papel } = dadosDoConvite(corpo)
  const criado = await auth<ContaAuth>('/auth/v1/admin/generate_link', 'POST', { type: 'invite', email, data: { nome, papel } })
  if (!UUID.test(criado.id)) throw new ErroEquipe('O serviço de contas não concluiu o convite.', 502, 'AUTH_RECUSOU')
  await atualizar('usuarios', `id=eq.${criado.id}`, { convidado_em: new Date().toISOString() })
  return { link: montarLink(criado.hashed_token, 'invite'), usuario_id: criado.id }
}

/** Link para quem perdeu o acesso (ou nunca abriu o convite). */
async function recuperar(id: string): Promise<{ link: string; usuario_id: string }> {
  exigirAppUrl()
  const perfis = await selecionar<{ ativo: boolean; convidado_em: string | null }>(`usuarios?select=ativo,convidado_em&id=eq.${id}&limit=1`)
  if (!perfis.length || !perfis[0].ativo) throw new ErroEquipe('Conta não encontrada ou desligada.', 404, 'NAO_ENCONTRADA')
  const conta = await auth<ContaAuth>(`/auth/v1/admin/users/${id}`, 'GET')
  if (!conta.email) throw new ErroEquipe('Conta sem e-mail cadastrado.', 409, 'SEM_EMAIL')
  const gerado = await auth<ContaAuth>('/auth/v1/admin/generate_link', 'POST', { type: 'recovery', email: conta.email })
  return { link: montarLink(gerado.hashed_token, 'recovery'), usuario_id: id }
}

/** Desligar é desligar dos dois lados: a coluna, para o CRM e o banco, e o
 *  banimento no Auth, para a próxima sessão. */
async function ativacao(id: string, ativo: boolean): Promise<Record<string, unknown>[]> {
  // A coluna primeiro, de propósito: é ela que o gatilho do último gestor
  // protege. Se a recusa vier, o Auth nem chega a ser tocado.
  await atualizar('usuarios', `id=eq.${id}`, { ativo })
  await auth(`/auth/v1/admin/users/${id}`, 'PUT', { ban_duration: ativo ? 'none' : BANIMENTO })
  return await listar()
}

/** Só apaga conta sem histórico; o gatilho em auth.users repete a checagem
 *  dentro da transação da exclusão. */
async function excluir(id: string): Promise<string> {
  const perfis = await selecionar<{ papel: string; ativo: boolean }>(`usuarios?select=papel,ativo&id=eq.${id}&limit=1`)
  if (!perfis.length) throw new ErroEquipe('Conta não encontrada.', 404, 'NAO_ENCONTRADA')
  if (await rpc<boolean>('usuario_tem_historico', { p_usuario: id })) {
    throw new ErroEquipe('Essa conta já tem histórico no CRM. Desligue-a para preservar a autoria.', 409, 'COM_HISTORICO')
  }
  await auth<void>(`/auth/v1/admin/users/${id}`, 'DELETE')
  return id
}

// ---------------------------------------------------------------------------
// Auth Admin
// ---------------------------------------------------------------------------

async function auth<T = unknown>(caminho: string, metodo: string, corpo?: unknown): Promise<T> {
  const r = await fetch(`${URL_BASE}${caminho}`, {
    method: metodo,
    headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  })
  const bruto = await r.text()
  if (!r.ok) throw new ErroEquipe(traduzirAuth(r.status, bruto), r.status === 404 ? 404 : r.status === 429 ? 429 : 400, 'AUTH_RECUSOU')
  return (bruto ? JSON.parse(bruto) : undefined) as T
}

async function listarContas(): Promise<ContaAuth[]> {
  // Uma página só: é a equipe de uma empresa, não uma base de clientes.
  const r = await auth<{ users?: ContaAuth[] }>('/auth/v1/admin/users?page=1&per_page=1000', 'GET')
  return r.users ?? []
}

function exigirAppUrl(): void {
  if (!APP_URL) throw new ErroEquipe('O endereço do CRM não está configurado no servidor (APP_URL).', 409, 'APP_URL_AUSENTE')
}

function montarLink(hash: string | undefined, tipo: 'invite' | 'recovery'): string {
  if (!hash) throw new ErroEquipe('O serviço de contas não devolveu o link.', 502, 'AUTH_RECUSOU')
  return `${APP_URL}/definir-senha#token_hash=${encodeURIComponent(hash)}&type=${tipo}`
}

/** O GoTrue responde em inglês e às vezes com detalhe interno. A tela recebe
 *  português e nada de detalhe. */
export function traduzirAuth(status: number, corpo: string): string {
  const bruto = corpo.toLowerCase()
  if (bruto.includes('already been registered') || bruto.includes('already registered')) return 'Já existe uma conta com esse e-mail.'
  if (bruto.includes('redirect') && bruto.includes('not allowed')) return 'O endereço de retorno do convite não está liberado nas configurações de Auth do Supabase.'
  if (bruto.includes('rate limit') || status === 429) return 'O Supabase recusou por limite de envio de e-mail. Configure um SMTP próprio ou tente daqui a pouco.'
  if (bruto.includes('error sending') || bruto.includes('smtp')) return 'O convite não pôde ser enviado por e-mail. Confira o SMTP do projeto no Supabase.'
  if (status === 404) return 'Conta não encontrada.'
  return 'O serviço de contas recusou a operação.'
}

// ---------------------------------------------------------------------------
// Entrada crua
// ---------------------------------------------------------------------------

async function lerCorpo(req: Request): Promise<Record<string, unknown>> {
  const bruto = await req.text()
  if (bruto.length > MAX_CORPO) throw new ErroEquipe('A solicitação é grande demais.', 413, 'CORPO_GRANDE')
  let valor: unknown
  try { valor = bruto ? JSON.parse(bruto) : {} } catch { throw new ErroEquipe('O conteúdo enviado não é um JSON válido.') }
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) throw new ErroEquipe('Confira os dados informados.')
  return valor as Record<string, unknown>
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A conta que a operação vai mexer — nunca a de quem pediu: rebaixar a si
 *  mesmo tira o gestor da tela onde desfaria isso; desligar a si mesmo tira o
 *  login. Quem quer sair promove alguém e pede que essa pessoa o desligue. */
export function alvoDaOperacao(corpo: Record<string, unknown>, usuario: string): string {
  const id = String(corpo.usuario_id ?? '')
  if (!UUID.test(id)) throw new ErroEquipe('Conta inválida.')
  if (id === usuario) throw new ErroEquipe('Você não pode alterar a própria conta por aqui.', 409, 'CONTA_PROPRIA')
  return id
}

function texto(valor: unknown, maximo: number): string {
  if (valor === null || valor === undefined) return ''
  if (typeof valor !== 'string') throw new ErroEquipe('Confira os dados informados.')
  const limpo = valor.trim()
  if (limpo.length > maximo) throw new ErroEquipe('Texto longo demais.')
  return limpo
}

export function emailValido(valor: unknown): string {
  const email = texto(valor, 320).toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new ErroEquipe('Informe um e-mail válido.')
  return email
}

// ---------------------------------------------------------------------------
// Saída
// ---------------------------------------------------------------------------

/** Nunca devolve texto cru do PostgREST nem do GoTrue. */
export function erroEquipe(erro: unknown): RespostaServico {
  console.error('equipe:', erro instanceof Error ? erro.name : 'erro')
  if (erro instanceof ErroEquipe) return { corpo: { ok: false, codigo: erro.codigo, motivo: erro.message }, status: erro.status }
  const original = erro instanceof Error ? erro.message : ''
  // Mensagens que o banco levanta de propósito, e que a pessoa precisa ler.
  if (original.includes('pelo menos um gestor')) {
    return { corpo: { ok: false, codigo: 'ULTIMO_GESTOR', motivo: 'A base precisa de pelo menos um gestor ativo. Promova outra pessoa antes.' }, status: 409 }
  }
  if (original.includes('histórico no CRM') || original.includes('historico no CRM')) {
    return { corpo: { ok: false, codigo: 'COM_HISTORICO', motivo: 'Essa conta já tem histórico no CRM. Desligue-a para preservar a autoria.' }, status: 409 }
  }
  return {
    corpo: { ok: false, codigo: 'OPERACAO_RECUSADA', motivo: 'Não foi possível concluir a operação. Atualize a página e tente novamente.' },
    status: 400,
  }
}
