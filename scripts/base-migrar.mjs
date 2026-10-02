// Executor das migrações da base depois da 0001 (a 0001 tem o seu próprio
// script, em base-database.mjs). Credenciais só por variável de ambiente —
// nunca lê nem grava arquivo de credencial neste repositório.
//
//   SUPABASE_PROJECT_REF=xxxx SUPABASE_ACCESS_TOKEN=sbp_xxxx node scripts/base-migrar.mjs rehearse database/base/0002_nucleo_configuravel.sql database/base/0002_check.sql
//   SUPABASE_PROJECT_REF=xxxx SUPABASE_ACCESS_TOKEN=sbp_xxxx node scripts/base-migrar.mjs apply    database/base/0002_nucleo_configuravel.sql database/base/0002_check.sql --confirm
//
// `rehearse` aplica e testa numa transação revertida; `apply` testa numa
// subtransação revertida e só então confirma a migração (exige --confirm).
import { readFileSync } from 'node:fs'
import { resolve, basename } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const [mode, migrationPath, checkPath] = process.argv.slice(2)
if (!['rehearse', 'apply'].includes(mode) || !migrationPath || !checkPath) throw Error('Use: rehearse|apply <migração.sql> <testes.sql> [--confirm]')
if (mode === 'apply' && !process.argv.includes('--confirm')) throw Error('apply altera o projeto real: repita com --confirm.')

const ref = process.env.SUPABASE_PROJECT_REF
const token = process.env.SUPABASE_ACCESS_TOKEN
if (!ref || !token?.startsWith('sbp_')) {
  throw Error('Defina SUPABASE_PROJECT_REF e SUPABASE_ACCESS_TOKEN (projeto descartável, nunca o da ARC) como variáveis de ambiente.')
}

const migration = readFileSync(resolve(root, migrationPath), 'utf8')
const checks = readFileSync(resolve(root, checkPath), 'utf8')
const version = basename(migrationPath, '.sql')
if (!/COMMIT;\s*$/.test(migration)) throw Error('A migração deve terminar com COMMIT;')

async function query(sql, readOnly = false) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: readOnly }), signal: AbortSignal.timeout(60000),
  })
  if (!r.ok) throw Error(`Supabase HTTP ${r.status}: ${(await r.text()).replaceAll(token, '[oculto]').slice(0, 1500)}`)
  return r.json()
}

try {
  const applied = await query(`select 1 from crm_base_private.schema_migrations where version='${version}'`, true)
  if (applied.length) throw Error(`${version} já foi aplicada.`)
  if (mode === 'rehearse') {
    await query(migration.replace(/COMMIT;\s*$/, () => `${checks}\nROLLBACK;`))
    const depois = await query(`select 1 from crm_base_private.schema_migrations where version='${version}'`, true)
    if (depois.length) throw Error('Ensaio deixou a migração registrada.')
    console.log(`PASS: ${version} aplicada e testada numa transação revertida; nada persistiu.`)
  } else {
    await query(migration.replace(/COMMIT;\s*$/, () => `SAVEPOINT fixtures;\n${checks}\nROLLBACK TO SAVEPOINT fixtures;\nRELEASE SAVEPOINT fixtures;\nCOMMIT;`))
    const depois = await query(`select 1 from crm_base_private.schema_migrations where version='${version}'`, true)
    if (!depois.length) throw Error('Migração não ficou registrada.')
    console.log(`PASS: ${version} aplicada; fixtures descartadas.`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falha; detalhes omitidos.')
  process.exitCode = 1
}
