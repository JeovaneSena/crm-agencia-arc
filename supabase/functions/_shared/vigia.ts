/**
 * O VIGIA — quem olha, de tempos em tempos, o que não gera evento sozinho.
 *
 * Um webhook avisa em segundos enquanto o transporte está vivo. Quando ele morre, não chega
 * evento nenhum, e "nenhum evento" é indistinguível de "tudo bem". O vigia pergunta. Cada
 * achado vira um aviso na Central (`avisos.ts`); quando a causa some, o aviso se fecha sozinho.
 *
 *   1. mensagem presa: saiu da tela e nunca foi confirmada. Fica `incerto` (pode ter saído:
 *      nunca é reenviada sozinha) e a equipe é avisada para conferir.
 *   2. WhatsApp caído: a conexão não está de pé, medida duas vezes para não acusar um piscar.
 *   3. assistente em modo de teste há dias: o canal "funciona", as mensagens chegam e a IA
 *      nunca responde ninguém fora da lista. É o esquecimento mais caro e mais silencioso.
 *   4. conversa adiada que chegou na hora: volta para a fila e a equipe é avisada.
 *   5. retenção de mídia: se o gestor definiu um prazo, apaga do Storage os arquivos mais velhos que ele.
 *   6. tarefas vencidas: um aviso por pessoa ("Ana tem 3 tarefas vencidas"), que se fecha quando ela zera as vencidas.
 *   7. radar: um aviso por pessoa com negócios críticos ("Ana tem 2 negócios críticos sem próximo passo"), fechado
 *      quando ela não tem mais nenhum.
 *   8. conversa que o assistente encaminhou e a equipe não atendeu dentro do prazo do gestor: volta ao assistente
 *      (só com o prazo definido), e o assistente responde o que o cliente deixou sem resposta. A equipe é avisada.
 *   9. faxina dos avisos antigos, uma vez por hora.
 *
 * Só lógica: banco, WhatsApp e relógio entram por `DepsVigia`. Cada verificação é isolada:
 * uma que falha não impede as outras, e o resultado diz quais falharam.
 *
 * Ideia adaptada do DeskcommCRM (MIT, © 2026 Rafael Melgaço): `cron/recover-stuck-messages`,
 * `cron/channel-health` e `cron/canal-mudo-watcher`.
 */
import { abrirAviso, resolverAviso, resolverAvisosExceto, type Rpc } from './avisos.ts'

/** Passado isto sem confirmação, a mensagem deixa de ser "enviando". */
export const MINUTOS_ATE_PRESA = 5
/** Quantos dias em modo de teste viram um aviso. */
export const DIAS_DE_TESTE_ESQUECIDO = 3
/** Espera entre as duas leituras da conexão. */
export const ESPERA_DA_SEGUNDA_LEITURA_MS = 10_000

export interface MensagemPresa { id: string; contatoId: string }
export interface DepsVigia {
  agora(): Date
  esperar(ms: number): Promise<void>
  rpc: Rpc
  /** Mensagens da equipe ou da IA ainda `pendente` desde antes de `antesDe`. */
  mensagensPendentes(antesDe: Date): Promise<MensagemPresa[]>
  /** Marca como `incerto` só as que AINDA estão pendentes. */
  marcarIncertas(ids: string[]): Promise<void>
  /** Estado da conexão com o WhatsApp, ou `null` se esta instalação não usa a uazapi (nada a vigiar). */
  estadoDaConexao(): Promise<string | null>
  /** Modo do assistente e desde quando, ou `null` se o módulo não está instalado. */
  assistente(): Promise<{ modo: string; desde: Date } | null>
  /** Conversas adiadas cuja hora chegou: zera o adiamento e devolve quem são (uma vez cada). */
  reabrirAdiadas(): Promise<{ contatoId: string; nome: string | null }[]>
  /** Apaga do Storage (e registra) um lote de arquivos vencidos. Sem prazo definido, não faz nada. Devolve quantos. */
  removerMidiasVencidas(): Promise<number>
  /** Quantas tarefas vencidas cada pessoa tem (`responsavelId` nulo = sem responsável), ou `null` se esta instalação ainda não tem tarefas. */
  tarefasVencidas(): Promise<TarefasVencidas[] | null>
  /** Quantos negócios críticos no radar cada pessoa tem (`responsavelId` nulo = sem responsável), ou `null` se esta instalação ainda não tem o radar. */
  negociosCriticos(): Promise<NegociosCriticos[] | null>
  /** Devolve ao assistente as conversas encaminhadas que passaram do prazo sem sinal da equipe. Lista vazia se o prazo não foi definido ou se esta instalação não tem o assistente. */
  devolverAoAssistente(): Promise<ConversaDevolvida[]>
  /** Faz o assistente responder o que o cliente deixou sem resposta. Não pode demorar a rodada do vigia: o trabalho segue em segundo plano. */
  retomarConversas(conversas: ConversaDevolvida[]): Promise<void>
}

