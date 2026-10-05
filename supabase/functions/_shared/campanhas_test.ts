// A fila de campanhas, o webhook e as rotas da função, sem banco nem Meta: tudo entra por dependências falsas.
Deno.env.set('SUPABASE_URL', 'https://teste.supabase.co')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
Deno.env.set('SUPABASE_ANON_KEY', 'anon')
Deno.env.set('META_APP_SECRET', 'segredo-do-app')
Deno.env.set('META_VERIFY_TOKEN', 'token-de-verificacao')
Deno.env.set('META_ACCESS_TOKEN', 'token-de-acesso')
Deno.env.set('META_PHONE_NUMBER_ID', '123')
Deno.env.set('META_WABA_ID', '456')
Deno.env.set('META_GRAPH_VERSION', 'v21.0')
Deno.env.set('CAMPANHAS_WORKER_SECRET', 'segredo-do-trabalhador-com-mais-de-24-letras')

import { classificarErroEnvio, ehOptOut, processarLote, tratarWebhook, type DepsCampanhas, type DepsWebhook, type Lote, type Resultado } from './campanhas.ts'
import { ErroMeta } from './meta-api.ts'
import { descreverModeloGestao, montarCriacaoDeModelo, type EntradaDeModelo } from './meta-protocolo.ts'
import type { ModeloMeta } from './meta-protocolo.ts'

function assert(v: unknown, m = 'Assertion failed'): asserts v { if (!v) throw new Error(m) }

const MODELO: ModeloMeta = { id: 'm1', name: 'promo_outubro', language: 'pt_BR', status: 'APPROVED', category: 'MARKETING', components: [{ type: 'BODY', text: 'Olá {{1}}, {{2}}' }] }
const LOTE: Lote = { destinatario_id: 'd1', campanha_id: 'c1', contato_id: 'p1', whatsapp: '5511900000001', valores: { body: ['Maria', 'temos novidades'] }, lease_token: 't1',
  modelo_id: 'm1', modelo_nome: 'promo_outubro', modelo_idioma: 'pt_BR', pedido_id: 'ped1', tentativas: 1 }

// ---------- classificação do erro (depois que a chamada começou) ----------

Deno.test('erro de envio: incerto nunca repete; limite explícito repete com espera crescente; recusa é falha', () => {
  assert(classificarErroEnvio(new ErroMeta('x', true)).resultado === 'incerto')
  const a = classificarErroEnvio(new ErroMeta('x', false, 130429, 429, true), 1), b = classificarErroEnvio(new ErroMeta('x', false, 130429, 429, true), 3)
  assert(a.resultado === 'repetir' && a.repetirEmSegundos === 60 && b.repetirEmSegundos === 240)
  assert(classificarErroEnvio(new ErroMeta('x', false, 130429, 429, true), 20).repetirEmSegundos === 900, 'teto de 15 min')
  const recusa = classificarErroEnvio(new ErroMeta('A Meta recusou', false, 131026, 400))
  assert(recusa.resultado === 'falhou' && !recusa.revogar)
  const optout = classificarErroEnvio(new ErroMeta('x', false, 131050, 400))
  assert(optout.resultado === 'falhou' && optout.revogar === true, 'erro 131050 revoga o consentimento')
  assert(classificarErroEnvio(new Error('estourou')).resultado === 'incerto', 'erro desconhecido depois da chamada é incerto, nunca falha segura')
})

Deno.test('opt-out: só a mensagem inteira, com acento e pontuação', () => {
  assert(ehOptOut('SAIR!') && ehOptOut('Não quero receber mensagens.') && ehOptOut('  não   me envie mais mensagens  ') && ehOptOut('Parar'))
  assert(!ehOptOut('quero cancelar minha consulta') && !ehOptOut('não quero parar de receber') && !ehOptOut(null) && !ehOptOut(''))
})

// ---------- a fila ----------

