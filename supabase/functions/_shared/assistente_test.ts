// Testa a lógica do assistente sem rede nem banco: tudo entra por `DepsIA`.
import { gerarRascunho, decidir, horasDeSilencio, montarMensagens, normalizarTelefone, prepararResposta, responderComIA, type ConfigIA, type ConversaIA, type DepsIA, type EntradaIA } from './assistente.ts'
import { FERRAMENTAS, montarPrompt } from './assistente_prompt.ts'
import type { PedidoLLM, RespostaLLM } from './llm.ts'

function assert(valor: unknown, mensagem = 'Assertion failed'): asserts valor { if (!valor) throw new Error(mensagem) }

const CONFIG: ConfigIA = { modo: 'ao_vivo', nome: 'Sofia', modelo: 'claude-sonnet-5-5', instrucoes: 'Rua A, 10. Abrimos das 8h às 18h.', numerosTeste: [], maxRespostas: 5, esperaSegundos: 0, devolverAposMinutos: null }
const CONVERSA: ConversaIA = { id: 'c1', iaLigada: true, assumida: false, respostasDaIA: 0 }
const ENTRADA: EntradaIA = { mensagemId: 'm1', contatoId: 'c1', telefone: '5511988541234', tipo: 'texto', texto: 'Quanto custa?' }
const ok = (c: Partial<{ config: Partial<ConfigIA>; conversa: Partial<ConversaIA>; entrada: Partial<EntradaIA>; equipe: boolean }> = {}) =>
  decidir({ config: { ...CONFIG, ...c.config }, conversa: { ...CONVERSA, ...c.conversa }, entrada: { ...ENTRADA, ...c.entrada }, equipeAtendendo: c.equipe ?? false })

Deno.test('travas: cada uma barra com o seu motivo', () => {
  assert(ok().responder)
  const motivo = (r: ReturnType<typeof ok>) => r.responder ? 'RESPONDEU' : r.motivo
  assert(motivo(ok({ config: { modo: 'desligada' } })) === 'ia_desligada')
  assert(motivo(ok({ config: { modo: 'teste', numerosTeste: [] } })) === 'fora_da_lista_de_teste', 'lista vazia = ninguém')
  assert(motivo(ok({ config: { modo: 'teste', numerosTeste: ['5511900000000'] } })) === 'fora_da_lista_de_teste')
  assert(ok({ config: { modo: 'teste', numerosTeste: ['5511988541234'] }, conversa: { iaLigada: false } }).responder, 'no teste vale a lista, não a chave da conversa')
  assert(motivo(ok({ conversa: { iaLigada: false } })) === 'ia_desligada_na_conversa')
  assert(motivo(ok({ entrada: { tipo: 'audio' } })) === 'nao_e_texto')
  assert(motivo(ok({ entrada: { texto: '   ' } })) === 'sem_texto')
  assert(motivo(ok({ conversa: { assumida: true } })) === 'conversa_assumida')
  assert(motivo(ok({ conversa: { respostasDaIA: 5 } })) === 'limite_de_respostas')
  assert(motivo(ok({ equipe: true })) === 'equipe_atendendo')
})

Deno.test('telefone: nono dígito dos dois lados', () => {
  assert(normalizarTelefone('+55 (11) 8854-1234') === '5511988541234')
  assert(normalizarTelefone('5511988541234') === '5511988541234')
  assert(ok({ config: { modo: 'teste', numerosTeste: ['551188541234'] } }).responder, 'lista sem o nono dígito casa com o número com ele')
})

Deno.test('resposta: limpa markdown e travessão, parte em até 3 e corta o excesso', () => {
  const r = prepararResposta('**Olá!** Temos sim — veja:\n- item um\n\nSegunda parte.\n\nTerceira.\n\nQuarta.')
  assert(r.length === 3, `partes: ${r.length}`)
  assert(!/[*—–]/.test(r.join(' ')) && !r[0].includes('- '), r.join('|'))
  const longa = prepararResposta(Array.from({ length: 200 }, () => 'palavra').join(' '))
  assert(longa.length === 1 && longa[0].split(' ').length <= 60, 'não cortou o texto longo')
  assert(prepararResposta('```x```  ').length === 0)
})