export interface ConversaDevolvida {
  contatoId: string; nome: string | null; whatsapp: string
  /** Minutos sem nenhum sinal da equipe quando a conversa voltou. */
  minutos: number
  /** A mensagem do cliente que ficou sem resposta (a última da conversa, texto, de até 24 h), se houver. */
  pendente: { id: string; tipo: string; texto: string | null } | null
}

export interface NegociosCriticos { responsavelId: string | null; nome: string | null; quantidade: number }

export interface TarefasVencidas { responsavelId: string | null; nome: string | null; quantidade: number; maisAntiga: Date }

export interface ResultadoDoVigia {
  mensagensPresas: number
  conexao: 'ok' | 'caida' | 'nao_vigiada' | 'oscilou'
  assistenteEmTeste: boolean
  adiadasQueVoltaram: number
  tarefasVencidas: number
  negociosCriticos: number
  devolvidasAoAssistente: number
  midiasRemovidas: number
  avisosApagados: number
  erros: string[]
}

const CAIDOS = new Set(['desconectado', 'indisponivel'])

async function vigiarMensagens(deps: DepsVigia): Promise<number> {
  const limite = new Date(deps.agora().getTime() - MINUTOS_ATE_PRESA * 60_000)
  const presas = await deps.mensagensPendentes(limite)
  if (!presas.length) return 0
  await deps.marcarIncertas(presas.map((m) => m.id))
  const porContato = new Map<string, number>()
  for (const m of presas) porContato.set(m.contatoId, (porContato.get(m.contatoId) ?? 0) + 1)
  for (const [contatoId, n] of porContato) {
    await abrirAviso(deps.rpc, {
      tipo: 'mensagem_presa', chave: contatoId, gravidade: 'atencao', contatoId, rota: '/conversas',
      titulo: n === 1 ? 'Uma mensagem não teve o envio confirmado' : `${n} mensagens não tiveram o envio confirmado`,
      detalhe: 'Pode ter saído ou não. Confira na conversa antes de escrever de novo: o sistema não reenvia sozinho.',
    })
  }
  return presas.length
}

async function vigiarConexao(deps: DepsVigia): Promise<ResultadoDoVigia['conexao']> {
  const primeira = await deps.estadoDaConexao()
  if (primeira === null) return 'nao_vigiada'
  if (primeira === 'conectado') { await resolverAviso(deps.rpc, 'conexao_caida'); return 'ok' }
  if (!CAIDOS.has(primeira)) return 'oscilou' // conectando, não configurado: transição, não queda
  // Um piscar da ponte não é queda: só vale se a segunda leitura confirmar.
  await deps.esperar(ESPERA_DA_SEGUNDA_LEITURA_MS)
  const segunda = await deps.estadoDaConexao()
  if (segunda === 'conectado') { await resolverAviso(deps.rpc, 'conexao_caida'); return 'oscilou' }
  if (segunda === null || !CAIDOS.has(segunda)) return 'oscilou'
  await abrirAviso(deps.rpc, {
    tipo: 'conexao_caida', gravidade: 'critico', rota: '/conversas',
    titulo: 'O WhatsApp está desconectado',
    detalhe: 'Mensagens novas não chegam e as respostas não saem. Reconecte o número pela tela de Conversas.',
  })
  return 'caida'
}

