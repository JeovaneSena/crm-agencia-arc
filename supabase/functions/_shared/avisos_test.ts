// Sem dependência externa, como os outros testes de `_shared`.
import { abrirAviso, argumentosDoAviso, resolverAviso, type Rpc } from './avisos.ts'

function assertEquals(real: unknown, esperado: unknown, msg = ''): void {
  if (JSON.stringify(real) !== JSON.stringify(esperado)) throw new Error(`${msg} esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(real)}`)
}
function assertThrows(f: () => unknown): void {
  try { f() } catch { return }
  throw new Error('deveria ter lançado')
}

Deno.test('argumentos: corta no limite do banco e normaliza o opcional', () => {
  const a = argumentosDoAviso({ tipo: 'conexao_caida', gravidade: 'critico', titulo: `  ${'t'.repeat(300)}  `, detalhe: '   ', chave: 'k'.repeat(500) })
  assertEquals((a.p_titulo as string).length, 120)
  assertEquals((a.p_chave as string).length, 120)
  assertEquals(a.p_detalhe, null)
  assertEquals(a.p_rota, null)
  assertEquals(a.p_somente_gestor, false)
  assertEquals('p_silencio_horas' in a, false)
})

Deno.test('argumentos: rota só se for caminho interno', () => {
  const rota = (r: string) => argumentosDoAviso({ tipo: 'abc', gravidade: 'info', titulo: 't', rota: r }).p_rota
  assertEquals(rota('/conversas?filtro=equipe'), '/conversas?filtro=equipe')
  assertEquals(rota('https://x.example'), null)
  assertEquals(rota('//x.example'), null)
  assertEquals(rota('javascript:alert(1)'), null)
  assertEquals(rota('/a b'), null)
})

Deno.test('argumentos: tipo ruim e título vazio são erro de programação', () => {
  assertThrows(() => argumentosDoAviso({ tipo: 'Conexão', gravidade: 'info', titulo: 't' }))
  assertThrows(() => argumentosDoAviso({ tipo: 'ab', gravidade: 'info', titulo: 't' }))
  assertThrows(() => argumentosDoAviso({ tipo: 'abc', gravidade: 'info', titulo: '   ' }))
})

Deno.test('abrirAviso chama a função certa e devolve o id', async () => {
  const chamadas: [string, Record<string, unknown>][] = []
  const rpc = (async (nome: string, args: Record<string, unknown>) => { chamadas.push([nome, args]); return 'id-1' }) as Rpc
  assertEquals(await abrirAviso(rpc, { tipo: 'mensagem_presa', chave: 'c1', gravidade: 'atencao', titulo: 'Não saiu', silencioHoras: 2 }), 'id-1')
  assertEquals(chamadas[0][0], 'aviso_abrir')
  assertEquals(chamadas[0][1].p_silencio_horas, 2)
})

Deno.test('abrirAviso e resolverAviso nunca lançam', async () => {
  const quebrado = (async () => { throw new Error('rede caiu') }) as Rpc
  assertEquals(await abrirAviso(quebrado, { tipo: 'mensagem_presa', gravidade: 'info', titulo: 't' }), null)
  assertEquals(await abrirAviso(quebrado, { tipo: 'RUIM', gravidade: 'info', titulo: 't' }), null)
  assertEquals(await resolverAviso(quebrado, 'mensagem_presa'), 0)
})

Deno.test('abrirAviso devolve null quando o banco silencia (dispensado há pouco)', async () => {
  const rpc = (async () => null) as Rpc
  assertEquals(await abrirAviso(rpc, { tipo: 'mensagem_presa', gravidade: 'info', titulo: 't' }), null)
})

Deno.test('resolverAviso manda a chave ou null', async () => {
  const vistos: unknown[] = []
  const rpc = (async (_n: string, args: Record<string, unknown>) => { vistos.push(args); return 2 }) as Rpc
  assertEquals(await resolverAviso(rpc, 'conexao_caida'), 2)
  await resolverAviso(rpc, 'mensagem_presa', 'c1')
  assertEquals(vistos, [{ p_tipo: 'conexao_caida', p_chave: null }, { p_tipo: 'mensagem_presa', p_chave: 'c1' }])
})
