import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const env = Object.fromEntries(readFileSync(resolve(root, '.supabase-token.local'), 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.trimStart().startsWith('#')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const project = env.SUPABASE_PROJECT_REF.replace(/\/+$/, '').split('/').pop()
let query = readFileSync(resolve(process.argv[2]), 'utf8')
if (process.argv.includes('--check')) {
  if (!/commit;\s*$/i.test(query) || !/begin;/i.test(query)) throw new Error('Ensaio exige BEGIN e COMMIT no arquivo; recusando execução sem rollback.')
  // Uma migração que depende de outra ainda não aplicada ensaia com as duas na
  // mesma transação: `--antes` entra antes, sem o próprio BEGIN/COMMIT.
  for (const anterior of process.argv.flatMap((a, i) => a === '--antes' ? [process.argv[i + 1]] : [])) {
    const dependencia = readFileSync(resolve(root, anterior), 'utf8')
    if (!/commit;\s*$/i.test(dependencia) || !/begin;/i.test(dependencia)) throw new Error(`${anterior} não é uma migração transacional; recusando encadear.`)
    query = query.replace(/begin;/i, () => `begin;\n${dependencia.replace(/begin;/i, '').replace(/commit;\s*$/i, '')}`)
  }
  const tests = readFileSync(resolve(root, process.argv[process.argv.indexOf('--tests') + 1] && process.argv.includes('--tests') ? process.argv[process.argv.indexOf('--tests') + 1] : 'scripts/agency-check.sql'), 'utf8')
  if (process.argv.includes('--fixture')) {
    const fixture = readFileSync(resolve(root, process.argv[process.argv.indexOf('--fixture') + 1]), 'utf8')
    query = query.replace(/begin;/i, () => `begin;\n${fixture}`)
  }
  query = query.replace(/commit;\s*$/i, () => `${tests}\nrollback;`)
}
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
})
const body = await response.text()
if (!response.ok) throw new Error(`Database ${response.status}: ${body}`)
console.log(body)
import './template-guard.mjs'
