// O vigia sem banco nem rede: tudo entra por `DepsVigia`.
import { vigiar, type ConversaDevolvida, type DepsVigia, type MensagemPresa } from './vigia.ts'
import type { Rpc } from './avisos.ts'

function assert(v: unknown, m = 'Assertion failed'): asserts v { if (!v) throw new Error(m) }

interface Chamada { nome: string; args: Record<string, unknown> }
function falso(o: {
  agora?: string; presas?: MensagemPresa[]; leituras?: (string | null)[]; assistente?: { modo: string; desde: string } | null
  quebrar?: 'mensagens' | 'conexao' | 'assistente' | 'midias' | 'adiadas' | 'tarefas' | 'radar' | 'devolucao' | 'retomada'; devolvidas?: ConversaDevolvida[]; midias?: number; adiadas?: { contatoId: string; nome: string | null }[]
  radar?: { responsavelId: string | null; nome: string | null; quantidade: number }[] | null
  tarefas?: { responsavelId: string | null; nome: string | null; quantidade: number; maisAntiga: string }[] | null
} = {}) {
  const f = { chamadas: [] as Chamada[], marcadas: [] as string[], esperas: [] as number[], antesDe: null as Date | null, retomadas: [] as ConversaDevolvida[][] }
  const leituras = [...(o.leituras ?? ['conectado'])]
  const rpc = (async (nome: string, args: Record<string, unknown>) => { f.chamadas.push({ nome, args }); return nome === 'aviso_resolver_auto' ? 0 : 'id' }) as Rpc
  const deps: DepsVigia = {
    agora: () => new Date(o.agora ?? '2026-10-03T15:30:00Z'),
    esperar: (ms) => { f.esperas.push(ms); return Promise.resolve() },
    rpc,
    mensagensPendentes: (antes) => { f.antesDe = antes; if (o.quebrar === 'mensagens') return Promise.reject(new Error('banco fora')); return Promise.resolve(o.presas ?? []) },
    marcarIncertas: (ids) => { f.marcadas.push(...ids); return Promise.resolve() },
    estadoDaConexao: () => { if (o.quebrar === 'conexao') return Promise.reject(new Error('uazapi fora')); return Promise.resolve(leituras.length > 1 ? leituras.shift()! : leituras[0]) },
    reabrirAdiadas: () => { if (o.quebrar === 'adiadas') return Promise.reject(new Error('banco fora')); return Promise.resolve(o.adiadas ?? []) },
    tarefasVencidas: () => { if (o.quebrar === 'tarefas') return Promise.reject(new Error('banco fora')); return Promise.resolve(o.tarefas === null ? null : (o.tarefas ?? []).map((t) => ({ ...t, maisAntiga: new Date(t.maisAntiga) }))) },
    negociosCriticos: () => { if (o.quebrar === 'radar') return Promise.reject(new Error('banco fora')); return Promise.resolve(o.radar === undefined ? [] : o.radar) },
    devolverAoAssistente: () => { if (o.quebrar === 'devolucao') return Promise.reject(new Error('banco fora')); return Promise.resolve(o.devolvidas ?? []) },
    retomarConversas: (c) => { f.retomadas.push(c); if (o.quebrar === 'retomada') return Promise.reject(new Error('modelo fora')); return Promise.resolve() },
    removerMidiasVencidas: () => { if (o.quebrar === 'midias') return Promise.reject(new Error('storage fora')); return Promise.resolve(o.midias ?? 0) },
    assistente: () => { if (o.quebrar === 'assistente') return Promise.reject(new Error('banco fora')); return Promise.resolve(o.assistente ? { modo: o.assistente.modo, desde: new Date(o.assistente.desde) } : null) },
  }
  const abertos = () => f.chamadas.filter((c) => c.nome === 'aviso_abrir').map((c) => c.args)
  const exceto = (tipo = 'tarefas_vencidas') => f.chamadas.filter((c) => c.nome === 'aviso_resolver_exceto' && c.args.p_tipo === tipo).map((c) => c.args)
  const fechados = () => f.chamadas.filter((c) => c.nome === 'aviso_resolver_auto').map((c) => c.args.p_tipo)
  return { f, deps, abertos, fechados, exceto }
}
const semFaxina = () => Promise.resolve(0)

