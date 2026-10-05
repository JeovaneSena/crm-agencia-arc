/**
 * A sessão de quem chama uma função pelo navegador: o usuário logado E ativo, ou null.
 * Conta desligada não usa as funções. O papel vem de `usuarios`, nunca do token.
 */
import {segundoFatorConfirmado} from './mfa.ts'
import { selecionar } from './db.ts'

export interface Usuario { id: string; papel: string }

export async function usuarioDaSessao(req: Request): Promise<Usuario | null> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '' },
  })
  if (!r.ok) return null
  const u=await r.json() as {id?:string;factors?:{status?:string}[]}
  const {id}=u
  if(!id||!segundoFatorConfirmado(token,u))return null
  const perfil = (await selecionar<{ papel: string; ativo: boolean }>(`usuarios?select=papel,ativo&id=eq.${id}&limit=1`))[0]
  return perfil?.ativo ? { id, papel: perfil.papel } : null
}
