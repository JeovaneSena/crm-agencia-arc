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

// ---------- notas internas ----------
import { mesclarConversa, type NotaConversa } from '../../src/lib/conversaMesclada.ts'
Deno.test('notas: entram na conversa na ordem do tempo, depois da mensagem do mesmo instante', () => {
  const msgs = [{ id: 'm1', criada_em: '2026-10-03T10:00:00Z' }, { id: 'm2', criada_em: '2026-10-03T10:05:00Z' }]
  const nota = (id: string, created_at: string): NotaConversa => ({ id, contato_id: 'c', texto: 't', autor_id: null, created_at, autor: null })
  const lista = mesclarConversa(msgs, [nota('n2', '2026-10-03T10:05:00Z'), nota('n1', '2026-10-03T10:02:00Z')])
  eq(lista.map((i) => (i.tipo === 'mensagem' ? i.mensagem.id : i.nota.id)), ['m1', 'n1', 'm2', 'n2'])
  eq(mesclarConversa(msgs, []).length, 2)
  eq(mesclarConversa([], []), [])
})

// ---------- adiar conversa ----------
import { estaAdiada, opcoesDeAdiamento } from '../../src/lib/adiar.ts'
Deno.test('adiar: as opções são futuras, em ordem, e "segunda" nunca é hoje', () => {
  // quarta-feira, 15h
  const quarta = new Date(2026, 9, 7, 15, 0, 0)
  const o = opcoesDeAdiamento(quarta)
  eq(o.map((x) => x.id), ['1h', '3h', 'amanha', '3d', 'segunda'])
  assert(o.every((x) => x.ate.getTime() > quarta.getTime()), 'todas no futuro')
  assert(o.every((x, i) => i === 0 || x.ate.getTime() >= o[i - 1].ate.getTime()), 'em ordem')
  eq([o[2].ate.getDate(), o[2].ate.getHours()], [8, 9]); eq([o[3].ate.getDate(), o[3].ate.getHours()], [10, 9])
  eq([o[4].ate.getDay(), o[4].ate.getDate()], [1, 12])
  // segunda-feira: a "segunda" é a próxima, não hoje; domingo: é amanhã
  eq(opcoesDeAdiamento(new Date(2026, 9, 5, 8, 0, 0))[4].ate.getDate(), 12)
  eq(opcoesDeAdiamento(new Date(2026, 9, 4, 23, 30, 0))[4].ate.getDate(), 5)
  // virada de mês
  const fim = opcoesDeAdiamento(new Date(2026, 9, 31, 20, 0, 0))
  eq([fim[2].ate.getMonth(), fim[2].ate.getDate()], [10, 1])
})
Deno.test('adiar: só está adiada com data no futuro', () => {
  const agora = Date.parse('2026-10-03T12:00:00Z')
  eq(estaAdiada({ adiada_ate: '2026-10-03T13:00:00Z' }, agora), true)
  eq(estaAdiada({ adiada_ate: '2026-10-03T11:00:00Z' }, agora), false)
  eq(estaAdiada({ adiada_ate: null }, agora), false); eq(estaAdiada({}, agora), false)
})