Deno.test('mensagem presa há mais de 5 min: vira incerta e abre um aviso por contato', async () => {
  const t = falso({ presas: [{ id: 'm1', contatoId: 'c1' }, { id: 'm2', contatoId: 'c1' }, { id: 'm3', contatoId: 'c2' }] })
  const r = await vigiar(t.deps, semFaxina)
  assert(r.mensagensPresas === 3 && t.f.marcadas.join() === 'm1,m2,m3')
  assert(t.f.antesDe!.toISOString() === '2026-10-03T15:25:00.000Z', 'o corte é agora - 5 min')
  const a = t.abertos()
  assert(a.length === 2 && a[0].p_chave === 'c1' && a[0].p_contato_id === 'c1' && String(a[0].p_titulo).startsWith('2 mensagens') && String(a[1].p_titulo).startsWith('Uma mensagem'))
  assert(a.every((x) => x.p_tipo === 'mensagem_presa' && x.p_rota === '/conversas'))
})

Deno.test('sem mensagem presa: nada marcado, nenhum aviso', async () => {
  const t = falso()
  const r = await vigiar(t.deps, semFaxina)
  assert(r.mensagensPresas === 0 && t.f.marcadas.length === 0 && t.abertos().length === 0)
})

Deno.test('conexão ok: fecha o aviso de queda', async () => {
  const t = falso({ leituras: ['conectado'] })
  const r = await vigiar(t.deps, semFaxina)
  assert(r.conexao === 'ok' && t.fechados().includes('conexao_caida') && t.f.esperas.length === 0)
})

Deno.test('conexão caída nas duas leituras: abre aviso crítico', async () => {
  const t = falso({ leituras: ['desconectado', 'desconectado'] })
  const r = await vigiar(t.deps, semFaxina)
  assert(r.conexao === 'caida' && t.f.esperas.length === 1)
  const a = t.abertos().find((x) => x.p_tipo === 'conexao_caida')!
  assert(a.p_gravidade === 'critico' && a.p_somente_gestor === false)
})

Deno.test('piscou (caiu e voltou entre as duas leituras): não acusa', async () => {
  const t = falso({ leituras: ['indisponivel', 'conectado'] })
  const r = await vigiar(t.deps, semFaxina)
  assert(r.conexao === 'oscilou' && !t.abertos().some((x) => x.p_tipo === 'conexao_caida'))
})

Deno.test('conectando e não configurado não são queda', async () => {
  for (const estado of ['conectando', 'nao_configurado']) {
    const t = falso({ leituras: [estado] })
    const r = await vigiar(t.deps, semFaxina)
    assert(r.conexao === 'oscilou' && t.abertos().length === 0 && t.f.esperas.length === 0, estado)
  }
})

Deno.test('instalação sem uazapi: a conexão não é vigiada e nada é fechado por engano', async () => {
  const t = falso({ leituras: [null] })
  const r = await vigiar(t.deps, semFaxina)
  assert(r.conexao === 'nao_vigiada' && t.fechados().every((x) => x !== 'conexao_caida'))
})

Deno.test('assistente em teste há 3+ dias: aviso só do gestor; há menos, nada', async () => {
  const velho = falso({ assistente: { modo: 'teste', desde: '2026-09-29T10:00:00Z' } })
  const r1 = await vigiar(velho.deps, semFaxina)
  const a = velho.abertos().find((x) => x.p_tipo === 'assistente_em_teste')!
  assert(r1.assistenteEmTeste && a.p_somente_gestor === true && a.p_rota === '/assistente-ia' && String(a.p_detalhe).includes('4 dias'))
  const novo = falso({ assistente: { modo: 'teste', desde: '2026-10-02T10:00:00Z' } })
  const r2 = await vigiar(novo.deps, semFaxina)
  assert(r2.assistenteEmTeste && !novo.abertos().some((x) => x.p_tipo === 'assistente_em_teste'))
})