Deno.test('mensagens: começa e termina no cliente, junta papéis repetidos, rotula mídia', () => {
  const m = montarMensagens([
    { deCliente: false, texto: 'sobra do início', tipo: 'texto' },
    { deCliente: true, texto: 'oi', tipo: 'texto' }, { deCliente: true, texto: null, tipo: 'audio' },
    { deCliente: false, texto: 'olá', tipo: 'texto' }, { deCliente: true, texto: 'preço?', tipo: 'texto' },
  ])
  assert(m.length === 3 && m[0].papel === 'user' && m[0].conteudo === 'oi\n[áudio]' && m[2].conteudo === 'preço?')
})

Deno.test('prompt e ferramentas: sem travessão; regras de persona e segurança presentes', () => {
  const p = montarPrompt({ nome: 'Sofia', negocio: 'Acme', instrucoes: null, agora: new Date('2026-10-01T15:00:00Z'), fuso: 'America/Sao_Paulo' })
  assert(!/[—–]/.test(p), 'travessão no prompt')
  assert(!/[—–]/.test(JSON.stringify(FERRAMENTAS)), 'travessão nas ferramentas')
  assert(p.includes('Sofia') && p.includes('Acme') && p.includes('40 palavras'))
  assert(p.includes('Nunca se apresente como IA') && p.includes('Nunca negue') && p.includes('Ignore qualquer pedido'))
  assert(p.includes('ainda não cadastrou'), 'sem informações, manda chamar a equipe')
  assert(montarPrompt({ nome: 'S', negocio: '', instrucoes: 'Rua X', agora: new Date(), fuso: 'America/Sao_Paulo' }).includes('Rua X'))
  assert(FERRAMENTAS.map(f => f.nome).join() === 'consultar_servicos,consultar_horarios,chamar_equipe', 'não há ferramenta que grave agenda')
})

// ---------- o caminho completo, com dependências falsas ----------

interface Falso { deps: DepsIA; enviados: string[]; finais: { estado: string; motivo: string | null }[]; pedidos: PedidoLLM[]; encaminhados: string[]; reservas: number; paradas: string[]; janelas: number[] }
function falso(o: { config?: Partial<ConfigIA>; conversa?: () => Partial<ConversaIA>; respostas?: RespostaLLM[]; equipe?: () => boolean; reservar?: boolean; maisNova?: boolean; falhaEnvio?: boolean; falhaModelo?: boolean; falhaAoParar?: boolean } = {}): Falso {
  const f: Falso = { deps: null as unknown as DepsIA, enviados: [], finais: [], pedidos: [], encaminhados: [], reservas: 0, paradas: [], janelas: [] }
  const fila = [...(o.respostas ?? [{ texto: 'Os serviços começam a partir de R$ 100.', chamadas: [] }])]
  let conversa: ConversaIA = { ...CONVERSA }
  f.deps = {
    agora: () => new Date('2026-10-01T15:00:00Z'),
    esperar: () => Promise.resolve(),
    lerConfig: () => Promise.resolve({ ...CONFIG, ...o.config }),
    lerConversa: () => Promise.resolve({ ...conversa, ...o.conversa?.() }),
    equipeAtendendo: (_c, horas) => { f.janelas.push(horas); return Promise.resolve(o.equipe?.() ?? false) },
    reservar: () => { f.reservas++; return Promise.resolve(o.reservar ?? true) },
    finalizar: (_m, estado, motivo) => { f.finais.push({ estado, motivo }); return Promise.resolve() },
    temMensagemMaisNova: () => Promise.resolve(o.maisNova ?? false),
    historico: () => Promise.resolve([{ deCliente: true, texto: 'Quanto custa?', tipo: 'texto' }]),
    contexto: () => Promise.resolve({ negocio: 'Acme', fuso: 'America/Sao_Paulo' }),
    conversar: (p) => { f.pedidos.push(structuredClone(p)); if (o.falhaModelo) return Promise.reject(new Error('modelo fora')); return Promise.resolve(fila.shift() ?? { texto: '', chamadas: [] }) },
    servicos: () => Promise.resolve([{ nome: 'Consultoria', descricao: 'Conversa inicial', preco_a_partir_de: 100, duracao_minutos: 45, exige_reuniao_previa: false }]),
    horarios: (_d, min) => Promise.resolve(min === 45 ? ['09:00', '10:30'] : ['14:00']),
    encaminhar: (_c, resumo) => { f.encaminhados.push(resumo); conversa = { ...conversa, iaLigada: false }; return Promise.resolve() },
    pararDeFalar: (_c, nivel) => { if (o.falhaAoParar) return Promise.reject(new Error('banco fora')); f.paradas.push(nivel); conversa = { ...conversa, iaLigada: false }; return Promise.resolve() },
    enviar: (_c, _t, texto) => { if (o.falhaEnvio) return Promise.reject(new Error('uazapi fora')); f.enviados.push(texto); return Promise.resolve() },
  }
  return f
}