interface Registro { reservas: string[]; chamadas: string[]; envios: { numero: string; nome: string; componentes: unknown[]; correlacao: string }[]; finais: { id: string; resultado: Resultado; idExterno: string | null; erro: string | null; repetirEm: number | null }[]; pausas: string[]; revogacoes: string[]; ordem: string[] }
function fila(o: { lote?: Lote[]; catalogo?: ModeloMeta[] | 'falha'; reserva?: { ok: false; motivo: string }; envio?: () => Promise<{ id: string; estado: 'aceito' | 'retido' }>; chamada?: boolean } = {}): { deps: DepsCampanhas; r: Registro } {
  const r: Registro = { reservas: [], chamadas: [], envios: [], finais: [], pausas: [], revogacoes: [], ordem: [] }
  const deps: DepsCampanhas = {
    reivindicar: () => Promise.resolve(o.lote ?? [LOTE]),
    modelos: () => o.catalogo === 'falha' ? Promise.reject(new Error('Meta fora')) : Promise.resolve(o.catalogo ?? [MODELO]),
    reservar: (id, _t, texto) => { r.reservas.push(texto); r.ordem.push('reservar'); return Promise.resolve(o.reserva ?? { ok: true as const, mensagem_id: 'msg-' + id }) },
    marcarChamada: (id) => { r.chamadas.push(id); r.ordem.push('chamada'); return Promise.resolve(o.chamada ?? true) },
    enviar: (numero, nome, _i, componentes, correlacao) => { r.ordem.push('enviar'); r.envios.push({ numero, nome, componentes, correlacao }); return (o.envio ?? (() => Promise.resolve({ id: 'wamid.1', estado: 'aceito' as const })))() },
    finalizar: (id, _t, resultado, idExterno, erro, repetirEm) => { r.ordem.push('finalizar'); r.finais.push({ id, resultado, idExterno, erro, repetirEm }); return Promise.resolve() },
    pausarCampanha: (id) => { r.pausas.push(id); return Promise.resolve() },
    revogarConsentimento: (id) => { r.revogacoes.push(id); return Promise.resolve() },
  }
  return { deps, r }
}

Deno.test('caminho feliz: reserva, marca a chamada ANTES de enviar, envia o modelo com os parâmetros e finaliza aceito', async () => {
  const { deps, r } = fila()
  const s = await processarLote(deps, 10)
  assert(s.processados === 1 && s.aceitos === 1)
  assert(r.ordem.join() === 'reservar,chamada,enviar,finalizar', r.ordem.join())
  assert(r.reservas[0] === 'Olá Maria, temos novidades')
  assert(r.envios[0].numero === '5511900000001' && r.envios[0].nome === 'promo_outubro' && r.envios[0].correlacao === 'ped1')
  assert(JSON.stringify(r.envios[0].componentes) === '[{"type":"body","parameters":[{"type":"text","text":"Maria"},{"type":"text","text":"temos novidades"}]}]')
  assert(r.finais[0].resultado === 'aceito' && r.finais[0].idExterno === 'wamid.1')
})

Deno.test('resposta retida pela Meta é guardada como retida (e nunca reenviada)', async () => {
  const { deps, r } = fila({ envio: () => Promise.resolve({ id: 'wamid.2', estado: 'retido' }) })
  await processarLote(deps)
  assert(r.finais[0].resultado === 'retido' && r.envios.length === 1)
})

Deno.test('o banco recusou a reserva (cancelada, pausada ou sem consentimento): nada é enviado', async () => {
  const { deps, r } = fila({ reserva: { ok: false, motivo: 'sem_consentimento' } })
  const s = await processarLote(deps)
  assert(s.ignorados === 1 && r.envios.length === 0 && r.chamadas.length === 0 && r.finais.length === 0)
})

Deno.test('sem marcar a chamada não há envio', async () => {
  const { deps, r } = fila({ chamada: false })
  await processarLote(deps)
  assert(r.envios.length === 0 && r.finais.length === 0)
})

