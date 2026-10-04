// Testa a função do módulo conversas sem rede: `fetch` é substituído por um banco falso.
Deno.env.set('SUPABASE_URL', 'https://teste.supabase.co')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
Deno.env.set('SUPABASE_ANON_KEY', 'anon')
Deno.env.set('WEBHOOK_SEGREDO', 'segredo-de-teste')
Deno.env.set('UAZAPI_API_URL', 'https://uaz.invalid')
Deno.env.set('UAZAPI_TOKEN', 'tok')
Deno.env.set('VIGIA_SEGREDO', 'segredo-do-vigia-com-mais-de-24-letras')

const { handler } = await import('../whatsapp/index.ts')

function assert(valor: unknown, mensagem = 'Assertion failed'): asserts valor { if (!valor) throw new Error(mensagem) }

interface Chamada { url: string; metodo: string; corpo: unknown }
const chamadas: Chamada[] = []
let respostas: (u: URL, m: string, c: unknown) => unknown = () => []
const original = globalThis.fetch
function falso(): void {
  chamadas.length = 0
  globalThis.fetch = ((entrada: Request | URL | string, init?: RequestInit) => {
    const url = new URL(typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url)
    const metodo = init?.method ?? 'GET'
    const corpo = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : null
    chamadas.push({ url: url.pathname + url.search, metodo, corpo })
    return Promise.resolve(new Response(JSON.stringify(respostas(url, metodo, corpo)), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  }) as typeof fetch
}
const restaurar = () => { globalThis.fetch = original }

const ID = '11111111-2222-3333-4444-555555555555'
const PEDIDO = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const post = (caminho: string, corpo: unknown, cab: Record<string, string> = {}) =>
  handler(new Request(`https://teste.supabase.co/functions/v1/whatsapp${caminho}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...cab }, body: JSON.stringify(corpo) }))
const mensagemUazapi = { event: 'messages', message: { chatid: '5511999990000@s.whatsapp.net', messageid: 'EXT1', messageType: 'Conversation', text: 'Olá' } }

Deno.test('webhook sem segredo é recusado e não toca no banco', async () => {
  falso()
  try {
    const r = await post('', mensagemUazapi)
    assert(r.status === 401); assert(chamadas.length === 0)
  } finally { restaurar() }
})

Deno.test('webhook grava a mensagem como do cliente, cria o contato e ignora repetição', async () => {
  falso()
  respostas = (u, m) => {
    if (u.pathname.endsWith('/contatos_dados') && m === 'GET') return []
    if (u.pathname.endsWith('/contatos_dados') && m === 'POST') return [{ id: ID }]
    if (u.pathname.endsWith('/mensagens_whatsapp')) return [{ id: 'msg-1' }]
    return []
  }
  try {
    const r = await post('', mensagemUazapi, { 'x-webhook-segredo': 'segredo-de-teste' })
    assert(r.status === 200)
    const msg = chamadas.find((c) => c.url.startsWith('/rest/v1/mensagens_whatsapp'))
    assert(msg, 'não gravou a mensagem')
    assert(msg.url.includes('on_conflict=provedor,id_externo'), 'sem alvo de conflito')
    const c = msg.corpo as Record<string, unknown>
    assert(c.autor === 'cliente' && c.contato_id === ID && c.id_externo === 'EXT1' && c.conteudo === 'Olá')
    assert(chamadas.some((x) => x.url.startsWith('/rest/v1/contatos_dados') && x.metodo === 'POST'), 'não criou o contato')

    respostas = (u, m) => u.pathname.endsWith('/mensagens_whatsapp') ? [] : (m === 'GET' ? [{ id: ID }] : [])
    const repetida = await (await post('', mensagemUazapi, { 'x-webhook-segredo': 'segredo-de-teste' })).json()
    assert(repetida.ignorado === 'duplicada')
  } finally { restaurar() }
})

Deno.test('webhook ignora grupo e mensagem própria, com motivo', async () => {
  falso()
  try {
    const h = { 'x-webhook-segredo': 'segredo-de-teste' }
    const grupo = await (await post('', { event: 'messages', message: { chatid: '1@g.us', isGroup: true, messageType: 'Conversation' } }, h)).json()
    const propria = await (await post('', { event: 'messages', message: { chatid: '5511@s.whatsapp.net', fromMe: true, messageType: 'Conversation' } }, h)).json()
    assert(grupo.ignorado === 'grupo' && propria.ignorado === 'propria'); assert(chamadas.length === 0)
  } finally { restaurar() }
})

Deno.test('rotas da equipe exigem sessão', async () => {
  falso()
  respostas = () => ({})
  try {
    for (const [metodo, caminho] of [['POST', '/enviar'], ['GET', '/conexao'], ['GET', '/foto?whatsapp=1'], ['POST', '/apagar-pessoa']] as const) {
      const r = await handler(new Request(`https://teste.supabase.co/functions/v1/whatsapp${caminho}`, { method: metodo, body: metodo === 'POST' ? '{}' : undefined }))
      assert(r.status === 401, `${caminho} deveria dar 401, deu ${r.status}`)
    }
    assert((await handler(new Request('https://teste.supabase.co/functions/v1/whatsapp/meta/webhook', { method: 'POST' }))).status === 404)
  } finally { restaurar() }
})