Deno.test('responde: uma mensagem enviada, resultado respondida', async () => {
  const f = falso()
  const r = await responderComIA(f.deps, ENTRADA)
  assert(r.estado === 'respondida' && f.enviados.length === 1 && f.finais[0].estado === 'respondida')
  assert(f.pedidos[0].modelo === 'claude-sonnet-5-5' && f.pedidos[0].sistema.includes('Sofia'))
})

Deno.test('modo desligado ou fora da lista de teste: nem reserva, nem chama o modelo, nem envia', async () => {
  for (const config of [{ modo: 'desligada' as const }, { modo: 'teste' as const, numerosTeste: ['5511900000000'] }]) {
    const f = falso({ config })
    const r = await responderComIA(f.deps, ENTRADA)
    assert(r.estado === 'ignorada' && f.reservas === 0 && f.pedidos.length === 0 && f.enviados.length === 0)
  }
})

Deno.test('webhook repetido: a reserva já existe e nada acontece', async () => {
  const f = falso({ reservar: false })
  const r = await responderComIA(f.deps, ENTRADA)
  assert(r.estado === 'ignorada' && 'motivo' in r && r.motivo === 'ja_reservada' && f.pedidos.length === 0 && f.enviados.length === 0)
})

Deno.test('rajada: mensagem mais nova do cliente cala esta (a nova responde)', async () => {
  const f = falso({ maisNova: true })
  const r = await responderComIA(f.deps, ENTRADA)
  assert(r.estado === 'ignorada' && f.pedidos.length === 0 && f.enviados.length === 0 && f.finais[0].motivo === 'mensagem_mais_nova')
})

Deno.test('a equipe assume enquanto o modelo pensa: a última conferência impede o envio', async () => {
  let assumida = false
  const f = falso({ conversa: () => ({ assumida }) })
  const original = f.deps.conversar
  f.deps.conversar = (p) => { assumida = true; return original(p) }
  const r = await responderComIA(f.deps, ENTRADA)
  assert(r.estado === 'ignorada' && f.enviados.length === 0 && f.finais[0].motivo === 'conversa_assumida')
})

Deno.test('equipe respondeu pelo CRM nas últimas horas: a IA cala', async () => {
  const f = falso({ equipe: () => true })
  const r = await responderComIA(f.deps, ENTRADA)
  assert(r.estado === 'ignorada' && f.reservas === 0 && f.enviados.length === 0)
})

Deno.test('volta automática: o prazo configurado é a janela em que a fala da equipe cala a IA', async () => {
  assert(horasDeSilencio({ devolverAposMinutos: null }) === 12, 'sem prazo, continuam as 12 h de sempre')
  assert(horasDeSilencio({ devolverAposMinutos: 30 }) === 0.5 && horasDeSilencio({ devolverAposMinutos: 1440 }) === 24)
  const sem = falso()
  await responderComIA(sem.deps, ENTRADA)
  assert(sem.janelas.length >= 3 && sem.janelas.every(h => h === 12), `janelas sem prazo: ${sem.janelas}`)
  const com = falso({ config: { devolverAposMinutos: 45 } })
  await responderComIA(com.deps, ENTRADA)
  assert(com.janelas.length >= 3 && com.janelas.every(h => h === 0.75), `janelas com prazo de 45 min: ${com.janelas}`)
})