Deno.test('assistente fora do teste: fecha o aviso; sem o módulo: não mexe em nada', async () => {
  const aoVivo = falso({ assistente: { modo: 'ao_vivo', desde: '2026-09-01T00:00:00Z' } })
  const r = await vigiar(aoVivo.deps, semFaxina)
  assert(!r.assistenteEmTeste && aoVivo.fechados().includes('assistente_em_teste'))
  const semModulo = falso({ assistente: null })
  await vigiar(semModulo.deps, semFaxina)
  assert(!semModulo.fechados().includes('assistente_em_teste'))
})

Deno.test('uma verificação que falha não impede as outras', async () => {
  const t = falso({ quebrar: 'mensagens', leituras: ['desconectado', 'desconectado'], assistente: { modo: 'teste', desde: '2026-09-20T00:00:00Z' } })
  const r = await vigiar(t.deps, semFaxina)
  assert(r.erros.join() === 'mensagens' && r.conexao === 'caida' && r.assistenteEmTeste)
  const u = falso({ quebrar: 'conexao' })
  assert((await vigiar(u.deps, semFaxina)).erros.join() === 'conexao')
})

Deno.test('faxina dos avisos antigos: só na primeira janela de cada hora', async () => {
  let chamadas = 0
  const expurgar = () => { chamadas++; return Promise.resolve(4) }
  const cedo = await vigiar(falso({ agora: '2026-10-03T15:02:00Z' }).deps, expurgar)
  assert(cedo.avisosApagados === 4 && chamadas === 1)
  const tarde = await vigiar(falso({ agora: '2026-10-03T15:30:00Z' }).deps, expurgar)
  assert(tarde.avisosApagados === 0 && chamadas === 1)
  const quebrada = await vigiar(falso({ agora: '2026-10-03T15:01:00Z' }).deps, () => Promise.reject(new Error('x')))
  assert(quebrada.erros.join() === 'faxina')
})

Deno.test('retenção de mídia: o vigia conta o que foi removido e uma falha dela não derruba o resto', async () => {
  const ok = await vigiar(falso({ midias: 7 }).deps, semFaxina)
  assert(ok.midiasRemovidas === 7 && ok.erros.length === 0)
  const t = falso({ quebrar: 'midias', leituras: ['desconectado', 'desconectado'] })
  const r = await vigiar(t.deps, semFaxina)
  assert(r.erros.join() === 'midias' && r.conexao === 'caida' && r.midiasRemovidas === 0)
})

Deno.test('conversa adiada que venceu: volta e abre um aviso por contato, com link para a conversa', async () => {
  const t = falso({ adiadas: [{ contatoId: 'c1', nome: ' Maria ' }, { contatoId: 'c2', nome: null }] })
  const r = await vigiar(t.deps, semFaxina)
  assert(r.adiadasQueVoltaram === 2)
  const a = t.abertos().filter((x) => x.p_tipo === 'conversa_adiada_voltou')
  assert(a.length === 2 && a[0].p_chave === 'c1' && a[0].p_rota === '/conversas?lead=c1' && a[0].p_titulo === 'A conversa com Maria voltou para a fila')
  assert(a[1].p_titulo === 'Uma conversa adiada voltou para a fila' && a[1].p_gravidade === 'info')
})

Deno.test('adiadas que falham não derrubam as outras verificações', async () => {
  const t = falso({ quebrar: 'adiadas', leituras: ['desconectado', 'desconectado'] })
  const r = await vigiar(t.deps, semFaxina)
  assert(r.erros.join() === 'adiadas' && r.conexao === 'caida')
})

