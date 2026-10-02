// Ensaio/aplicação da 0001_base num projeto Supabase DESCARTÁVEL, só para
// validar o esquema da base. Nunca lê nem grava um arquivo de credencial
// neste repositório — `preflight-base.mjs` proíbe `.supabase-token.local`
// aqui, e essa regra vale também para este script: as credenciais vêm só de
// variáveis de ambiente, na hora de rodar.
//
//   SUPABASE_PROJECT_REF=xxxx SUPABASE_ACCESS_TOKEN=sbp_xxxx node scripts/base-database.mjs rehearse
//   SUPABASE_PROJECT_REF=xxxx SUPABASE_ACCESS_TOKEN=sbp_xxxx node scripts/base-database.mjs apply --confirm
//   SUPABASE_PROJECT_REF=xxxx SUPABASE_ACCESS_TOKEN=sbp_xxxx node scripts/base-database.mjs verify
//
// `rehearse` aplica base+check numa transação revertida (nada persiste).
// `apply` aplica de verdade, com o check rodando numa subtransação revertida
// antes do commit (exige --confirm). `verify` só lê o que já está lá.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const mode = process.argv[2]
if (!['rehearse', 'apply', 'verify'].includes(mode)) throw Error('Use rehearse, apply ou verify.')
if (mode === 'apply' && !process.argv.includes('--confirm')) throw Error('apply altera o projeto real: repita com --confirm.')

const ref = process.env.SUPABASE_PROJECT_REF
const token = process.env.SUPABASE_ACCESS_TOKEN
if (!ref || !token?.startsWith('sbp_')) {
  throw Error('Defina SUPABASE_PROJECT_REF e SUPABASE_ACCESS_TOKEN (projeto descartável, nunca o da ARC) como variáveis de ambiente.')
}

const migration = readFileSync(resolve(root, 'database/base/0001_base.sql'), 'utf8')
const checks = readFileSync(resolve(root, 'database/base/0001_check.sql'), 'utf8')

async function query(sql, readOnly = false) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: readOnly }), signal: AbortSignal.timeout(60000),
  })
  if (!r.ok) {
    const body = (await r.text()).replaceAll(token, '[oculto]')
    throw Error(`Supabase HTTP ${r.status}: ${body.slice(0, 1500)}`)
  }
  return r.json()
}

try {
  if (mode !== 'verify') {
    const tables = await query("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'", true)
    if (tables.length) throw Error('Este ensaio exige esquema público vazio. Use verify se a 0001_base já foi aplicada.')
  }
  if (mode === 'rehearse') {
    console.log(JSON.stringify(await query(migration.replace(/COMMIT;\s*$/, () => `${checks}\nROLLBACK;`))))
    const after = await query("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'", true)
    if (after.length) throw Error('Ensaio deixou tabelas persistidas.')
    console.log('PASS: ensaio revertido; destino continua vazio.')
  } else if (mode === 'apply') {
    const testBlock = `SAVEPOINT fixtures;\n${checks}\nROLLBACK TO SAVEPOINT fixtures;\nRELEASE SAVEPOINT fixtures;\nCOMMIT;`
    console.log(JSON.stringify(await query(migration.replace(/COMMIT;\s*$/, () => testBlock))))
    console.log('PASS: base aplicada; fixtures do check descartadas.')
  } else {
    console.log(JSON.stringify(await query('BEGIN;\n' + checks + '\nROLLBACK;')))
    console.log(JSON.stringify(await query("select version from crm_base_private.schema_migrations;", true)))
    console.log(JSON.stringify(await query(
      "select 'contatos_dados' as tabela,count(*) from public.contatos_dados union all " +
      "select 'oportunidades',count(*) from public.oportunidades union all " +
      "select 'reunioes',count(*) from public.reunioes union all " +
      "select 'usuarios',count(*) from public.usuarios union all " +
      "select 'catalogo_servicos',count(*) from public.catalogo_servicos union all " +
      "select 'configuracoes_negocio',count(*) from public.configuracoes_negocio union all " +
      "select 'horario_comercial',count(*) from public.horario_comercial", true)))
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falha; detalhes omitidos.')
  process.exitCode = 1
}