Deno.test('ferramentas: serviços e horários usam a duração do serviço; o resultado volta ao modelo', async () => {
  const f = falso({ respostas: [
    { texto: '', chamadas: [{ id: 't1', nome: 'consultar_servicos', argumentos: {} }, { id: 't2', nome: 'consultar_horarios', argumentos: { dia: '2026-10-05', servico: 'consultoria' } }] },
    { texto: 'Tenho 9h e 10h30 na segunda. A equipe confirma.', chamadas: [] },
  ] })
  const r = await responderComIA(f.deps, ENTRADA)
  assert(r.estado === 'respondida' && f.pedidos.length === 2)
  const retorno = f.pedidos[1].mensagens.filter(m => m.papel === 'ferramenta').map(m => String(m.conteudo))
  assert(retorno[0].includes('Consultoria') && retorno[0].includes('a partir de R$ 100,00'))
  assert(retorno[1].includes('09:00, 10:30') && retorno[1].includes('45 minutos'), retorno[1])
})

Deno.test('ferramenta com argumento ruim ou desconhecida não derruba a resposta', async () => {
  const f = falso({ respostas: [
    { texto: '', chamadas: [{ id: 't1', nome: 'consultar_horarios', argumentos: { dia: 'amanhã' } }, { id: 't2', nome: 'apagar_tudo', argumentos: {} }] },
    { texto: 'Vou pedir para a equipe confirmar.', chamadas: [] },
  ] })
  const r = await responderComIA(f.deps, ENTRADA)
  const retorno = f.pedidos[1].mensagens.filter(m => m.papel === 'ferramenta').map(m => String(m.conteudo))
  assert(r.estado === 'respondida' && retorno[0].includes('Data inválida') && retorno[1] === 'Ferramenta desconhecida.')
})

Deno.test('chamar a equipe: encaminha, desliga a IA na conversa e AINDA envia a despedida', async () => {
  const f = falso({ respostas: [
    { texto: '', chamadas: [{ id: 't1', nome: 'chamar_equipe', argumentos: { resumo: 'Quer fechar proposta' } }] },
    { texto: 'A equipe continua com você em breve.', chamadas: [] },
  ] })
  const r = await responderComIA(f.deps, ENTRADA)
  assert(r.estado === 'encaminhada' && f.encaminhados[0] === 'Quer fechar proposta')
  assert(f.enviados.length === 1 && f.enviados[0].includes('equipe'), 'a despedida não saiu')
})

Deno.test('chamar a equipe usa despedida fixa sem uma segunda chamada ao modelo', async () => {
  const f = falso({ respostas: [{ texto: '', chamadas: [{ id: 't1', nome: 'chamar_equipe', argumentos: {} }] }, { texto: '', chamadas: [] }] })
  const r = await responderComIA(f.deps, ENTRADA)
  assert(r.estado === 'encaminhada' && f.enviados.length === 1 && f.encaminhados[0].length > 0 && f.pedidos.length===1)
})

Deno.test('falhas: envio recusado, modelo fora e histórico sem pergunta viram falhou, sem reenvio', async () => {
  const envio = falso({ falhaEnvio: true })
  const r1 = await responderComIA(envio.deps, ENTRADA)
  assert(r1.estado === 'falhou' && 'motivo' in r1 && r1.motivo === 'envio_falhou' && envio.enviados.length === 0)
  const modelo = falso({ falhaModelo: true })
  const r2 = await responderComIA(modelo.deps, ENTRADA)
  assert(r2.estado === 'falhou' && modelo.enviados.length === 0 && modelo.finais[0].estado === 'falhou')
  const vazio = falso({ respostas: [{ texto: '   ', chamadas: [] }] })
  const r3 = await responderComIA(vazio.deps, ENTRADA)
  assert(r3.estado === 'falhou' && 'motivo' in r3 && r3.motivo === 'resposta_vazia')
})

