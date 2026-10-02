// Configuração do Auth da instalação: cadastro público FECHADO (só o gestor cria
// contas), URL do site e política de senha igual à de src/lib/senha.ts.
// Lê o domínio de instalacao.json. Credenciais só por variável de ambiente.
//
//   SUPABASE_PROJECT_REF=xxxx SUPABASE_ACCESS_TOKEN=sbp_xxxx node scripts/auth-config.mjs show
//   SUPABASE_PROJECT_REF=xxxx SUPABASE_ACCESS_TOKEN=sbp_xxxx node scripts/auth-config.mjs apply --confirm
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const modo = process.argv[2]
if (!['show', 'apply'].includes(modo)) throw Error('Use show ou apply --confirm.')
if (modo === 'apply' && !process.argv.includes('--confirm')) throw Error('apply altera o projeto real: repita com --confirm.')

const ref = process.env.SUPABASE_PROJECT_REF
const token = process.env.SUPABASE_ACCESS_TOKEN
if (!ref || !token?.startsWith('sbp_')) throw Error('Defina SUPABASE_PROJECT_REF e SUPABASE_ACCESS_TOKEN como variáveis de ambiente.')

let instalacao
try { instalacao = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'instalacao.json'), 'utf8')) } catch {
  throw Error('instalacao.json não existe: este script é só para instalações geradas.')
}
const site = `https://${instalacao.dominio}`

// A API só aceita o conjunto de símbolos com duas barras invertidas (formato literal dela).
const ALVO = {
  disable_signup: true,
  site_url: site,
  uri_allow_list: `${site}/**`,
  password_min_length: 10,
  password_required_characters: 'abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789:!@#$%^&*()_+-=[]{};\'\\\\:"|<>?,./`~',
}

async function api(metodo, corpo) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method: metodo, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined, signal: AbortSignal.timeout(30000),
  })
  if (!r.ok) throw Error(`Supabase HTTP ${r.status}: ${(await r.text()).replaceAll(token, '[oculto]').slice(0, 800)}`)
  return r.json()
}
const resumo = (c) => Object.fromEntries(Object.keys(ALVO).map(k => [k, k === 'password_required_characters' ? (c[k] ? 'definido' : 'nenhum') : c[k]]))
const confere = (c) => Object.entries(ALVO).filter(([k, v]) => c[k] !== v).map(([k]) => k)

const atual = await api('GET')
if (modo === 'show') {
  console.table(resumo(atual))
  const fora = confere(atual)
  console.log(fora.length ? `Fora do esperado: ${fora.join(', ')}. Rode apply --confirm.` : 'Auth conforme o esperado (cadastro público fechado).')
} else {
  const depois = await api('PATCH', ALVO)
  const fora = confere(depois)
  if (fora.length) throw Error(`Depois do ajuste ainda divergem: ${fora.join(', ')}.`)
  console.log('PASS: cadastro público fechado, site_url e política de senha aplicados.')
  console.table(resumo(depois))
}
