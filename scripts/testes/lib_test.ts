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

// ---------- etiquetas ----------
import { acharPorNome, contatosComEtiquetas, nomeValido, normalizarNome, sugerir, type Etiqueta } from '../../src/lib/etiquetasRegras.ts'
const E = (id: string, nome: string): Etiqueta => ({ id, nome, cor: 'accent' })
Deno.test('etiquetas: nome normalizado, achado sem caixa nem espaço repetido, e validado como no banco', () => {
  eq(normalizarNome('  Quente   demais '), 'Quente demais')
  eq(acharPorNome([E('1', 'Quente demais')], ' quente  DEMAIS ')?.id, '1')
  eq(acharPorNome([E('1', 'Quente')], '   '), undefined); eq(acharPorNome([E('1', 'Quente')], 'frio'), undefined)
  eq(nomeValido('  '), false); eq(nomeValido('a'), true); eq(nomeValido('x'.repeat(30)), true); eq(nomeValido('x'.repeat(31)), false)
  eq(nomeValido(' ' + 'x'.repeat(30) + ' '), true, 'o limite vale depois de normalizar')
})
Deno.test('etiquetas: sugestões escondem as que o contato já tem e põem "começa com" primeiro', () => {
  const todas = [E('1', 'Indicação'), E('2', 'Quente'), E('3', 'Sem quente'), E('4', 'Frio')]
  eq(sugerir(todas, 'quen', new Set()).map((e) => e.id), ['2', '3'])
  eq(sugerir(todas, 'quen', new Set(['2'])).map((e) => e.id), ['3'])
  eq(sugerir(todas, '', new Set(['1'])).map((e) => e.id), ['4', '2', '3'])
})
Deno.test('etiquetas: filtrar exige todas as escolhidas', () => {
  const m = new Map([['a', new Set(['x', 'y'])], ['b', new Set(['x'])], ['c', new Set<string>()]])
  eq([...contatosComEtiquetas(m, ['x'], ['a', 'b', 'c'])], ['a', 'b'])
  eq([...contatosComEtiquetas(m, ['x', 'y'], ['a', 'b', 'c'])], ['a'])
  eq([...contatosComEtiquetas(m, [], ['a', 'b', 'c'])], ['a', 'b', 'c'])
})

// ---------- importar planilha ----------
import { detectarColunas, lerCSV, normalizarNumero, prepararLinhas } from '../../src/lib/importacao.ts'
Deno.test('importação: lê CSV com ; ou ,, aspas, BOM, CRLF e linhas vazias', () => {
  eq(lerCSV('﻿Nome;Telefone\r\n"Silva; João";(11) 98765-4321\r\n\r\nAna;11987654322'), [['Nome', 'Telefone'], ['Silva; João', '(11) 98765-4321'], ['Ana', '11987654322']])
  eq(lerCSV('nome,email\n"Ele disse ""oi""",a@b.co'), [['nome', 'email'], ['Ele disse "oi"', 'a@b.co']])
  eq(lerCSV('a,b\n1,2'), [['a', 'b'], ['1', '2']])
  eq(lerCSV(''), [])
})
Deno.test('importação: reconhece colunas pelo título, sem acento nem caixa, sem repetir coluna', () => {
  eq(detectarColunas(['Nome Completo', 'E-mail', 'Celular', 'Empresa']), { nome: 0, whatsapp: 2, empresa: 3, email: 1 })
  eq(detectarColunas(['Cliente', 'Telefone', 'Razão Social']), { nome: 0, whatsapp: 1, empresa: 2, email: null })
  eq(detectarColunas(['x', 'y']), { nome: null, whatsapp: null, empresa: null, email: null })
})
Deno.test('importação: normaliza telefone brasileiro e recusa o que não dá para usar', () => {
  eq(normalizarNumero('(11) 98765-4321'), { ok: true, numero: '5511987654321' })
  eq(normalizarNumero('+55 11 98765-4321'), { ok: true, numero: '5511987654321' })
  eq(normalizarNumero('011 3333-4444'), { ok: true, numero: '551133334444' })
  eq(normalizarNumero('98765-4321'), { ok: false, motivo: 'telefone sem DDD' })
  eq(normalizarNumero('123'), { ok: false, motivo: 'telefone sem DDD' })
  eq(normalizarNumero(''), { ok: false, motivo: 'sem telefone' })
  eq(normalizarNumero('1234567890123456789'), { ok: false, motivo: 'telefone com tamanho inválido' })
})
Deno.test('importação: monta as linhas, explica as recusadas e junta os repetidos', () => {
  const mapa = { nome: 0, whatsapp: 1, empresa: null, email: 2 } as const
  const r = prepararLinhas([
    ['Ana', '(11) 98765-4321', 'ANA@EXEMPLO.COM'],
    ['Ana de novo', '11987654321', ''],
    ['Bia', '98765', ''],
    ['', '21 99999-0000', ''],
    ['Caio', '11 97777-0000', 'sem-arroba'],
  ], mapa)
  eq(r.prontas, [{ nome: 'Ana', whatsapp: '5511987654321', empresa: null, email: 'ana@exemplo.com' }, { nome: null, whatsapp: '5521999990000', empresa: null, email: null }])
  eq(r.problemas, [{ linha: 4, motivo: 'telefone sem DDD' }, { linha: 6, motivo: 'e-mail inválido' }])
  eq(r.repetidasNoArquivo, 1)
  eq(prepararLinhas([['x']], { nome: 0, whatsapp: null, empresa: null, email: null }).prontas, [], 'sem coluna de telefone não importa nada')
})
Deno.test('importação: o limite de 500 linhas é avisado, não ignorado em silêncio', () => {
  const muitas = Array.from({ length: 503 }, (_, i) => ['N' + i, String(11900000000 + i)])
  const r = prepararLinhas(muitas, { nome: 0, whatsapp: 1, empresa: null, email: null })
  eq(r.prontas.length, 500); eq(r.excedeLimite, true)
})