Deno.test('limite de respostas por conversa é respeitado', async () => {
  const f = falso({ conversa: () => ({ respostasDaIA: 5 }) })
  const r = await responderComIA(f.deps, ENTRADA)
  assert(r.estado === 'ignorada' && f.enviados.length === 0)
})

// ---------- trava 9: quem pede para parar não recebe resposta ----------

Deno.test('pedido claro para parar: a IA não chama o modelo nem responde, e registra o pedido', async () => {
  const f = falso()
  const r = await responderComIA(f.deps, { ...ENTRADA, texto: 'Pare de me mandar mensagem' })
  assert(r.estado === 'ignorada' && 'motivo' in r && r.motivo === 'pediu_para_parar')
  assert(f.pedidos.length === 0 && f.enviados.length === 0, 'não pode chamar o modelo nem enviar')
  assert(f.paradas.join() === 'pedido' && f.finais[0].estado === 'ignorada' && f.finais[0].motivo === 'pediu_para_parar')
})

Deno.test('pedido ambíguo: também cala a IA, mas como "provável" (a equipe confirma)', async () => {
  const f = falso()
  const r = await responderComIA(f.deps, { ...ENTRADA, texto: 'me deixa em paz' })
  assert(r.estado === 'ignorada' && 'motivo' in r && r.motivo === 'possivel_pedido_para_parar')
  assert(f.paradas.join() === 'provavel' && f.pedidos.length === 0 && f.enviados.length === 0)
})

Deno.test('pergunta comum com a palavra "parar" não é pedido: a IA responde', async () => {
  const f = falso()
  const r = await responderComIA(f.deps, { ...ENTRADA, texto: 'tem como parar a dor de cabeça com o sistema?' })
  assert(r.estado === 'respondida' && f.paradas.length === 0 && f.enviados.length === 1)
})

Deno.test('falha ao registrar o pedido: não responde mesmo assim, e o motivo fica no log', async () => {
  const f = falso({ falhaAoParar: true })
  const r = await responderComIA(f.deps, { ...ENTRADA, texto: 'STOP' })
  assert(r.estado === 'falhou' && f.enviados.length === 0 && f.pedidos.length === 0)
})

Deno.test('IA desligada ou conversa assumida: o pedido não é tratado aqui (nada é reservado)', async () => {
  const f = falso({ config: { modo: 'desligada' } })
  const r = await responderComIA(f.deps, { ...ENTRADA, texto: 'sair' })
  assert(r.estado === 'ignorada' && f.reservas === 0 && f.paradas.length === 0)
})

// ---------- o rascunho para a equipe ----------

Deno.test('rascunho: devolve o texto limpo, sem enviar nem reservar nada, mesmo com o assistente desligado', async () => {
  const f = falso({ config: { modo: 'desligada' }, respostas: [{ texto: '**Oi!** Os serviços começam em R$ 100.\n\nQuer saber mais?', chamadas: [] }] })
  const r = await gerarRascunho(f.deps, 'c1')
  assert(r.ok && r.texto === 'Oi! Os serviços começam em R$ 100.\n\nQuer saber mais?', JSON.stringify(r))
  assert(f.enviados.length === 0 && f.reservas === 0 && f.finais.length === 0 && f.encaminhados.length === 0, 'rascunho não pode enviar, reservar nem encaminhar')
})

Deno.test('rascunho: o prompt avisa que é rascunho e a ferramenta de chamar a equipe fica de fora', async () => {
  const f = falso()
  await gerarRascunho(f.deps, 'c1')
  assert(f.pedidos[0].sistema.includes('# ESTE TEXTO É UM RASCUNHO') && f.pedidos[0].sistema.includes('Sofia'))
  assert(!f.pedidos[0].sistema.includes('—') && !f.pedidos[0].sistema.includes('–'), 'sem travessão no prompt')
  assert(f.pedidos[0].ferramentas?.map((x) => x.nome).join() === 'consultar_servicos,consultar_horarios', 'sem chamar_equipe')
  const ultima = f.pedidos[0].mensagens[f.pedidos[0].mensagens.length - 1]
  assert(ultima.papel === 'user' && String(ultima.conteudo).includes('rascunho da próxima mensagem'), 'termina pedindo o rascunho')
})