Deno.test('tarefas vencidas: um aviso por pessoa, com a data da mais antiga, e fecha quem não tem mais', async () => {
  const t = falso({ tarefas: [
    { responsavelId: 'u1', nome: ' Ana ', quantidade: 3, maisAntiga: '2026-09-30T12:00:00Z' },
    { responsavelId: 'u2', nome: 'Bruno', quantidade: 1, maisAntiga: '2026-10-03T10:00:00Z' },
    { responsavelId: null, nome: null, quantidade: 2, maisAntiga: '2026-10-02T09:00:00Z' },
  ] })
  const r = await vigiar(t.deps, semFaxina)
  assert(r.tarefasVencidas === 6)
  const a = t.abertos().filter((x) => x.p_tipo === 'tarefas_vencidas')
  assert(a.length === 3 && a.every((x) => x.p_rota === '/tarefas' && x.p_gravidade === 'atencao'))
  assert(a[0].p_chave === 'u1' && a[0].p_titulo === 'Ana tem 3 tarefas vencidas' && String(a[0].p_detalhe).startsWith('A mais antiga venceu há 3 dias'))
  assert(a[1].p_titulo === 'Bruno tem 1 tarefa vencida' && String(a[1].p_detalhe).startsWith('A mais antiga venceu hoje'))
  assert(a[2].p_chave === 'sem_responsavel' && a[2].p_titulo === '2 tarefas vencidas estão sem responsável' && String(a[2].p_detalhe).startsWith('A mais antiga venceu ontem'))
  const e = t.exceto()
  assert(e.length === 1 && e[0].p_tipo === 'tarefas_vencidas' && JSON.stringify(e[0].p_chaves) === JSON.stringify(['u1', 'u2', 'sem_responsavel']))
})

Deno.test('tarefas vencidas: ninguém atrasado fecha todos os avisos do tipo', async () => {
  const t = falso({ tarefas: [] })
  const r = await vigiar(t.deps, semFaxina)
  const e = t.exceto()
  assert(r.tarefasVencidas === 0 && t.abertos().length === 0 && e.length === 1 && JSON.stringify(e[0].p_chaves) === '[]')
})

Deno.test('tarefas vencidas: instalação sem tarefas não abre nem fecha nada', async () => {
  const t = falso({ tarefas: null })
  const r = await vigiar(t.deps, semFaxina)
  assert(r.tarefasVencidas === 0 && t.abertos().length === 0 && t.exceto().length === 0)
})

Deno.test('tarefas que falham não derrubam as outras verificações', async () => {
  const t = falso({ quebrar: 'tarefas', leituras: ['desconectado', 'desconectado'] })
  const r = await vigiar(t.deps, semFaxina)
  assert(r.erros.join() === 'tarefas' && r.conexao === 'caida' && t.exceto().length === 0)
})

Deno.test('radar: um aviso por pessoa com negócios críticos e fecha quem zerou', async () => {
  const t = falso({ radar: [{ responsavelId: 'u1', nome: ' Ana ', quantidade: 2 }, { responsavelId: 'u2', nome: 'Bruno', quantidade: 1 }, { responsavelId: null, nome: null, quantidade: 3 }] })
  const r = await vigiar(t.deps, semFaxina)
  assert(r.negociosCriticos === 6)
  const a = t.abertos().filter((x) => x.p_tipo === 'radar_critico')
  assert(a.length === 3 && a.every((x) => x.p_rota === '/radar' && x.p_gravidade === 'atencao'))
  assert(a[0].p_chave === 'u1' && a[0].p_titulo === 'Ana tem 2 negócios críticos sem próximo passo')
  assert(a[1].p_titulo === 'Bruno tem 1 negócio crítico sem próximo passo')
  assert(a[2].p_chave === 'sem_responsavel' && a[2].p_titulo === '3 negócios críticos estão sem responsável')
  const e = t.exceto('radar_critico')
  assert(e.length === 1 && JSON.stringify(e[0].p_chaves) === JSON.stringify(['u1', 'u2', 'sem_responsavel']))
})

