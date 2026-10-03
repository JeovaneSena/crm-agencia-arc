// O vigia sem banco nem rede: tudo entra por `DepsVigia`.
import { vigiar, type DepsVigia, type MensagemPresa } from './vigia.ts'
import type { Rpc } from './avisos.ts'

function assert(v: unknown, m = 'Assertion failed'): asserts v { if (!v) throw new Error(m) }

interface Chamada { nome: string; args: Record<string, unknown> }
function falso(o: {
  agora?: string; presas?: MensagemPresa[]; leituras?: (string | null)[]; assistente?: { modo: string; desde: string } | null
  quebrar?: 'mensagens' | 'conexao' | 'assistente'
} = {}) {
  const f = { chamadas: [] as Chamada[], marcadas: [] as string[], esperas: [] as number[], antesDe: null as Date | null }
  const leituras = [...(o.leituras ?? ['conectado'])]
  const rpc = (async (nome: string, args: Record<string, unknown>) => { f.chamadas.push({ nome, args }); return nome === 'aviso_resolver_auto' ? 0 : 'id' }) as Rpc
  const deps: DepsVigia = {
    agora: () => new Date(o.agora ?? '2026-10-03T15:30:00Z'),
    esperar: (ms) => { f.esperas.push(ms); return Promise.resolve() },
    rpc,
    mensagensPendentes: (antes) => { f.antesDe = antes; if (o.quebrar === 'mensagens') return Promise.reject(new Error('banco fora')); return Promise.resolve(o.presas ?? []) },
    marcarIncertas: (ids) => { f.marcadas.push(...ids); return Promise.resolve() },
    estadoDaConexao: () => { if (o.quebrar === 'conexao') return Promise.reject(new Error('uazapi fora')); return Promise.resolve(leituras.length > 1 ? leituras.shift()! : leituras[0]) },
    assistente: () => { if (o.quebrar === 'assistente') return Promise.reject(new Error('banco fora')); return Promise.resolve(o.assistente ? { modo: o.assistente.modo, desde: new Date(o.assistente.desde) } : null) },
  }
  const abertos = () => f.chamadas.filter((c) => c.nome === 'aviso_abrir').map((c) => c.args)
  const fechados = () => f.chamadas.filter((c) => c.nome === 'aviso_resolver_auto').map((c) => c.args.p_tipo)
  return { f, deps, abertos, fechados }
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