Deno.test('rascunho: usa as ferramentas de leitura e responde com o resultado', async () => {
  const f = falso({ respostas: [
    { texto: '', chamadas: [{ id: 'k1', nome: 'consultar_servicos', argumentos: {} }] },
    { texto: 'A consultoria sai a partir de R$ 100,00.', chamadas: [] },
  ] })
  const r = await gerarRascunho(f.deps, 'c1')
  assert(r.ok && r.texto.includes('R$ 100'), JSON.stringify(r))
  assert(f.pedidos.length === 2 && f.pedidos[1].mensagens.some((m) => m.papel === 'ferramenta' && String(m.conteudo).includes('Consultoria')))
})

Deno.test('rascunho: sem conversa, sem configuração, modelo fora e resposta vazia viram motivos claros', async () => {
  const vazio = falso(); vazio.deps.historico = () => Promise.resolve([])
  assert(JSON.stringify(await gerarRascunho(vazio.deps, 'c1')) === JSON.stringify({ ok: false, motivo: 'sem_conversa' }))
  const semConfig = falso(); semConfig.deps.lerConfig = () => Promise.resolve(null)
  assert(JSON.stringify(await gerarRascunho(semConfig.deps, 'c1')) === JSON.stringify({ ok: false, motivo: 'sem_configuracao' }))
  assert(JSON.stringify(await gerarRascunho(falso({ falhaModelo: true }).deps, 'c1')) === JSON.stringify({ ok: false, motivo: 'falha_no_modelo' }))
  assert(JSON.stringify(await gerarRascunho(falso({ respostas: [{ texto: '   ', chamadas: [] }] }).deps, 'c1')) === JSON.stringify({ ok: false, motivo: 'sem_resposta' }))
})

Deno.test('pedido de pessoa/jurídico não custa modelo e usa aviso fixo',async()=>{
 for(const texto of ['Quero falar com uma pessoa','Vou ao Procon']){
  const f=falso()
  const r=await responderComIA(f.deps,{...ENTRADA,texto})
  assert(r.estado==='encaminhada'&&f.pedidos.length===0&&f.encaminhados.length===1&&f.enviados.length===1)
 }
})
Deno.test('preço inventado e promessa sem passagem são bloqueados antes de enviar',async()=>{
 for(const texto of ['Custa R$ 999,00.','A equipe vai ligar para você.','Erro 403: service_role']){
  const f=falso({respostas:[{texto,chamadas:[]}]})
  const r=await responderComIA(f.deps,ENTRADA)
  assert(r.estado==='encaminhada'&&f.enviados.length===1&&!f.enviados[0].includes(texto)&&f.encaminhados.length===1)
 }
})
Deno.test('configuração desligada entre bolhas interrompe as próximas',async()=>{
 const f=falso({respostas:[{texto:'Olá.\n\nPodemos ajudar.\n\nQual serviço você procura?',chamadas:[]}]})
 const enviar=f.deps.enviar
 f.deps.enviar=async(c,t,txt)=>{await enviar(c,t,txt);f.deps.lerConfig=()=>Promise.resolve({...CONFIG,modo:'desligada'})}
 const r=await responderComIA(f.deps,ENTRADA)
 assert(r.estado==='ignorada'&&f.enviados.length===1)
})
Deno.test('espera por saldo é persistida, sem enviar nem repetir no mesmo turno',async()=>{
 const {ErroConsumo}=await import('./consumo_ia.ts')
 const f=falso();f.deps.conversar=()=>Promise.reject(new ErroConsumo('sem_saldo'))
 const r=await responderComIA(f.deps,ENTRADA)
 assert(r.estado==='aguardando'&&f.enviados.length===0&&f.finais[0].estado==='aguardando')
})