async function vigiarAdiadas(deps: DepsVigia): Promise<number> {
  const voltaram = await deps.reabrirAdiadas()
  for (const c of voltaram) {
    await abrirAviso(deps.rpc, {
      tipo: 'conversa_adiada_voltou', chave: c.contatoId, gravidade: 'info', contatoId: c.contatoId, rota: `/conversas?lead=${c.contatoId}`,
      titulo: c.nome?.trim() ? `A conversa com ${c.nome.trim()} voltou para a fila` : 'Uma conversa adiada voltou para a fila',
      detalhe: 'O cliente não respondeu nesse tempo. Era a hora de retomar.',
    })
  }
  return voltaram.length
}

async function vigiarTarefas(deps: DepsVigia): Promise<number> {
  const grupos = await deps.tarefasVencidas()
  if (grupos === null) return 0
  const agora = deps.agora().getTime()
  for (const g of grupos) {
    const dias = Math.max(0, Math.floor((agora - g.maisAntiga.getTime()) / 86_400_000))
    const nome = g.nome?.trim() || 'Alguém da equipe'
    const n = g.quantidade
    await abrirAviso(deps.rpc, {
      tipo: 'tarefas_vencidas', chave: g.responsavelId ?? 'sem_responsavel', gravidade: 'atencao', rota: '/tarefas',
      titulo: g.responsavelId
        ? (n === 1 ? `${nome} tem 1 tarefa vencida` : `${nome} tem ${n} tarefas vencidas`)
        : (n === 1 ? '1 tarefa vencida está sem responsável' : `${n} tarefas vencidas estão sem responsável`),
      detalhe: `${dias === 0 ? 'A mais antiga venceu hoje' : dias === 1 ? 'A mais antiga venceu ontem' : `A mais antiga venceu há ${dias} dias`}. Conclua, adie o prazo ou passe para outra pessoa.`,
    })
  }
  // Quem zerou as vencidas deixa de aparecer: fecha o aviso de quem NÃO está na lista de hoje.
  await resolverAvisosExceto(deps.rpc, 'tarefas_vencidas', grupos.map((g) => g.responsavelId ?? 'sem_responsavel'))
  return grupos.reduce((soma, g) => soma + g.quantidade, 0)
}

async function vigiarRadar(deps: DepsVigia): Promise<number> {
  const grupos = await deps.negociosCriticos()
  if (grupos === null) return 0
  for (const g of grupos) {
    const nome = g.nome?.trim() || 'Alguém da equipe'
    const n = g.quantidade
    await abrirAviso(deps.rpc, {
      tipo: 'radar_critico', chave: g.responsavelId ?? 'sem_responsavel', gravidade: 'atencao', rota: '/radar',
      titulo: g.responsavelId
        ? (n === 1 ? `${nome} tem 1 negócio crítico sem próximo passo` : `${nome} tem ${n} negócios críticos sem próximo passo`)
        : (n === 1 ? '1 negócio crítico está sem responsável' : `${n} negócios críticos estão sem responsável`),
      detalhe: 'Ficaram muito tempo sem atividade e sem tarefa, reunião ou retomada à frente. Combine o próximo passo ou encerre o negócio.',
    })
  }
  await resolverAvisosExceto(deps.rpc, 'radar_critico', grupos.map((g) => g.responsavelId ?? 'sem_responsavel'))
  return grupos.reduce((soma, g) => soma + g.quantidade, 0)
}