function comSessao(perfil: { papel: string; ativo: boolean } | null) {
  respostas = (u) => {
    if (u.pathname === '/auth/v1/user') return { id: 'user-1' }
    if (u.pathname.endsWith('/usuarios')) return perfil ? [perfil] : []
    if (u.pathname.endsWith('/contatos_dados')) return [{ id: ID, whatsapp: '5511999990000' }]
    if (u.pathname.endsWith('/mensagens_whatsapp')) return [{ id: 'msg-1' }]
    return {}
  }
}
const auth = { Authorization: 'Bearer token' }

Deno.test('usuário desligado não envia', async () => {
  falso(); comSessao({ papel: 'consultor', ativo: false })
  try { assert((await post('/enviar', { contato_id: ID, texto: 'oi', pedido_id: PEDIDO }, auth)).status === 401) } finally { restaurar() }
})

Deno.test('envio valida dados, reserva por pedido_id e não envia duas vezes', async () => {
  falso(); comSessao({ papel: 'consultor', ativo: true })
  try {
    assert((await post('/enviar', { contato_id: ID, texto: '  ', pedido_id: PEDIDO }, auth)).status === 400)
    assert((await post('/enviar', { contato_id: 'x', texto: 'oi', pedido_id: PEDIDO }, auth)).status === 400)
    assert((await post('/enviar', { contato_id: ID, texto: 'oi' }, auth)).status === 400, 'sem pedido_id deve recusar')

    chamadas.length = 0
    const ok = await post('/enviar', { contato_id: ID, texto: 'oi', pedido_id: PEDIDO }, auth)
    assert(ok.status === 200)
    const reserva = chamadas.find((c) => c.metodo === 'POST' && c.url.startsWith('/rest/v1/mensagens_whatsapp'))
    assert(reserva && reserva.url.includes('on_conflict=pedido_id'))
    const c = reserva.corpo as Record<string, unknown>
    assert(c.autor === 'atendente' && c.estado_envio === 'pendente' && c.enviada_por === 'user-1')
    assert(chamadas.some((x) => x.url.includes('/send/text')), 'não chamou a uazapi')

    // Repetido: a reserva volta vazia → nada é enviado.
    chamadas.length = 0
    respostas = (u) => u.pathname === '/auth/v1/user' ? { id: 'user-1' } : u.pathname.endsWith('/usuarios') ? [{ papel: 'consultor', ativo: true }]
      : u.pathname.endsWith('/contatos_dados') ? [{ whatsapp: '5511999990000' }] : []
    const dup = await (await post('/enviar', { contato_id: ID, texto: 'oi', pedido_id: PEDIDO }, auth)).json()
    assert(dup.repetido === true); assert(!chamadas.some((x) => x.url.includes('/send/text')), 'reenviou')
  } finally { restaurar() }
})

Deno.test('apagar pessoa é só do gestor', async () => {
  falso(); comSessao({ papel: 'consultor', ativo: true })
  try {
    const r = await post('/apagar-pessoa', { contato_id: ID }, auth)
    assert(r.status === 403); assert(!chamadas.some((c) => c.metodo === 'DELETE'))
  } finally { restaurar() }
})

Deno.test('vigia: sem o segredo certo é recusado e não toca no banco', async () => {
  falso()
  try {
    for (const cab of [{} as Record<string, string>, { authorization: 'Bearer errado' }, { authorization: 'Bearer curto' }]) {
      const r = await post('/vigiar', {}, cab)
      assert(r.status === 401)
    }
    assert(chamadas.length === 0)
  } finally { restaurar() }
})