Deno.test('modelo reprovado, alterado ou ausente na Meta: pausa a campanha UMA vez e devolve à fila, sem enviar', async () => {
  for (const catalogo of [[{ ...MODELO, status: 'REJECTED' }], [{ ...MODELO, name: 'outro_nome' }], [], [{ ...MODELO, category: 'UTILITY' }]]) {
    const { deps, r } = fila({ catalogo, lote: [LOTE, { ...LOTE, destinatario_id: 'd2' }] })
    const s = await processarLote(deps)
    assert(r.envios.length === 0 && r.reservas.length === 0, 'enviou com modelo inválido')
    assert(r.pausas.length === 1 && r.pausas[0] === 'c1' && s.pausadas === 1, 'deveria pausar uma vez')
    assert(r.finais.length === 2 && r.finais.every(f => f.resultado === 'repetir'))
  }
})

Deno.test('Meta fora do ar ao listar modelos: devolve à fila e não envia', async () => {
  const { deps, r } = fila({ catalogo: 'falha' })
  const s = await processarLote(deps)
  assert(s.repetidos === 1 && r.envios.length === 0 && r.finais[0].resultado === 'repetir')
})

Deno.test('parâmetros que não fecham com o modelo: falha só este destinatário, sem enviar', async () => {
  const { deps, r } = fila({ lote: [{ ...LOTE, valores: { body: ['só um'] } }] })
  const s = await processarLote(deps)
  assert(s.falhas === 1 && r.envios.length === 0 && r.finais[0].resultado === 'falhou')
})

Deno.test('Meta recusa, estoura limite ou fica incerta: cada caso termina no estado certo', async () => {
  const casos: [() => Promise<never>, Resultado][] = [
    [() => Promise.reject(new ErroMeta('recusou', false, 131026, 400)), 'falhou'],
    [() => Promise.reject(new ErroMeta('limite', false, 130429, 429, true)), 'repetir'],
    [() => Promise.reject(new ErroMeta('timeout', true)), 'incerto'],
  ]
  for (const [envio, esperado] of casos) {
    const { deps, r } = fila({ envio })
    await processarLote(deps)
    assert(r.finais.length === 1 && r.finais[0].resultado === esperado, `esperava ${esperado}, veio ${r.finais[0]?.resultado}`)
    assert(r.envios.length === 1, 'tentou mais de uma vez no mesmo ciclo')
  }
})

Deno.test('erro 131050 (contato não quer marketing): falha e revoga o consentimento', async () => {
  const { deps, r } = fila({ envio: () => Promise.reject(new ErroMeta('x', false, 131050, 400)) })
  await processarLote(deps)
  assert(r.finais[0].resultado === 'falhou' && r.revogacoes.join() === 'p1')
})

Deno.test('o limite do lote é respeitado e fila vazia não chama a Meta', async () => {
  const vazia = fila({ lote: [] })
  const s = await processarLote(vazia.deps)
  assert(s.processados === 0)
  const pedidos: number[] = []
  const f = fila(); f.deps.reivindicar = (l) => { pedidos.push(l); return Promise.resolve([]) }
  await processarLote(f.deps, 9999); await processarLote(f.deps, 0)
  assert(pedidos.join() === '50,1', `o teto do lote é 50 e o piso é 1 (${pedidos})`)
})

// ---------- webhook ----------

function webhook() {
  const log = { status: [] as string[], revogados: [] as string[], gravadas: [] as string[] }
  const deps: DepsWebhook = {
    status: (id, status, erro) => { log.status.push(`${id}:${status}:${erro ?? ''}`); return Promise.resolve(true) },
    contatoDaMensagem: (id) => Promise.resolve(id === 'wamid.1' ? 'p1' : null),
    contatoPorWhatsapp: (w) => Promise.resolve(w === '5511900000001' ? 'p1' : null),
    revogarConsentimento: (id, fonte) => { log.revogados.push(id + ':' + fonte); return Promise.resolve() },
    gravarRecebida: (w, id, _t, texto) => { log.gravadas.push(`${w}:${id}:${texto}`); return Promise.resolve() },
  }
  return { deps, log }
}
const ts = () => String(Math.floor(Date.now() / 1000))
const corpo = (value: Record<string, unknown>) => ({ object: 'whatsapp_business_account', entry: [{ id: '456', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '123' }, ...value } }] }] })

