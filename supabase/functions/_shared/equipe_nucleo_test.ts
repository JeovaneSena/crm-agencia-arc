import { alvoDaOperacao, emailValido, erroEquipe, traduzirAuth } from './equipe-nucleo.ts'

function assert(valor: unknown, mensagem = 'Assertion failed'): asserts valor {
  if (!valor) throw new Error(mensagem)
}
function recusa(fn: () => unknown, trecho: string): void {
  try { fn() } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    assert(m.includes(trecho), `recusa veio com a mensagem errada: ${m}`)
    return
  }
  throw new Error(`deveria ter recusado, esperando "${trecho}"`)
}

const EU = '695b56dc-46f7-40bc-8cd2-dc60dbd7c4cc'
const OUTRO = '11111111-2222-3333-4444-555555555555'

Deno.test('a tela de equipe nunca mexe na conta de quem pediu', () => {
  assert(alvoDaOperacao({ usuario_id: OUTRO }, EU) === OUTRO)
  recusa(() => alvoDaOperacao({ usuario_id: EU }, EU), 'própria conta')
  recusa(() => alvoDaOperacao({ usuario_id: 'nao-e-uuid' }, EU), 'Conta inválida')
  recusa(() => alvoDaOperacao({}, EU), 'Conta inválida')
})

Deno.test('o e-mail do convite chega normalizado, ou não chega', () => {
  assert(emailValido('  Fulano@Empresa.COM  ') === 'fulano@empresa.com')
  recusa(() => emailValido('fulano@empresa'), 'e-mail válido')
  recusa(() => emailValido('sem arroba'), 'e-mail válido')
  recusa(() => emailValido(''), 'e-mail válido')
  recusa(() => emailValido(42), 'Confira os dados')
})

Deno.test('a recusa do GoTrue vira português, sem detalhe interno', () => {
  assert(traduzirAuth(422, '{"msg":"A user with this email address has already been registered"}').includes('Já existe uma conta'))
  assert(traduzirAuth(429, '{"msg":"email rate limit exceeded"}').includes('SMTP'))
  assert(traduzirAuth(400, '{"msg":"Redirect URL is not allowed"}').includes('Auth do Supabase'))
  assert(!traduzirAuth(500, '{"msg":"pq: duplicate key value violates unique constraint"}').includes('pq:'), 'detalhe do Postgres vazou')
})

Deno.test('a trava do último gestor e a do histórico chegam explicadas', () => {
  const ultimo = erroEquipe(new Error('update usuarios: 400 A base precisa de pelo menos um gestor ativo.'))
  assert(ultimo.status === 409 && (ultimo.corpo as { codigo: string }).codigo === 'ULTIMO_GESTOR')
  const hist = erroEquipe(new Error('Esta conta possui histórico no CRM. Desligue-a'))
  assert(hist.status === 409 && (hist.corpo as { codigo: string }).codigo === 'COM_HISTORICO')
  // texto cru do banco nunca vai para a tela
  const cru = erroEquipe(new Error('update usuarios: 500 relation "x" does not exist'))
  assert(!JSON.stringify(cru.corpo).includes('relation'))
})