Deno.test('radar: nenhum crítico fecha todos os avisos do tipo; sem o radar instalado não mexe em nada', async () => {
  const vazio = falso({ radar: [] })
  await vigiar(vazio.deps, semFaxina)
  const e = vazio.exceto('radar_critico')
  assert(e.length === 1 && JSON.stringify(e[0].p_chaves) === '[]' && vazio.abertos().filter((x) => x.p_tipo === 'radar_critico').length === 0)
  const sem = falso({ radar: null })
  const r = await vigiar(sem.deps, semFaxina)
  assert(r.negociosCriticos === 0 && sem.exceto('radar_critico').length === 0)
})

Deno.test('radar que falha não derruba as outras verificações', async () => {
  const t = falso({ quebrar: 'radar', leituras: ['desconectado', 'desconectado'] })
  const r = await vigiar(t.deps, semFaxina)
  assert(r.erros.join() === 'radar' && r.conexao === 'caida')
})

const devolvida = (id: string, nome: string | null, minutos: number, pendente = true): ConversaDevolvida =>
  ({ contatoId: id, nome, whatsapp: '5511999990000', minutos, pendente: pendente ? { id: `m-${id}`, tipo: 'texto', texto: 'Alguém aí?' } : null })

Deno.test('volta ao assistente: um aviso por conversa, com o tempo sem resposta, e só as com cliente esperando são retomadas', async () => {
  const t = falso({ devolvidas: [devolvida('c1', 'Ana', 35), devolvida('c2', null, 130, false)] })
  const r = await vigiar(t.deps, semFaxina)
  assert(r.devolvidasAoAssistente === 2 && r.erros.length === 0)
  const a = t.abertos().filter((x) => x.p_tipo === 'assistente_reassumiu')
  assert(a.length === 2 && a.every((x) => x.p_gravidade === 'info'))
  assert(a[0].p_chave === 'c1' && a[0].p_titulo === 'O assistente voltou a atender Ana' && a[0].p_rota === '/conversas?lead=c1')
  assert(String(a[0].p_detalhe).includes('35 minutos') && String(a[0].p_detalhe).includes('esperando') && String(a[0].p_detalhe).includes('Eu cuido'), String(a[0].p_detalhe))
  assert(a[1].p_titulo === 'O assistente voltou a atender uma conversa' && String(a[1].p_detalhe).includes('2 horas') && !String(a[1].p_detalhe).includes('esperando'))
  assert(t.f.retomadas.length === 1 && t.f.retomadas[0].map((c) => c.contatoId).join() === 'c1', 'só quem tinha cliente esperando é retomado')
})

Deno.test('volta ao assistente: sem conversa vencida (ou sem prazo, ou sem o módulo) não abre aviso nem retoma', async () => {
  const t = falso({ devolvidas: [] })
  const r = await vigiar(t.deps, semFaxina)
  assert(r.devolvidasAoAssistente === 0 && t.f.retomadas.length === 0 && !t.abertos().some((x) => x.p_tipo === 'assistente_reassumiu'))
})

Deno.test('volta ao assistente: sem cliente esperando, avisa mas não chama o assistente', async () => {
  const t = falso({ devolvidas: [devolvida('c1', 'Ana', 60, false)] })
  const r = await vigiar(t.deps, semFaxina)
  assert(r.devolvidasAoAssistente === 1 && t.f.retomadas.length === 0 && t.abertos().some((x) => x.p_tipo === 'assistente_reassumiu'))
})

Deno.test('volta ao assistente: falha ao retomar fica registrada, mas a conversa já devolvida continua contada', async () => {
  const t = falso({ devolvidas: [devolvida('c1', 'Ana', 40)], quebrar: 'retomada' })
  const r = await vigiar(t.deps, semFaxina)
  assert(r.devolvidasAoAssistente === 1 && r.erros.join() === 'devolucoes', `erros: ${r.erros}`)
})

Deno.test('volta ao assistente: falha ao devolver não derruba as outras verificações', async () => {
  const t = falso({ quebrar: 'devolucao', presas: [{ id: 'm1', contatoId: 'c1' }] })
  const r = await vigiar(t.deps, semFaxina)
  assert(r.erros.join() === 'devolucoes' && r.mensagensPresas === 1)
})
