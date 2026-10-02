/**
 * Função `equipe`: convite, papel, desligamento e exclusão de contas.
 *
 * Rotas (todas exigem sessão de GESTOR; quem decide é o banco):
 *   GET  /equipe/usuarios          lista com e-mail e estado do convite
 *   POST /equipe/convidar          convite por e-mail
 *   POST /equipe/reenviar-convite  reenvia a quem ainda não abriu
 *   POST /equipe/criar             convite por link (sem e-mail)
 *   POST /equipe/recuperar         link de acesso para uma conta
 *   POST /equipe/papel             gestor | consultor
 *   POST /equipe/ativacao          liga/desliga (coluna + banimento no Auth)
 *   POST /equipe/excluir           só conta sem histórico
 *
 * Secrets: APP_URL (obrigatório para convites). SUPABASE_URL, _ANON_KEY e
 * _SERVICE_ROLE_KEY o Supabase já entrega. Publicar com `--no-verify-jwt`:
 * a sessão é conferida aqui, no Auth, e o papel, no banco.
 */
import { APP_URL, atenderEquipe, UUID } from '../_shared/equipe-nucleo.ts'

const URL_BASE = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

// Só o CRM da instalação pode chamar do navegador; sem APP_URL, qualquer origem
// (a sessão no cabeçalho continua sendo exigida).
const CORS = {
  'Access-Control-Allow-Origin': APP_URL || '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Vary': 'Origin',
}

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

async function usuarioDaSessao(req: Request): Promise<string | null> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const r = await fetch(`${URL_BASE}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } })
  if (!r.ok) return null
  const u = await r.json() as { id?: string }
  return u.id && UUID.test(u.id) ? u.id : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const usuario = await usuarioDaSessao(req)
    if (!usuario) return json({ ok: false, codigo: 'SESSAO_EXPIRADA', motivo: 'Sua sessão expirou. Entre novamente.' }, 401)
    const rota = new URL(req.url).pathname.replace(/^\/(?:functions\/v1\/)?equipe/, '').replace(/\/+$/, '')
    const r = await atenderEquipe(req, rota, usuario)
    return json(r.corpo, r.status ?? 200)
  } catch (erro) {
    console.error('equipe:', erro instanceof Error ? erro.name : 'erro')
    return json({ ok: false, codigo: 'OPERACAO_RECUSADA', motivo: 'Não foi possível concluir a operação agora.' }, 503)
  }
})