Deno.test('webhook: recibo atualiza o estado; falha com 131050 revoga o consentimento', async () => {
  const { deps, log } = webhook()
  const r = await tratarWebhook(deps, corpo({ statuses: [
    { id: 'wamid.1', status: 'delivered', timestamp: ts() },
    { id: 'wamid.1', status: 'failed', timestamp: ts(), errors: [{ code: 131050, title: 'Usuário optou por não receber' }] },
  ] }), '456', '123')
  assert(r.status === 2 && r.optouts === 1)
  assert(log.status[0] === 'wamid.1:delivered:' && log.status[1].startsWith('wamid.1:failed:Usuário optou'))
  assert(log.revogados.length === 1 && log.revogados[0].startsWith('p1:'))
})

Deno.test('webhook: "SAIR" revoga E a mensagem continua gravada na conversa; mensagem comum só grava', async () => {
  const { deps, log } = webhook()
  const r = await tratarWebhook(deps, corpo({ messages: [
    { id: 'in1', from: '5511900000001', timestamp: ts(), type: 'text', text: { body: 'Sair' } },
    { id: 'in2', from: '5511900000009', timestamp: ts(), type: 'text', text: { body: 'Quero saber o preço' } },
    { id: 'in3', from: '5511900000009', timestamp: ts(), type: 'text', text: { body: 'sair' } },   // contato desconhecido: nada a revogar
  ] }), '456', '123')
  assert(r.mensagens === 3 && r.optouts === 1)
  assert(log.revogados.length === 1 && log.gravadas.length === 3)
})

Deno.test('webhook: outra conta ou outro número é ignorado por inteiro', async () => {
  const { deps, log } = webhook()
  const outra = { object: 'whatsapp_business_account', entry: [{ id: '999', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '123' }, statuses: [{ id: 'x', status: 'read', timestamp: ts() }] } }] }] }
  const r = await tratarWebhook(deps, outra, '456', '123')
  assert(r.status === 0 && r.mensagens === 0 && log.status.length === 0)
})

// ---------- rotas ----------

const { handler } = await import('../campanhas/index.ts')
const chamada = (caminho: string, init?: RequestInit) => handler(new Request(`https://teste.supabase.co/functions/v1/campanhas${caminho}`, init))

Deno.test('rota: verificação do webhook só com o token certo', async () => {
  const bom = await chamada('/webhook?hub.mode=subscribe&hub.verify_token=token-de-verificacao&hub.challenge=abc123')
  assert(bom.status === 200 && await bom.text() === 'abc123')
  assert((await chamada('/webhook?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=abc')).status === 403)
})

Deno.test('rota: webhook com assinatura inválida é recusado antes de tocar em qualquer coisa', async () => {
  const r = await chamada('/webhook', { method: 'POST', headers: { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) }, body: '{"entry":[]}' })
  assert(r.status === 401)
  assert((await chamada('/webhook', { method: 'POST', body: '{}' })).status === 401, 'sem assinatura')
})

Deno.test('rota: processar exige o segredo do trabalhador; modelos e conta exigem sessão', async () => {
  assert((await chamada('/processar', { method: 'POST' })).status === 401)
  assert((await chamada('/processar', { method: 'POST', headers: { Authorization: 'Bearer errado' } })).status === 401)
  assert((await chamada('/modelos')).status === 401)
  assert((await chamada('/conta')).status === 401)
  assert((await chamada('/inexistente')).status === 404)
})

// ---------- criar, listar e apagar modelos da Meta ----------

const BASE: EntradaDeModelo = { nome: 'promo_outubro', idioma: 'pt_BR', categoria: 'MARKETING', corpo: 'Olá {{1}}, temos novidades em {{2}}. Quer ver?', exemplos: ['Maria', 'outubro'], rodape: 'Responda SAIR para parar', botoes: ['Quero ver', 'Agora não'] }
const erroDe = (o: Partial<EntradaDeModelo>) => { const r = montarCriacaoDeModelo({ ...BASE, ...o }); return r.ok ? null : r.erro }