// ---------- anexos ----------
import { problemaDoAnexo, tamanhoLegivel } from '../../src/lib/anexos.ts'
Deno.test('anexos: a tela recusa cedo o que a função recusaria (tipo, vazio, 5 MB de imagem, 16 MB)', () => {
  eq(problemaDoAnexo('foto.JPG', 1000), null); eq(problemaDoAnexo('p.pdf', 15 * 1024 * 1024), null)
  assert(problemaDoAnexo('a.exe', 10)?.includes('não é aceito')); assert(problemaDoAnexo('semextensao', 10)?.includes('não é aceito'))
  assert(problemaDoAnexo('a.pdf', 0)?.includes('vazio'))
  assert(problemaDoAnexo('a.png', 5 * 1024 * 1024 + 1)?.includes('5 MB')); eq(problemaDoAnexo('a.png', 5 * 1024 * 1024), null)
  assert(problemaDoAnexo('a.mp4', 16 * 1024 * 1024 + 1)?.includes('16 MB'))
})
Deno.test('anexos: tamanho legível', () => { eq(tamanhoLegivel(500), '1 KB'); eq(tamanhoLegivel(2048), '2 KB'); eq(tamanhoLegivel(1.5 * 1024 * 1024), '1,5 MB') })

// ---------- linha do tempo ----------
import { montarLinhaDoTempo } from '../../src/lib/linhaDoTempo.ts'
import { agruparRadar, filtrarRadar, rotuloParado, valorPorFaixa, type NegocioDoRadar } from '../../src/lib/radarRegras.ts'
import { agruparTarefas, contarVencidas, doCampoDeData, grupoDaTarefa, paraCampoDeData, prazosRapidos, rotuloDoPrazo, validarNovaTarefa, type Tarefa } from '../../src/lib/tarefasRegras.ts'
Deno.test('linha do tempo: junta etapas, reuniões, avisos, notas e passagens, do mais novo ao mais velho', () => {
  const r = montarLinhaDoTempo({
    contato: { id: 'c', created_at: '2026-10-01T09:00:00Z' },
    rotuloEtapa: (k) => ({ novo_lead: 'Novo lead', proposta: 'Proposta' } as Record<string, string>)[k] ?? k,
    eventos: [
      { id: 'e1', status_anterior: null, status_novo: 'novo_lead', motivo: null, created_at: '2026-10-01T09:05:00Z', oportunidade_nome: 'Site' },
      { id: 'e2', status_anterior: 'novo_lead', status_novo: 'proposta', motivo: ' Pediu orçamento ', created_at: '2026-10-02T10:00:00Z', oportunidade_nome: 'Site' },
    ],
    reunioes: [{ id: 'r1', assunto: 'Diagnóstico', data_reuniao: '2026-10-05T14:00:00Z', status: 'cancelada', created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-03T08:00:00Z', cancelado_em: '2026-10-03T09:00:00Z', motivo_cancelamento: 'Remarcou' }],
    avisos: [{ id: 'a1', titulo: 'Pediu para parar', detalhe: null, criado_em: '2026-10-03T10:00:00Z', resolvido_em: '2026-10-03T11:00:00Z', resolucao: 'manual' }],
    notas: [{ id: 'n1', texto: '  Prefere\n  terças  ', created_at: '2026-10-02T12:00:00Z', autor_nome: 'Ana' }, { id: 'n2', texto: 'x'.repeat(300), created_at: '2026-10-02T13:00:00Z', autor_nome: null }],
    conversaEventos: [
      { id: 'v1', tipo: 'assumiu', created_at: '2026-10-02T11:00:00Z', por_nome: 'Ana', para_nome: 'Ana' },
      { id: 'v2', tipo: 'transferiu', created_at: '2026-10-02T11:30:00Z', por_nome: 'Ana', para_nome: 'Beto' },
      { id: 'v3', tipo: 'devolveu', created_at: '2026-10-02T11:40:00Z', por_nome: null, para_nome: null },
    ],
    tarefas: [{ id: 't1', titulo: 'Ligar para confirmar', concluida_em: '2026-10-03T15:00:00Z', concluida_por_nome: 'Ana' }, { id: 't2', titulo: 'Ainda aberta', concluida_em: null, concluida_por_nome: null }, { id: 't3', titulo: 'Sem autor', concluida_em: '2026-10-01T10:00:00Z', concluida_por_nome: null }],
    ultimaMensagem: 'data inválida',
  })
  eq(r.map((x) => x.titulo), [
    'Tarefa concluída: Ligar para confirmar', 'Aviso dispensado: Pediu para parar', 'Aviso: Pediu para parar', 'Reunião cancelada: Diagnóstico',
    'Nota interna', 'Nota interna de Ana', 'Alguém da equipe devolveu a conversa', 'Ana passou a conversa para Beto', 'Ana assumiu a conversa',
    'Site: Novo lead → Proposta', 'Reunião marcada: Diagnóstico', 'Tarefa concluída: Sem autor', 'Site: aberta em Novo lead', 'Contato criado',
  ])
  eq(r.find((x) => x.id === 'tarefa-t1')?.detalhe, 'Por Ana'); eq(r.find((x) => x.id === 'tarefa-t3')?.detalhe, undefined); assert(!r.some((x) => x.id === 'tarefa-t2'), 'tarefa aberta não é história')
  eq(r.find((x) => x.id === 'op-e2')?.detalhe, 'Pediu orçamento'); eq(r.find((x) => x.id === 'nota-n1')?.detalhe, 'Prefere terças')
  eq(r.find((x) => x.id === 'nota-n2')?.detalhe?.length, 160, 'nota longa é cortada')
  eq(r.find((x) => x.id === 'reuniao-r1-fim')?.detalhe, 'Remarcou'); assert(!r.some((x) => x.tipo === 'mensagem'), 'data inválida não entra')
})


// ── Tarefas (0020). Datas montadas no fuso do próprio teste, para valer em qualquer máquina. ──
const T = (id: string, vence: Date, o: Partial<Tarefa> = {}): Tarefa => ({ id, titulo: id, detalhe: null, vence_em: vence.toISOString(), contato_id: null, oportunidade_id: null, responsavel_id: null, origem: 'manual', criada_por: null, concluida_em: null, concluida_por: null, created_at: '2026-10-01T00:00:00Z', ...o })
const AGORA = new Date(2026, 9, 7, 14, 30)            // quarta-feira, 07/10/2026, 14h30
const em = (dias: number, h = 9, m = 0) => new Date(2026, 9, 7 + dias, h, m)

Deno.test('tarefas: vencida é prazo no passado (mesmo de hoje); hoje é o que ainda vence hoje; o resto é próximas', () => {
  eq(grupoDaTarefa(em(0, 14, 29).toISOString(), AGORA), 'vencidas')
  eq(grupoDaTarefa(em(0, 14, 30).toISOString(), AGORA), 'hoje')
  eq(grupoDaTarefa(em(0, 23, 59).toISOString(), AGORA), 'hoje')
  eq(grupoDaTarefa(em(1, 0, 0).toISOString(), AGORA), 'proximas')
  eq(grupoDaTarefa(em(-1, 23, 0).toISOString(), AGORA), 'vencidas')
})

Deno.test('tarefas: agrupa só as abertas, a mais urgente primeiro, e ignora data inválida', () => {
  const g = agruparTarefas([
    T('a-amanha', em(1)), T('b-vencida-recente', em(0, 8)), T('c-hoje', em(0, 18)), T('d-vencida-antiga', em(-5)),
    T('e-feita', em(-2), { concluida_em: '2026-10-06T10:00:00Z' }), { ...T('f-quebrada', em(0)), vence_em: 'não é data' }, T('g-semana', em(6)),
  ], AGORA)
  eq(g.vencidas.map((t) => t.id), ['d-vencida-antiga', 'b-vencida-recente'])
  eq(g.hoje.map((t) => t.id), ['c-hoje'])
  eq(g.proximas.map((t) => t.id), ['a-amanha', 'g-semana'])
})

Deno.test('tarefas: o rótulo do prazo diz quando venceu ou vence, em português', () => {
  eq(rotuloDoPrazo(em(0, 9).toISOString(), AGORA), 'venceu hoje às 09:00')
  eq(rotuloDoPrazo(em(-1, 18).toISOString(), AGORA), 'venceu ontem')
  eq(rotuloDoPrazo(em(-3, 9).toISOString(), AGORA), 'venceu há 3 dias')
  eq(rotuloDoPrazo(em(0, 16).toISOString(), AGORA), 'hoje às 16:00')
  eq(rotuloDoPrazo(em(1, 9).toISOString(), AGORA), 'amanhã às 09:00')
  assert(/^sex\.?,? 09\/10 às 09:00$/.test(rotuloDoPrazo(em(2, 9).toISOString(), AGORA)), rotuloDoPrazo(em(2, 9).toISOString(), AGORA))
  eq(rotuloDoPrazo('lixo', AGORA), 'sem prazo válido')
})

Deno.test('tarefas: prazos rápidos — "hoje" some quando falta menos de 1 h para as 18h; a semana que vem é a próxima segunda', () => {
  eq(prazosRapidos(AGORA).map((p) => p.chave), ['hoje', 'amanha', 'tres-dias', 'semana'])
  eq(prazosRapidos(AGORA).map((p) => paraCampoDeData(p.data)), ['2026-10-07T18:00', '2026-10-08T09:00', '2026-10-10T09:00', '2026-10-12T09:00'])
  eq(prazosRapidos(new Date(2026, 9, 7, 17, 30)).map((p) => p.chave), ['amanha', 'tres-dias', 'semana'])
  eq(prazosRapidos(new Date(2026, 9, 7, 17, 0)).map((p) => p.chave)[0], 'hoje')
  // segunda-feira: a "semana que vem" é daqui a 7 dias; domingo: amanhã; sábado: depois de amanhã
  eq(paraCampoDeData(prazosRapidos(new Date(2026, 9, 5, 10, 0)).at(-1)!.data), '2026-10-12T09:00')
  eq(paraCampoDeData(prazosRapidos(new Date(2026, 9, 11, 10, 0)).at(-1)!.data), '2026-10-12T09:00')
  eq(paraCampoDeData(prazosRapidos(new Date(2026, 9, 10, 10, 0)).at(-1)!.data), '2026-10-12T09:00')
})

Deno.test('tarefas: campo de data vai e volta sem trocar o horário; vazio e lixo viram nulo', () => {
  eq(doCampoDeData(paraCampoDeData(em(2, 9, 5))), em(2, 9, 5).toISOString())
  eq(doCampoDeData(''), null); eq(doCampoDeData('amanhã'), null); eq(doCampoDeData('2026-13-45T25:61'), null)
})

Deno.test('tarefas: valida título e prazo antes de criar', () => {
  eq(validarNovaTarefa('   ', '2026-10-08T09:00'), 'Escreva o que precisa ser feito.')
  eq(validarNovaTarefa('x'.repeat(201), '2026-10-08T09:00'), 'O título passa de 200 caracteres.')
  eq(validarNovaTarefa('Ligar', ''), 'Escolha o prazo.')
  eq(validarNovaTarefa(' Ligar ', '2026-10-08T09:00'), null)
  eq(validarNovaTarefa('x'.repeat(200), '2026-10-08T09:00'), null)
})

Deno.test('tarefas: conta vencidas no total e por responsável (null = sem responsável)', () => {
  const lista = [T('1', em(-1), { responsavel_id: 'ana' }), T('2', em(-2), { responsavel_id: 'ana' }), T('3', em(-1)), T('4', em(1), { responsavel_id: 'ana' }), T('5', em(-4), { responsavel_id: 'ana', concluida_em: '2026-10-05T00:00:00Z' })]
  eq(contarVencidas(lista, AGORA), 3)
  eq(contarVencidas(lista, AGORA, 'ana'), 2)
  eq(contarVencidas(lista, AGORA, null), 1)
  eq(contarVencidas(lista, AGORA, 'bruno'), 0)
})


// ── Radar (0021): a classificação é do banco; aqui só rótulos e agrupamento. ──
const N = (id: string, faixa: NegocioDoRadar['faixa'], o: Partial<NegocioDoRadar> = {}): NegocioDoRadar => ({ oportunidade_id: id, contato_id: `c-${id}`, contato_nome: id, nome: 'Negócio', etapa: 'novo_lead', valor_proposta: null, responsavel_id: null, ultima_atividade: '2026-10-01T00:00:00Z', horas_parado: 60, esfria_apos_horas: 48, faixa, protegido_por: null, ...o })

Deno.test('radar: tempo parado em horas até 2 dias, depois em dias', () => {
  eq(rotuloParado(0), '0 h'); eq(rotuloParado(5.9), '5 h'); eq(rotuloParado(47), '47 h')
  eq(rotuloParado(48), '2 dias'); eq(rotuloParado(100), '4 dias'); eq(rotuloParado(-3), '0 h')
})

Deno.test('radar: agrupa por faixa mantendo a ordem do banco e ignora faixa desconhecida', () => {
  const g = agruparRadar([N('a', 'em_risco'), N('b', 'critico'), N('c', 'critico'), N('d', 'em_voo'), N('x', 'inventada' as NegocioDoRadar['faixa'])])
  eq(g.critico.map((n) => n.oportunidade_id), ['b', 'c']); eq(g.em_risco.map((n) => n.oportunidade_id), ['a']); eq(g.em_voo.map((n) => n.oportunidade_id), ['d'])
})

Deno.test('radar: filtro por pessoa — "meus" sem sessão não mostra nada', () => {
  const lista = [N('1', 'critico', { responsavel_id: 'ana' }), N('2', 'critico', { responsavel_id: 'bia' }), N('3', 'em_risco')]
  eq(filtrarRadar(lista, 'meus', 'ana').map((n) => n.oportunidade_id), ['1'])
  eq(filtrarRadar(lista, 'sem_responsavel', 'ana').map((n) => n.oportunidade_id), ['3'])
  eq(filtrarRadar(lista, 'todos', 'ana').length, 3)
  eq(filtrarRadar(lista, 'meus', null), []); eq(filtrarRadar(lista, 'meus', undefined), [])
})

Deno.test('radar: soma só propostas com valor, por faixa', () => {
  eq(valorPorFaixa([N('1', 'critico', { valor_proposta: 1000 }), N('2', 'critico', { valor_proposta: 500.5 }), N('3', 'em_risco', { valor_proposta: null }), N('4', 'em_voo', { valor_proposta: 0 }), N('5', 'em_voo', { valor_proposta: -9 })]), { critico: 1500.5, em_risco: 0, em_voo: 0 })
})
