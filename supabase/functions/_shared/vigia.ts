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
 *   6. faxina dos avisos antigos, uma vez por hora.
 *
 * Só lógica: banco, WhatsApp e relógio entram por `DepsVigia`. Cada verificação é isolada:
 * uma que falha não impede as outras, e o resultado diz quais falharam.
 *
 * Ideia adaptada do DeskcommCRM (MIT, © 2026 Rafael Melgaço): `cron/recover-stuck-messages`,
 * `cron/channel-health` e `cron/canal-mudo-watcher`.
 */
import { abrirAviso, resolverAviso, type Rpc } from './avisos.ts'

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
}

export interface ResultadoDoVigia {
  mensagensPresas: number
  conexao: 'ok' | 'caida' | 'nao_vigiada' | 'oscilou'
  assistenteEmTeste: boolean
  adiadasQueVoltaram: number
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
  const r: ResultadoDoVigia = { mensagensPresas: 0, conexao: 'nao_vigiada', assistenteEmTeste: false, adiadasQueVoltaram: 0, midiasRemovidas: 0, avisosApagados: 0, erros: [] }
  const passo = async (nome: string, f: () => Promise<void>) => {
    try { await f() } catch (e) { r.erros.push(nome); console.error(`vigia: ${nome}:`, e instanceof Error ? e.message.slice(0, 160) : 'erro') }
  }
  await passo('mensagens', async () => { r.mensagensPresas = await vigiarMensagens(deps) })
  await passo('conexao', async () => { r.conexao = await vigiarConexao(deps) })
  await passo('assistente', async () => { r.assistenteEmTeste = await vigiarAssistente(deps) })
  await passo('adiadas', async () => { r.adiadasQueVoltaram = await vigiarAdiadas(deps) })
  await passo('midias', async () => { r.midiasRemovidas = await deps.removerMidiasVencidas() })
  // A faxina custa uma consulta e não precisa de pressa: uma vez por hora, nos primeiros 5 minutos.
  if (deps.agora().getUTCMinutes() < 5) await passo('faxina', async () => { r.avisosApagados = await expurgarAvisos() })
  return r
}