Deno.test('modelo: monta o corpo que a Meta espera (corpo com exemplo, rodapé e respostas rápidas)', () => {
  const r = montarCriacaoDeModelo(BASE)
  assert(r.ok)
  assert(JSON.stringify(r.corpo) === JSON.stringify({
    name: 'promo_outubro', language: 'pt_BR', category: 'MARKETING',
    components: [
      { type: 'BODY', text: 'Olá {{1}}, temos novidades em {{2}}. Quer ver?', example: { body_text: [['Maria', 'outubro']] } },
      { type: 'FOOTER', text: 'Responda SAIR para parar' },
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Quero ver' }, { type: 'QUICK_REPLY', text: 'Agora não' }] },
    ],
  }))
  const simples = montarCriacaoDeModelo({ ...BASE, corpo: 'Seu horário está confirmado.', exemplos: [], rodape: '', botoes: [], categoria: 'UTILITY' })
  assert(simples.ok && JSON.stringify(simples.corpo.components) === JSON.stringify([{ type: 'BODY', text: 'Seu horário está confirmado.' }]), 'sem variáveis: sem example')
})

Deno.test('modelo: recusa o que a Meta reprovaria, com a frase do que corrigir', () => {
  assert(erroDe({ nome: 'Promo Outubro' })?.includes('minúsculas'))
  assert(erroDe({ nome: '1promo' })?.includes('começa por letra'))
  assert(erroDe({ idioma: 'klingon' })?.includes('Idioma'))
  assert(erroDe({ categoria: 'AUTHENTICATION' as never })?.includes('Marketing ou Utilidade'))
  assert(erroDe({ corpo: '   ' })?.includes('Escreva o texto'))
  assert(erroDe({ corpo: 'x'.repeat(1025), exemplos: [] })?.includes('1024'))
  assert(erroDe({ corpo: 'Olá {{nome}}', exemplos: [] })?.includes('numeradas'))
  assert(erroDe({ corpo: 'Olá {{1}} e {{3}}', exemplos: ['a', 'b'] })?.includes('em sequência'))
  assert(erroDe({ corpo: '{{1}}, temos novidades', exemplos: ['Maria'] })?.includes('começa ou termina'))
  assert(erroDe({ corpo: 'Veja a oferta, {{1}}', exemplos: ['Maria'] })?.includes('começa ou termina'))
  assert(erroDe({ corpo: 'Oi {{1}}{{2}} tudo', exemplos: ['a', 'b'] })?.includes('coladas'))
  assert(erroDe({ exemplos: ['Maria'] })?.includes('exemplo para cada variável'))
  assert(erroDe({ exemplos: ['Maria', ''] })?.includes('exemplo para cada variável'))
  assert(erroDe({ corpo: 'Sem variável aqui.', exemplos: ['sobra'] })?.includes('não tem variáveis'))
  assert(erroDe({ rodape: 'x'.repeat(61) })?.includes('rodapé'))
  assert(erroDe({ rodape: 'Oi {{1}}' })?.includes('rodapé'))
  assert(erroDe({ botoes: ['a', 'b', 'c', 'd'] })?.includes('no máximo 3'))
  assert(erroDe({ botoes: ['x'.repeat(26)] })?.includes('25'))
  assert(erroDe({ botoes: ['Sim', 'sim'] })?.includes('repetir'))
})

