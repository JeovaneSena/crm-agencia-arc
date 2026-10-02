/**
 * Leva o conteúdo de `agente-ia/prompt.md` para dentro da Edge Function.
 *
 * POR QUE ISTO EXISTE: a Edge Function roda no Supabase e não enxerga o
 * repositório. Ela precisa do prompt embutido no código. Em vez de manter uma
 * segunda cópia à mão — que envelheceria calada — o arquivo `.ts` é gerado a
 * partir do `.md`, e o `.md` continua sendo o único que alguém edita.
 *
 * Rode depois de mexer no prompt:
 *
 *     npm run prompt
 *
 * O deploy da função (`npm run agente:deploy`) já roda isto antes.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const origem = join(aqui, 'prompt.md')
const destino = join(aqui, '..', 'supabase', 'functions', '_shared', 'prompt-oficial.ts')

const prompt = readFileSync(origem, 'utf8')

// JSON.stringify em vez de template literal: o prompt tem crase, cifrão e
// chaves duplas. Escapar isso à mão é como se cria um bug que só aparece
// quando alguém acrescenta um exemplo com acento.
const saida = `/**
 * GERADO AUTOMATICAMENTE — NÃO EDITE ESTE ARQUIVO.
 *
 * Fonte: agente-ia/prompt.md
 * Regerar: npm run prompt
 *
 * Editar aqui funciona até o próximo deploy, e aí a sua mudança some sem
 * aviso. Edite o .md.
 */

export const PROMPT_OFICIAL = ${JSON.stringify(prompt)}
`

writeFileSync(destino, saida, 'utf8')

const linhas = prompt.split('\n').length
const palavras = prompt.split(/\s+/).filter(Boolean).length
console.log(`prompt.md -> _shared/prompt-oficial.ts  (${linhas} linhas, ${palavras} palavras)`)