Deno.test('vigia: mensagem pendente antiga vira incerta e abre o aviso; o corte é de 5 min', async () => {
  falso()
  respostas = (u, m) => {
    if (u.pathname.endsWith('/mensagens_whatsapp') && m === 'GET') return [{ id: 'm1', contato_id: ID }]
    if (u.pathname.endsWith('/conversas_config')) return [{ provedor: 'meta' }] // sem uazapi: a conexão não é vigiada
    if (u.pathname.endsWith('/assistente_config')) return []
    if (u.pathname.endsWith('/rpc/aviso_abrir')) return 'aviso-1'
    return []
  }
  try {
    const r = await post('/vigiar', {}, { authorization: 'Bearer segredo-do-vigia-com-mais-de-24-letras' })
    const corpo = await r.json()
    assert(r.status === 200 && corpo.ok === true && corpo.mensagensPresas === 1 && corpo.conexao === 'nao_vigiada', JSON.stringify(corpo))
    const busca = chamadas.find((c) => c.url.startsWith('/rest/v1/mensagens_whatsapp') && c.metodo === 'GET')!
    assert(busca.url.includes('estado_envio=eq.pendente') && busca.url.includes('autor=in.(agente,atendente)') && busca.url.includes('criada_em=lt.'))
    const marca = chamadas.find((c) => c.metodo === 'PATCH')!
    assert(marca.url.includes('id=in.(m1)') && marca.url.includes('estado_envio=eq.pendente'), 'só marca as que ainda estão pendentes')
    assert((marca.corpo as Record<string, unknown>).estado_envio === 'incerto')
    const aviso = chamadas.find((c) => c.url.endsWith('/rpc/aviso_abrir'))!
    assert((aviso.corpo as Record<string, unknown>).p_tipo === 'mensagem_presa' && (aviso.corpo as Record<string, unknown>).p_contato_id === ID)
  } finally { restaurar() }
})

Deno.test('envio: conversa assumida por outra pessoa é recusada; a própria e a livre passam', async () => {
  falso(); comSessao({ papel: 'consultor', ativo: true })
  try {
    const com = (assumido_por: string | null) => {
      respostas = (u) => u.pathname === '/auth/v1/user' ? { id: 'user-1' } : u.pathname.endsWith('/usuarios') ? [{ papel: 'consultor', ativo: true }]
        : u.pathname.endsWith('/contatos_dados') ? [{ whatsapp: '5511999990000', assumido_por }] : u.pathname.endsWith('/mensagens_whatsapp') ? [{ id: 'm1' }] : []
    }
    com('outro-usuario'); chamadas.length = 0
    const negado = await post('/enviar', { contato_id: ID, texto: 'oi', pedido_id: PEDIDO }, auth)
    assert(negado.status === 409 && (await negado.json()).motivo === 'conversa_com_outra_pessoa')
    assert(!chamadas.some((c) => c.metodo === 'POST'), 'gravou ou enviou apesar do dono ser outro')
    com('user-1'); assert((await post('/enviar', { contato_id: ID, texto: 'oi', pedido_id: PEDIDO }, auth)).status === 200, 'o dono não conseguiu enviar')
    com(null); assert((await post('/enviar', { contato_id: ID, texto: 'oi', pedido_id: PEDIDO }, auth)).status === 200, 'conversa livre deveria enviar')
  } finally { restaurar() }
})

Deno.test('rascunho: exige sessão e contato válido; sem a IA configurada devolve o motivo e nunca envia nada', async () => {
  falso(); comSessao(null)
  try {
    assert((await post('/rascunho', { contato_id: ID })).status === 401)
    comSessao({ papel: 'consultor', ativo: true }); chamadas.length = 0
    assert((await post('/rascunho', { contato_id: 'x' }, auth)).status === 400)
    // O gancho é o da instalação: vazio (sem assistente → "indisponivel", 404) ou o do assistente (sem configuração no banco falso → 400).
    const { rascunhoDaIA } = await import('../_shared/gancho.ts')
    const esperado = await rascunhoDaIA(ID)
    assert(!esperado.ok)
    const r = await post('/rascunho', { contato_id: ID }, auth)
    assert(r.status === (esperado.motivo === 'indisponivel' ? 404 : 400) && (await r.json()).motivo === esperado.motivo)
    assert(!chamadas.some((c) => c.url.includes('/send/') || (c.metodo === 'POST' && c.url.startsWith('/rest/v1/mensagens_whatsapp'))), 'o rascunho enviou ou gravou mensagem')
  } finally { restaurar() }
})