Deno.test('modelo: a descrição de gestão mostra qualquer categoria, o motivo da reprovação e os botões', () => {
  const m = descreverModeloGestao({ id: '1', name: 'x', language: 'pt_BR', status: 'REJECTED', category: 'UTILITY', rejected_reason: 'INCORRECT_CATEGORY', quality_score: { score: 'GREEN' },
    components: [{ type: 'BODY', text: 'Oi' }, { type: 'FOOTER', text: 'Rodapé' }, { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Sim' }] }] })
  assert(m.status === 'REJECTED' && m.motivo === 'INCORRECT_CATEGORY' && m.corpo === 'Oi' && m.rodape === 'Rodapé' && m.botoes.join() === 'Sim' && m.qualidade === 'GREEN')
  assert(descreverModeloGestao({ id: '2', name: 'y', language: 'pt_BR', status: 'APPROVED', rejected_reason: 'NONE', components: [] }).motivo === null, 'NONE não é motivo')
})

interface ChamadaFalsa { url: string; metodo: string; corpo: string | null }
async function comMeta(f: (chamadas: ChamadaFalsa[]) => Promise<void>, o: { graph?: (u: URL, m: string) => { status: number; corpo: unknown }; campanhasEmUso?: boolean; papel?: string } = {}) {
  const original = globalThis.fetch, chamadas: ChamadaFalsa[] = []
  globalThis.fetch = ((entrada: Request | URL | string, init?: RequestInit) => {
    const u = new URL(typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url)
    const metodo = init?.method ?? 'GET'
    chamadas.push({ url: u.host + u.pathname + u.search, metodo, corpo: typeof init?.body === 'string' ? init.body : null })
    let corpo: unknown = [], status = 200
    if (u.pathname === '/auth/v1/user') corpo = { id: 'g1' }
    else if (u.pathname.endsWith('/usuarios')) corpo = [{ papel: o.papel ?? 'gestor', ativo: true }]
    else if (u.pathname.endsWith('/campanhas')) corpo = o.campanhasEmUso ? [{ id: 'c1' }] : []
    else if (u.host === 'graph.facebook.com') { const g = o.graph?.(u, metodo) ?? { status: 200, corpo: { data: [] } }; status = g.status; corpo = g.corpo }
    return Promise.resolve(new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } }))
  }) as typeof fetch
  try { await f(chamadas) } finally { globalThis.fetch = original }
}
const gestor = { Authorization: 'Bearer tok', 'Content-Type': 'application/json' }

Deno.test('rota modelos: criar, listar e apagar exigem gestor', async () => {
  for (const [caminho, metodo] of [['/modelos/todos', 'GET'], ['/modelos', 'POST'], ['/modelos/apagar', 'POST']]) {
    assert((await chamada(caminho, { method: metodo })).status === 401, `${metodo} ${caminho} sem sessão`)
  }
  await comMeta(async (chamadas) => {
    for (const [caminho, metodo] of [['/modelos/todos', 'GET'], ['/modelos', 'POST'], ['/modelos/apagar', 'POST']]) {
      const r = await chamada(caminho, { method: metodo, headers: gestor, body: metodo === 'POST' ? '{}' : undefined })
      assert(r.status === 403, `${metodo} ${caminho} como consultor deveria ser 403, veio ${r.status}`)
    }
    assert(!chamadas.some((c) => c.url.startsWith('graph.facebook.com')), 'consultor chegou à Meta')
  }, { papel: 'consultor' })
})

Deno.test('rota modelos: criar manda à Meta o corpo conferido; modelo inválido nem chega lá', async () => {
  await comMeta(async (chamadas) => {
    const ruim = await chamada('/modelos', { method: 'POST', headers: gestor, body: JSON.stringify({ ...BASE, nome: 'Nome Ruim' }) })
    assert(ruim.status === 400 && (await ruim.json()).motivo === 'modelo_invalido')
    assert(!chamadas.some((c) => c.url.startsWith('graph.facebook.com')), 'modelo inválido foi à Meta')
    const ok = await chamada('/modelos', { method: 'POST', headers: gestor, body: JSON.stringify(BASE) })
    const dados = await ok.json()
    assert(ok.status === 200 && dados.ok && dados.id === 'mt1' && dados.status === 'PENDING', JSON.stringify(dados))
    const g = chamadas.find((c) => c.url.startsWith('graph.facebook.com'))!
    assert(g.url.startsWith('graph.facebook.com/v21.0/456/message_templates') && g.metodo === 'POST')
    assert(JSON.parse(g.corpo!).name === 'promo_outubro' && JSON.parse(g.corpo!).components[0].example.body_text[0].join() === 'Maria,outubro')
  }, { graph: () => ({ status: 200, corpo: { id: 'mt1', status: 'PENDING', category: 'MARKETING' } }) })
})

Deno.test('rota modelos: Meta recusando vira erro claro; falha no meio vira "incerto"', async () => {
  await comMeta(async () => {
    const r = await chamada('/modelos', { method: 'POST', headers: gestor, body: JSON.stringify(BASE) })
    assert(r.status === 400 && (await r.json()).motivo === 'recusado_pela_meta')
  }, { graph: () => ({ status: 400, corpo: { error: { code: 100 } } }) })
  await comMeta(async () => {
    const r = await chamada('/modelos', { method: 'POST', headers: gestor, body: JSON.stringify(BASE) })
    assert(r.status === 502 && (await r.json()).motivo === 'incerto', 'erro 5xx na criação pode ter criado: incerto')
  }, { graph: () => ({ status: 503, corpo: {} }) })
})

Deno.test('rota modelos: apagar chama DELETE pelo nome, mas recusa modelo usado por campanha em aberto', async () => {
  await comMeta(async (chamadas) => {
    const r = await chamada('/modelos/apagar', { method: 'POST', headers: gestor, body: JSON.stringify({ nome: 'promo_outubro' }) })
    assert(r.status === 200)
    const g = chamadas.find((c) => c.url.startsWith('graph.facebook.com'))!
    assert(g.metodo === 'DELETE' && g.url.includes('/456/message_templates?name=promo_outubro') && g.corpo === null, 'DELETE pelo nome, sem corpo')
    assert((await chamada('/modelos/apagar', { method: 'POST', headers: gestor, body: JSON.stringify({ nome: 'Nome; drop' }) })).status === 400)
  }, { graph: () => ({ status: 200, corpo: { success: true } }) })
  await comMeta(async (chamadas) => {
    const r = await chamada('/modelos/apagar', { method: 'POST', headers: gestor, body: JSON.stringify({ nome: 'promo_outubro' }) })
    assert(r.status === 409 && (await r.json()).motivo === 'em_uso')
    assert(!chamadas.some((c) => c.url.startsWith('graph.facebook.com')), 'apagou na Meta um modelo em uso')
  }, { campanhasEmUso: true })
})

Deno.test('rota modelos: a lista de gestão traz todas as categorias e estados', async () => {
  await comMeta(async () => {
    const r = await (await chamada('/modelos/todos', { headers: gestor })).json()
    assert(r.ok && r.modelos.length === 2 && r.modelos.map((m: { status: string }) => m.status).join() === 'APPROVED,REJECTED')
    assert(r.modelos[1].motivo === 'ABUSIVE_CONTENT' && r.modelos[0].categoria === 'UTILITY')
  }, { graph: () => ({ status: 200, corpo: { data: [
    { id: '1', name: 'a', language: 'pt_BR', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Oi' }] },
    { id: '2', name: 'b', language: 'pt_BR', status: 'REJECTED', category: 'MARKETING', rejected_reason: 'ABUSIVE_CONTENT', components: [{ type: 'BODY', text: 'Oi' }] },
  ] } }) })
})

Deno.test('webhook: encaminha referral da conta/número correto junto à mensagem',async()=>{
 const {deps}=webhook()
 const recebidas: unknown[]=[]
 deps.gravarRecebida=(_w,_id,_t,_texto,referral)=>{recebidas.push(referral);return Promise.resolve()}
 const referral={source_type:'ad',source_id:'123',ctwa_clid:'click_26'}
 await tratarWebhook(deps,corpo({messages:[{id:'in-ref',from:'5511900000009',timestamp:ts(),type:'text',text:{body:'Olá'},referral}]}),'456','123')
 assert(JSON.stringify(recebidas)===JSON.stringify([referral]),'origem não chegou à gravação')
 await tratarWebhook(deps,corpo({messages:[{id:'in-ref',from:'5511900000009',timestamp:ts(),type:'text',referral}]}),'outra','123')
 assert(recebidas.length===1,'origem de outra conta aceita')
})
