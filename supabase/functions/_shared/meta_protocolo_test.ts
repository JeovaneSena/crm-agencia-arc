// O protocolo da Meta (assinatura, lotes do webhook, modelos) sem rede.
import { assinaturaValida, camposModelo, dataMeta, eventosContaMeta, eventosMeta, mensagemMeta, preencherModelo, descreverModeloCampanha, type ModeloMeta } from './meta-protocolo.ts'

function assert(v: unknown, m = 'Assertion failed'): asserts v { if (!v) throw new Error(m) }

Deno.test('webhook: assinatura válida, corpo alterado, ausente e malformada', async () => {
  const raw = '{"entry":[]}', segredo = 'segredo-de-teste'
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const hash = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)))
  const sig = 'sha256=' + Array.from(hash, x => x.toString(16).padStart(2, '0')).join('')
  assert(await assinaturaValida(raw, sig, segredo))
  assert(!await assinaturaValida(raw + ' ', sig, segredo))
  assert(!await assinaturaValida(raw, null, segredo))
  assert(!await assinaturaValida(raw, 'sha256=invalida', segredo))
  assert(!await assinaturaValida(raw, sig, 'outro-segredo'))
  assert(!await assinaturaValida(raw, sig, ''), 'segredo vazio nunca valida')
})

Deno.test('webhook em lote: isola conta e número, preserva todas as mensagens e recibos', () => {
  const ts = String(Math.floor(Date.now() / 1000))
  const value = { metadata: { phone_number_id: '123' }, messages: [{ id: 'm1', from: '5511999999999', timestamp: ts, type: 'text', text: { body: 'Olá' } }, { id: 'm2', from: '5511999999999', timestamp: ts, type: 'audio', audio: { id: '99' } }], statuses: [{ id: 's1', status: 'read', timestamp: ts }] }
  const body = { object: 'whatsapp_business_account', entry: [{ id: '999', changes: [{ field: 'messages', value }] }, { id: '456', changes: [{ field: 'messages', value }, { field: 'messages', value: { ...value, metadata: { phone_number_id: 'errado' } } }] }] }
  const eventos = eventosMeta(body, '456', '123')
  assert(eventos.length === 3)
  assert(mensagemMeta(eventos[0].dados).texto === 'Olá')
  assert(mensagemMeta(eventos[1].dados).midia?.via === 'meta')
  assert(eventosMeta(body, 'nenhuma', '123').length === 0)
  assert(eventosMeta({ object: 'outro', entry: body.entry }, '456', '123').length === 0)
  assert(dataMeta(String(Math.floor(Date.now() / 1000) + 86400)) === null, 'data futura não abre janela')
})

Deno.test('eventos da conta: estado e qualidade do modelo, capacidade do número', () => {
  const body = { object: 'whatsapp_business_account', entry: [{ id: '456', time: 1739321024, changes: [
    { field: 'message_template_status_update', value: { event: 'APPROVED', message_template_id: 123, message_template_name: 'promo', message_template_language: 'pt_BR' } },
    { field: 'message_template_quality_update', value: { previous_quality_score: 'YELLOW', new_quality_score: 'RED', message_template_id: 123, message_template_name: 'promo', message_template_language: 'pt_BR' } },
    { field: 'business_capability_update', value: { max_daily_conversations_per_business: 'TIER_2K', max_phone_numbers_per_waba: 25 } },
  ] }] }
  const eventos = eventosContaMeta(body, '456', '999')
  assert(eventos.length === 3)
  assert(eventos[0].tipo === 'modelo_status' && eventos[0].valor === 'APPROVED')
  assert(eventos[1].tipo === 'modelo_qualidade' && eventos[1].valor === 'RED')
  assert(eventos[2].tipo === 'capacidade' && eventos[2].dados.limite_diario === 2000)
  assert(eventosContaMeta(body, 'outra', '999').length === 0)
})

const MODELO: ModeloMeta = { id: '1', name: 'teste', language: 'pt_BR', status: 'APPROVED', category: 'MARKETING', components: [{ type: 'HEADER', format: 'TEXT', text: 'Olá {{1}}' }, { type: 'BODY', text: 'Seu pedido {{1}} está pronto em {{2}}' }, { type: 'FOOTER', text: 'Rodapé' }] }

Deno.test('modelos: texto posicional, conteúdo estático; mídia, nomeado e reprovado não passam', () => {
  assert(camposModelo(MODELO)?.[1].quantidade === 2)
  const r = preencherModelo(MODELO, { header: ['Ana'], body: ['10', 'segunda'] })
  assert(r.texto === 'Olá Ana\nSeu pedido 10 está pronto em segunda\nRodapé')
  assert(r.components.length === 2)
  let falhou = false; try { preencherModelo(MODELO, { body: ['10'] }) } catch { falhou = true } assert(falhou, 'faltou parâmetro e passou')
  assert(camposModelo({ ...MODELO, status: 'PAUSED' }) === null)
  assert(camposModelo({ ...MODELO, parameter_format: 'NAMED' }) === null)
  assert(camposModelo({ ...MODELO, components: [{ type: 'HEADER', format: 'IMAGE' }] }) === null)
  assert(camposModelo({ ...MODELO, components: [{ type: 'BODY', text: 'Olá {{2}}' }] }) === null)
  assert(camposModelo({ ...MODELO, components: [{ type: 'BUTTONS', buttons: [{ type: 'URL', url: 'https://exemplo.com/{{1}}' }] }] }) === null)
})

Deno.test('campanha só aceita modelo de marketing aprovado e com qualidade', () => {
  assert(descreverModeloCampanha(MODELO).compativel)
  assert(!descreverModeloCampanha({ ...MODELO, category: 'UTILITY' }).compativel)
  assert(!descreverModeloCampanha({ ...MODELO, category: 'AUTHENTICATION' }).compativel)
  assert(!descreverModeloCampanha({ ...MODELO, status: 'REJECTED' }).compativel)
  assert(!descreverModeloCampanha({ ...MODELO, quality_score: { score: 'RED' } }).compativel)
})