// ---------- anexos ----------

const JPG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
function formAnexo(o: { arquivo?: File | null; contato?: string; pedido?: string; legenda?: string } = {}) {
  const f = new FormData()
  f.set('contato_id', o.contato ?? ID); f.set('pedido_id', o.pedido ?? PEDIDO); if (o.legenda !== undefined) f.set('legenda', o.legenda)
  if (o.arquivo !== null) f.set('arquivo', o.arquivo ?? new File([JPG_BYTES], 'foto.jpg', { type: 'image/jpeg' }))
  return f
}
const enviarAnexo = (f: FormData, cab: Record<string, string> = auth) =>
  handler(new Request('https://teste.supabase.co/functions/v1/whatsapp/enviar-midia', { method: 'POST', headers: cab, body: f }))
function respostasDeAnexo(assumido_por: string | null = null, uazapiOk = true) {
  respostas = (u, m) => {
    if (u.pathname === '/auth/v1/user') return { id: 'user-1' }
    if (u.pathname.endsWith('/usuarios')) return [{ papel: 'consultor', ativo: true }]
    if (u.pathname.endsWith('/contatos_dados')) return [{ whatsapp: '5511999990000', assumido_por }]
    if (u.pathname.endsWith('/mensagens_whatsapp')) return m === 'POST' ? [{ id: 'msg-9' }] : []
    if (u.pathname.includes('/storage/v1/object/sign/')) return { signedURL: '/object/sign/midias-whatsapp/x?token=abc' }
    if (u.pathname.endsWith('/send/media')) return uazapiOk ? { messageid: 'EXT9' } : null
    return {}
  }
}

Deno.test('anexo: exige sessão e dados válidos, e recusa arquivo que não é o que diz ser, sem gravar nada', async () => {
  falso(); comSessao(null)
  try {
    assert((await enviarAnexo(formAnexo(), {})).status === 401)
    respostasDeAnexo(); chamadas.length = 0
    assert((await enviarAnexo(formAnexo({ contato: 'x' }))).status === 400)
    assert((await enviarAnexo(formAnexo({ pedido: 'x' }))).status === 400)
    assert((await enviarAnexo(formAnexo({ arquivo: null }))).status === 400)
    const falso1 = await enviarAnexo(formAnexo({ arquivo: new File([new Uint8Array([0x4d, 0x5a, 0x90, 0])], 'fatura.pdf', { type: 'application/pdf' }) }))
    assert(falso1.status === 400 && (await falso1.json()).motivo === 'anexo_recusado')
    const html = await enviarAnexo(formAnexo({ arquivo: new File(['<script>x</script>'], 'a.html', { type: 'text/html' }) }))
    assert(html.status === 400)
    assert(!chamadas.some((c) => c.metodo === 'POST' && (c.url.includes('/mensagens_whatsapp') || c.url.includes('/storage/') || c.url.includes('/send/'))), 'gravou, subiu ou enviou arquivo recusado')
  } finally { restaurar() }
})

Deno.test('anexo: reserva a linha, sobe sob a pasta do contato, entrega URL assinada à uazapi e marca enviado', async () => {
  falso(); comSessao({ papel: 'consultor', ativo: true })
  try {
    respostasDeAnexo(); chamadas.length = 0
    const r = await enviarAnexo(formAnexo({ legenda: 'Segue a foto.' }))
    assert(r.status === 200 && (await r.json()).ok === true)
    const reserva = chamadas.find((c) => c.metodo === 'POST' && c.url.startsWith('/rest/v1/mensagens_whatsapp'))!
    const c = reserva.corpo as Record<string, unknown>
    assert(reserva.url.includes('on_conflict=pedido_id') && c.autor === 'atendente' && c.tipo === 'imagem' && c.conteudo === 'Segue a foto.' && c.estado_envio === 'pendente' && c.enviada_por === 'user-1')
    const upload = chamadas.find((x) => x.metodo === 'POST' && x.url.includes('/storage/v1/object/midias-whatsapp/'))!
    assert(upload.url.includes(`/${ID}/saida-msg-9.jpg`), 'o arquivo deve ficar sob a pasta do contato')
    const envio = chamadas.find((x) => x.url.includes('/send/media'))!
    const e = envio.corpo as Record<string, unknown>
    assert(e.number === '5511999990000' && e.type === 'image' && e.text === 'Segue a foto.' && String(e.file).includes('/storage/v1/object/sign/midias-whatsapp/') && String(e.file).includes('token=abc'), JSON.stringify(e))
    const ordem = chamadas.map((x) => (x.url.includes('/storage/v1/object/midias') ? 'upload' : x.url.includes('/object/sign/') ? 'sign' : x.url.includes('/send/media') ? 'envio' : x.metodo === 'PATCH' ? 'patch' : x.metodo === 'POST' && x.url.includes('mensagens') ? 'reserva' : '')).filter(Boolean)
    assert(ordem.join() === 'reserva,upload,patch,sign,envio,patch', ordem.join())
    const final = chamadas.filter((x) => x.metodo === 'PATCH').pop()!.corpo as Record<string, unknown>
    assert(final.estado_envio === 'enviado' && final.id_externo === 'EXT9')
  } finally { restaurar() }
})

