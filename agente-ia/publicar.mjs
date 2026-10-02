/**
 * Roda o CLI do Supabase com a identificação da SUA instalação.
 *
 *     node agente-ia/publicar.mjs secrets   →  npm run agente:secrets
 *     node agente-ia/publicar.mjs deploy    →  npm run agente:deploy
 *
 * POR QUE ISTO EXISTE: os dois comandos precisavam do `--project-ref` na linha
 * de comando, e ele estava **escrito dentro do `package.json`** — que é
 * versionado. Quem clonasse o repositório mandava publicar no projeto de outra
 * pessoa, e o erro que voltava era de permissão, sem dizer a causa.
 *
 * Agora os dois valores saem de `.supabase-token.local`, que é o arquivo de
 * identificação da instalação e já está fora do Git. Nada do projeto de
 * ninguém fica gravado em arquivo versionado.
 *
 * DE QUEBRA, RESOLVE O 401. O CLI usa a sessão do `supabase login`, que expira
 * — e o token do arquivo não entrava sozinho, então o deploy voltava
 * `Unauthorized` e parecia problema de código. Aqui ele é injetado no
 * processo filho, sempre.
 */

import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const arquivo = join(raiz, '.supabase-token.local')

/** Um `.env` simples: `CHAVE=valor`, ignorando comentários e linhas vazias. */
function ler(caminho) {
  const fora = {}
  for (const linha of readFileSync(caminho, 'utf8').split('\n')) {
    const corte = linha.indexOf('=')
    if (corte < 1 || linha.trimStart().startsWith('#')) continue
    fora[linha.slice(0, corte).trim()] = linha.slice(corte + 1).trim()
  }
  return fora
}

function morrer(mensagem) {
  console.error(`\n  ✖  ${mensagem}\n`)
  process.exit(1)
}

if (!existsSync(arquivo)) {
  morrer(
    'Falta o arquivo .supabase-token.local.\n\n' +
    '     cp .supabase-token.example .supabase-token.local\n\n' +
    '     Depois preencha as duas linhas de dentro dele. O próprio molde\n' +
    '     explica onde achar cada valor — e como revogar o token no fim.',
  )
}

const cfg = ler(arquivo)
const token = cfg.SUPABASE_ACCESS_TOKEN
const ref = cfg.SUPABASE_PROJECT_REF?.replace(/\/+$/, '').split('/').pop()

if (!token) morrer('SUPABASE_ACCESS_TOKEN está vazio em .supabase-token.local.')
if (!ref) {
  morrer(
    'SUPABASE_PROJECT_REF está vazio em .supabase-token.local.\n\n' +
    '     É o identificador do SEU projeto — as 20 letras que aparecem na URL\n' +
    '     do painel: https://supabase.com/dashboard/project/AQUI',
  )
}

const acao = process.argv[2]
const comandos = {
  secrets: ['secrets', 'set', '--project-ref', ref, '--env-file', 'agente-ia/.env.agente.local'],
  // `--no-verify-jwt` de propósito: quem chama o webhook é a ponte de WhatsApp,
  // que não tem sessão do Supabase. A autenticação é o WEBHOOK_SEGREDO,
  // conferido dentro da função. Publicar no padrão derruba o webhook com um
  // 401 que nem chega no nosso código.
  deploy: ['functions', 'deploy', 'whatsapp', '--project-ref', ref, '--no-verify-jwt'],
  'deploy-followup': ['functions', 'deploy', 'followup', '--project-ref', ref, '--no-verify-jwt'],
  // A API da agenda, pelo mesmo motivo: a autenticação dela é o nosso token.
  'deploy-agenda': ['functions', 'deploy', 'agenda', '--project-ref', ref, '--no-verify-jwt'],
}

if (!comandos[acao]) {
  morrer(`Ação desconhecida: "${acao ?? ''}". Use: ${Object.keys(comandos).join(', ')}`)
}

console.log(`\n  → supabase ${comandos[acao].join(' ')}\n`)

const r = spawnSync('npx', ['--yes', 'supabase', ...comandos[acao]], {
  cwd: raiz,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
})

process.exit(r.status ?? 1)
import '../scripts/template-guard.mjs'
