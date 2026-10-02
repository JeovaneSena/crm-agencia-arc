// Ensaio LOCAL das migrações da base, sem token nem projeto Supabase: sobe um Postgres em
// memória (PGlite), simula o que o Supabase fornece (`scripts/lib/supabase-stub.sql`) e,
// para cada migração, na ordem: roda o `_check.sql` numa transação revertida e depois aplica.
// Não toca em rede nem em arquivo. Complementa — não substitui — o ensaio no projeto
// descartável real (`test:*:db:rehearsal`), que é quem confirma o Supabase de verdade.
//
//   node scripts/ensaio-local.mjs                       todas as migrações da pasta
//   node scripts/ensaio-local.mjs --ate 0007            só até a 0007
//   node scripts/ensaio-local.mjs --so 0001,0002,0009   só estas (precisa das anteriores de que dependem)
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const raiz = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const valor = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : null }
const ate = valor('--ate'), so = valor('--so')?.split(',')

const dir = resolve(raiz, 'database/base')
let versoes = readdirSync(dir).filter(f => /^\d{4}_.+\.sql$/.test(f) && !f.endsWith('_check.sql')).sort().map(f => f.replace(/\.sql$/, ''))
if (ate) versoes = versoes.filter(v => v.slice(0, 4) <= ate)
if (so) versoes = versoes.filter(v => so.includes(v.slice(0, 4)))

const db = new PGlite({ extensions: { btree_gist } })
await db.exec(readFileSync(resolve(raiz, 'scripts/lib/supabase-stub.sql'), 'utf8'))

let falhas = 0
for (const v of versoes) {
  const migracao = readFileSync(resolve(dir, `${v}.sql`), 'utf8')
  const checagem = readFileSync(resolve(dir, `${v.slice(0, 4)}_check.sql`), 'utf8')
  if (!/COMMIT;\s*$/.test(migracao)) { console.error(`FAIL ${v}: a migração deve terminar com COMMIT;`); falhas++; break }
  const tentar = async (sql, rotulo) => {
    try { await db.exec(sql); return true } catch (e) {
      await db.exec('ROLLBACK').catch(() => {})
      console.error(`FAIL ${v} (${rotulo}): ${e.message}`)
      falhas++; return false
    }
  }
  // 1) ensaio: migração + testes, tudo revertido
  if (!await tentar(migracao.replace(/COMMIT;\s*$/, () => `${checagem}\nROLLBACK;`), 'ensaio')) break
  // 2) aplicação de verdade (com as fixtures do teste numa subtransação descartada, como no apply real)
  if (!await tentar(migracao.replace(/COMMIT;\s*$/, () => `SAVEPOINT fixtures;\n${checagem}\nROLLBACK TO SAVEPOINT fixtures;\nRELEASE SAVEPOINT fixtures;\nCOMMIT;`), 'aplicação')) break
  console.log(`PASS ${v}`)
}
if (falhas) process.exit(1)
console.log(`PASS: ${versoes.length} migração(ões) ensaiada(s) e aplicada(s) localmente.`)