Deno.test('anexo: documento leva o nome do arquivo; pedido repetido não envia de novo', async () => {
  falso(); comSessao({ papel: 'consultor', ativo: true })
  try {
    respostasDeAnexo(); chamadas.length = 0
    const pdf = new File(['%PDF-1.4 conteudo'], 'C:\\pasta\\Proposta final.pdf', { type: 'application/pdf' })
    await enviarAnexo(formAnexo({ arquivo: pdf }))
    const e = chamadas.find((x) => x.url.includes('/send/media'))!.corpo as Record<string, unknown>
    assert(e.type === 'document' && e.docName === 'Proposta final.pdf' && !('text' in e), JSON.stringify(e))
    respostas = (u) => u.pathname === '/auth/v1/user' ? { id: 'user-1' } : u.pathname.endsWith('/usuarios') ? [{ papel: 'consultor', ativo: true }]
      : u.pathname.endsWith('/contatos_dados') ? [{ whatsapp: '5511999990000', assumido_por: null }] : []
    chamadas.length = 0
    const dup = await (await enviarAnexo(formAnexo({ arquivo: new File(['%PDF-1.4 x'], 'a.pdf', { type: 'application/pdf' }) }))).json()
    assert(dup.repetido === true && !chamadas.some((x) => x.url.includes('/send/') || x.url.includes('/storage/')), 'reenviou o anexo')
  } finally { restaurar() }
})

Deno.test('anexo: conversa de outra pessoa é recusada; falha da uazapi deixa a mensagem como falhou', async () => {
  falso(); comSessao({ papel: 'consultor', ativo: true })
  try {
    respostasDeAnexo('outro-usuario'); chamadas.length = 0
    const negado = await enviarAnexo(formAnexo())
    assert(negado.status === 409 && !chamadas.some((c) => c.metodo === 'POST' && (c.url.includes('/mensagens_whatsapp') || c.url.includes('/storage/'))))
    respostasDeAnexo(null, false); chamadas.length = 0
    const r = await enviarAnexo(formAnexo())
    assert(r.status === 502 && (await r.json()).motivo === 'falha_no_envio')
    const final = chamadas.filter((x) => x.metodo === 'PATCH').pop()!.corpo as Record<string, unknown>
    assert(final.estado_envio === 'falhou' && String(final.erro_envio).includes('anexo'))
    assert(chamadas.filter((x) => x.url.includes('/send/media')).length === 1, 'tentou mais de uma vez')
  } finally { restaurar() }
})

Deno.test('parada pela uazapi bloqueia automações mesmo sem IA e em webhook duplicado', async () => {
 falso()
 respostas = (u) => {
  if(u.pathname.endsWith('/contatos_dados')) return [{id:ID}]
  if(u.pathname.endsWith('/mensagens_whatsapp')) return []
  return null
 }
 try {
  const r=await post('', {...mensagemUazapi,message:{...mensagemUazapi.message,text:'SAIR'}}, {'x-webhook-segredo':'segredo-de-teste'})
  assert(r.status===200)
  const b=chamadas.find(c=>c.url.endsWith('/rpc/automacao_bloquear'))
  assert(b && (b.corpo as Record<string,unknown>).p_marketing===true,'não bloqueou no servidor antes de ignorar duplicada')
 } finally {restaurar()}
})
