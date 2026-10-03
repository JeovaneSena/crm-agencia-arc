import { classificarOptOut, ehOptOutProvavel, ehPedidoDeOptOut, normalizar } from './optout.ts'

function assert(v: unknown, m = 'Assertion failed'): asserts v { if (!v) throw new Error(m) }

// Frases reais de quem quer sair: todas precisam ser 'pedido' (e só 'pedido' revoga consentimento).
const PEDIDOS = [
  'SAIR', 'Sair!', 'parar.', 'STOP', 'Pare', 'cancelar mensagens', 'Não quero receber mensagens.', 'não me envie mais mensagens',
  'não quero mais receber nada', 'Não quero mais receber essas mensagens, por favor', 'pare de me mandar mensagem',
  'parem de enviar mensagens', 'para de me ligar', 'pare de insistir', 'pode parar de me chamar?', 'tem como parar de me mandar propaganda?',
  'não me mande mais mensagem', 'Não me ligue mais', 'não me procure mais', 'não me chame mais', 'me tira da lista', 'me tire da lista de vocês',
  'quero sair da lista', 'remova meu número da lista de contatos', 'descadastrar', 'quero me descadastrar', 'unsubscribe',
  'cancelar minha inscrição', 'cancele a assinatura da newsletter', 'por favor pare de me enviar mensagens no whatsapp',
]
// Frases do dia a dia do negócio que contêm as mesmas palavras e NÃO são pedido de saída.
const NAO_SAO_PEDIDO = [
  'tem como parar a dor?', 'posso sair antes das 15h?', 'preciso sair mais cedo da reunião', 'quero cancelar minha reunião de amanhã',
  'não quero parar de receber', 'vou parar de procurar outro fornecedor', 'preciso parar de enviar os arquivos por email',
  'quero parar de falar com o outro fornecedor', 'pare de mandar o pedido, eu retiro', 'parar de mandar a fatura por aqui',
  'quero entrar na lista de espera', 'quero sair da lista de espera', 'me tira da lista de presentes', 'não quero receber ligação, só WhatsApp',
  'não quero receber o boleto por aqui', 'pode me mandar mais informações?', 'não consegui receber o arquivo', 'Bom dia!', 'sim', 'não', '',
  'como faço para cancelar o pedido?', 'preciso remover a foto do site', 'o convênio não me recebe mais', 'a dor não me perturba mais',
]
const PROVAVEIS = [
  'me deixa em paz', 'Me deixe em paz!', 'chega', 'cancelar', 'não tenho interesse', 'Sem interesse', 'não quero mais', 'isso é spam',
  'vou denunciar vocês', 'chega de mensagens', 'não insista', 'cancelar meu cadastro', 'não me manda mais isso',
]

Deno.test('pedidos inequívocos: cada frase é "pedido"', () => {
  for (const f of PEDIDOS) assert(classificarOptOut(f) === 'pedido', `deveria ser pedido: "${f}" → ${classificarOptOut(f)}`)
})

Deno.test('frases do dia a dia não são opt-out, nem provável', () => {
  for (const f of NAO_SAO_PEDIDO) assert(classificarOptOut(f) === 'nenhum', `deveria ser nenhum: "${f}" → ${classificarOptOut(f)}`)
})

Deno.test('ambíguos são "provável": calam a IA mas não revogam', () => {
  for (const f of PROVAVEIS) {
    assert(classificarOptOut(f) === 'provavel', `deveria ser provável: "${f}" → ${classificarOptOut(f)}`)
    assert(!ehPedidoDeOptOut(f) && ehOptOutProvavel(f))
  }
})

Deno.test('ausente, vazio e texto enorme não quebram', () => {
  assert(classificarOptOut(null) === 'nenhum' && classificarOptOut(undefined) === 'nenhum' && classificarOptOut('   ') === 'nenhum')
  const longo = 'a '.repeat(50_000) + 'pare de me mandar mensagem'
  assert(classificarOptOut(longo) === 'nenhum', 'só os primeiros 1000 caracteres contam')
  assert(classificarOptOut('olá '.repeat(100) + 'pare de me mandar mensagem') === 'pedido')
})

Deno.test('normalizar: sem acento, caixa, pontuação nem emoji', () => {
  assert(normalizar('  NÃO   quero,  receber!!! 😡 ') === 'nao quero receber')
})
