// Regras puras do app (src/lib), sem navegador. Rode com `npm run test:lib`.
import { atalhoDigitado, expandirAtalho, filtrar, preencher, variaveisPendentes, type RespostaRapida } from '../../src/lib/respostasRapidas.ts'

function assert(v: unknown, m = 'Assertion failed'): asserts v { if (!v) throw new Error(m) }
const eq = (a: unknown, b: unknown, m = '') => assert(JSON.stringify(a) === JSON.stringify(b), `${m} esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`)

const R = (o: Partial<RespostaRapida> & { titulo: string }): RespostaRapida => ({ id: o.titulo, texto: 'texto', atalho: null, dono_id: null, ...o })

Deno.test('respostas rápidas: preenche nome e primeiro nome; o resto fica literal', () => {
  eq(preencher('Oi, {{primeiro_nome}}! Aqui é para {{nome}}.', { nome: ' Maria da Silva ' }), 'Oi, Maria! Aqui é para Maria da Silva.')
  eq(preencher('Oi, {{ Nome }}', { nome: 'Ana' }), 'Oi, Ana')
  eq(preencher('Oi, {{nome}} {{empresa}}', { nome: 'Ana' }), 'Oi, Ana {{empresa}}')
  eq(preencher('Oi, {{nome}}', { nome: null }), 'Oi, {{nome}}')
  eq(preencher('Oi, {{primeiro_nome}}', { nome: '   ' }), 'Oi, {{primeiro_nome}}')
  eq(preencher('Sem variável', { nome: 'Ana' }), 'Sem variável')
})

Deno.test('respostas rápidas: o que sobra de variável bloqueia o envio', () => {
  eq(variaveisPendentes('Oi, {{nome}} e {{NOME}} e {{empresa}}'), ['{{nome}}', '{{empresa}}'])
  eq(variaveisPendentes('Oi, Ana'), [])
  eq(variaveisPendentes('chaves { soltas } {{ }} {nome}'), [])
})

Deno.test('respostas rápidas: só "/atalho" inteiro é atalho', () => {
  eq(atalhoDigitado('/ola'), 'ola'); eq(atalhoDigitado(' /ola '), 'ola'); eq(atalhoDigitado('/'), '')
  eq(atalhoDigitado('ola'), null); eq(atalhoDigitado('/ola tudo bem?'), null); eq(atalhoDigitado('/Ola'), null)
  eq(atalhoDigitado('//'), null); eq(atalhoDigitado('/' + 'a'.repeat(21)), null); eq(atalhoDigitado('http://x'), null)
})

Deno.test('respostas rápidas: filtro ignora acento e caixa, e ordena atalho exato, equipe e título', () => {
  const lista = [
    R({ titulo: 'Preço', texto: 'Custa R$ 100', atalho: 'preco', dono_id: 'eu' }),
    R({ titulo: 'Endereço', texto: 'Rua X', atalho: 'end' }),
    R({ titulo: 'Preços da equipe', texto: 'Tabela', atalho: 'precos' }),
    R({ titulo: 'Horário', texto: 'Das 9h às 18h, endereço na rua', atalho: null }),
  ]
  eq(filtrar(lista, 'ENDERECO').map((r) => r.titulo), ['Endereço', 'Horário'])
  eq(filtrar(lista, '/preco').map((r) => r.titulo), ['Preço', 'Preços da equipe'], 'atalho exato primeiro')
  eq(filtrar(lista, '').map((r) => r.titulo), ['Endereço', 'Horário', 'Preços da equipe', 'Preço'], 'sem termo: equipe antes, depois por título')
  eq(filtrar(lista, 'zzz'), [])
})

Deno.test('respostas rápidas: /atalho expande já preenchido; pessoal vence a da equipe; desconhecido não expande', () => {
  const lista = [R({ titulo: 'A', texto: 'Da equipe, {{nome}}', atalho: 'oi' }), R({ titulo: 'B', texto: 'Minha, {{primeiro_nome}}', atalho: 'oi', dono_id: 'eu' })]
  eq(expandirAtalho('/oi', lista, { nome: 'Ana Maria' }), 'Minha, Ana')
  eq(expandirAtalho('/oi', [lista[0]], { nome: null }), 'Da equipe, {{nome}}')
  eq(expandirAtalho('/nada', lista, { nome: 'Ana' }), null)
  eq(expandirAtalho('oi', lista, { nome: 'Ana' }), null)
})