function tempoSemSinal(minutos: number): string {
  if (minutos < 60) return `${minutos} minuto${minutos === 1 ? '' : 's'}`
  const h = Math.floor(minutos / 60)
  return `${h} hora${h === 1 ? '' : 's'}`
}

async function vigiarDevolucoes(deps: DepsVigia, r: ResultadoDoVigia): Promise<void> {
  const voltaram = await deps.devolverAoAssistente()
  if (!voltaram.length) return
  // Já voltaram no banco: a contagem vale mesmo que o aviso ou a resposta falhem logo abaixo.
  r.devolvidasAoAssistente = voltaram.length
  for (const c of voltaram) {
    const nome = c.nome?.trim()
    await abrirAviso(deps.rpc, {
      tipo: 'assistente_reassumiu', chave: c.contatoId, gravidade: 'info', contatoId: c.contatoId, rota: `/conversas?lead=${c.contatoId}`,
      titulo: nome ? `O assistente voltou a atender ${nome}` : 'O assistente voltou a atender uma conversa',
      detalhe: `Ninguém da equipe respondeu em ${tempoSemSinal(c.minutos)}${c.pendente ? ', e o cliente estava esperando' : ''}. Para ficar com a conversa, clique em "Eu cuido".`,
    })
  }
  const comPendente = voltaram.filter((c) => c.pendente)
  if (comPendente.length) await deps.retomarConversas(comPendente)
}

async function vigiarAssistente(deps: DepsVigia): Promise<boolean> {
  const a = await deps.assistente()
  if (!a || a.modo !== 'teste') { if (a) await resolverAviso(deps.rpc, 'assistente_em_teste'); return false }
  const dias = Math.floor((deps.agora().getTime() - a.desde.getTime()) / 86_400_000)
  if (dias < DIAS_DE_TESTE_ESQUECIDO) return true
  await abrirAviso(deps.rpc, {
    tipo: 'assistente_em_teste', gravidade: 'atencao', somenteGestor: true, rota: '/assistente-ia',
    titulo: 'O assistente continua em modo de teste',
    detalhe: `Há ${dias} dias ele só responde aos números da lista de teste; os outros clientes ficam sem resposta automática. Passe para "ao vivo" ou desligue.`,
  })
  return true
}

export async function vigiar(deps: DepsVigia, expurgarAvisos: () => Promise<number>): Promise<ResultadoDoVigia> {
  const r: ResultadoDoVigia = { mensagensPresas: 0, conexao: 'nao_vigiada', assistenteEmTeste: false, adiadasQueVoltaram: 0, tarefasVencidas: 0, negociosCriticos: 0, devolvidasAoAssistente: 0, midiasRemovidas: 0, avisosApagados: 0, erros: [] }
  const passo = async (nome: string, f: () => Promise<void>) => {
    try { await f() } catch (e) { r.erros.push(nome); console.error(`vigia: ${nome}:`, e instanceof Error ? e.message.slice(0, 160) : 'erro') }
  }
  await passo('mensagens', async () => { r.mensagensPresas = await vigiarMensagens(deps) })
  await passo('conexao', async () => { r.conexao = await vigiarConexao(deps) })
  await passo('assistente', async () => { r.assistenteEmTeste = await vigiarAssistente(deps) })
  await passo('adiadas', async () => { r.adiadasQueVoltaram = await vigiarAdiadas(deps) })
  await passo('tarefas', async () => { r.tarefasVencidas = await vigiarTarefas(deps) })
  await passo('radar', async () => { r.negociosCriticos = await vigiarRadar(deps) })
  await passo('devolucoes', async () => { await vigiarDevolucoes(deps, r) })
  await passo('midias', async () => { r.midiasRemovidas = await deps.removerMidiasVencidas() })
  // A faxina custa uma consulta e não precisa de pressa: uma vez por hora, nos primeiros 5 minutos.
  if (deps.agora().getUTCMinutes() < 5) await passo('faxina', async () => { r.avisosApagados = await expurgarAvisos() })
  return r
}
