/**
 * O assistente (IA): decide se responde, monta a conversa, deixa o modelo consultar serviços e horários,
 * limpa o texto e envia. Só lógica: banco, WhatsApp e modelo entram por `DepsIA`, para testar sem nada disso.
 *
 * ── AS TRAVAS (todas conferidas AQUI, no código que roda no servidor; a tela só mostra o estado) ──
 *  1. modo `desligada`: não responde ninguém.
 *  2. modo `teste`: responde SÓ os números da lista, seja qual for o estado da conversa.
 *  3. modo `ao_vivo`: só conversas com a IA ligada (`ia_ligada`).
 *  4. nunca ao que não é texto.
 *  5. conversa assumida por alguém da equipe: a IA cala.
 *  6. equipe atendendo: se um humano escreveu pelo CRM nas últimas 12 h, a IA cala.
 *  7. limite de respostas por conversa.
 *  8. uma resposta por mensagem do cliente (chave primária em `assistente_respostas`) e só a ÚLTIMA mensagem
 *     de uma rajada é respondida.
 *  9. quem pede para parar de receber mensagem (`optout.ts`) não recebe resposta: a IA se cala na conversa e a
 *     equipe é chamada. Pedido inequívoco também revoga o consentimento de marketing; o ambíguo só chama a equipe.
 * As travas 5 a 7 são reavaliadas três vezes: ao receber, depois da espera e imediatamente antes de enviar.
 */
import { FERRAMENTAS, LIMITE_PALAVRAS, montarPrompt } from './assistente_prompt.ts'
import { classificarOptOut, type NivelOptOut } from './optout.ts'
import type { MensagemLLM, PedidoLLM, RespostaLLM } from './llm.ts'

export const HORAS_DE_SILENCIO = 12
const MAX_RODADAS = 4
const PRAZO_TOTAL_MS = 60_000

export interface ConfigIA {
  modo: 'desligada' | 'teste' | 'ao_vivo'
  nome: string; modelo: string; instrucoes: string | null
  numerosTeste: string[]; maxRespostas: number; esperaSegundos: number
}
export interface ConversaIA { id: string; iaLigada: boolean; assumida: boolean; respostasDaIA: number }
export interface EntradaIA {
  mensagemId: string; contatoId: string; telefone: string
  tipo: string; texto: string | null
}
export type Decisao = { responder: true } | { responder: false; motivo: string }

/** Só dígitos; celular antigo (55 + DDD + 8 dígitos) ganha o nono dígito, dos dois lados da comparação. */
export function normalizarTelefone(p: string): string {
  const d = p.replace(/\D/g, '')
  return /^55\d{2}[6-9]\d{7}$/.test(d) ? `${d.slice(0, 4)}9${d.slice(4)}` : d
}

/** A decisão pura: sem rede, sem relógio. Cada `motivo` vai para o log, sem dado pessoal. */
export function decidir(c: { config: ConfigIA; conversa: ConversaIA; entrada: EntradaIA; equipeAtendendo: boolean }): Decisao {
  const { config, conversa, entrada } = c
  if (config.modo === 'desligada') return { responder: false, motivo: 'ia_desligada' }
  if (config.modo === 'teste' && !config.numerosTeste.map(normalizarTelefone).includes(normalizarTelefone(entrada.telefone))) return { responder: false, motivo: 'fora_da_lista_de_teste' }
  if (config.modo === 'ao_vivo' && !conversa.iaLigada) return { responder: false, motivo: 'ia_desligada_na_conversa' }
  if (entrada.tipo !== 'texto') return { responder: false, motivo: 'nao_e_texto' }
  if (!entrada.texto?.trim()) return { responder: false, motivo: 'sem_texto' }
  if (conversa.assumida) return { responder: false, motivo: 'conversa_assumida' }
  if (conversa.respostasDaIA >= config.maxRespostas) return { responder: false, motivo: 'limite_de_respostas' }
  if (c.equipeAtendendo) return { responder: false, motivo: 'equipe_atendendo' }
  return { responder: true }
}

export type ResultadoIA =
  | { estado: 'ignorada'; motivo: string }
  | { estado: 'respondida' | 'encaminhada' }
  | { estado: 'falhou'; motivo: string }

export interface ItemHistorico { deCliente: boolean; texto: string | null; tipo: string }
export interface Servico { nome: string; descricao: string | null; preco_a_partir_de: number | null; duracao_minutos: number; exige_reuniao_previa: boolean }
export interface DepsIA {
  agora(): Date
  esperar(ms: number): Promise<void>
  lerConfig(): Promise<ConfigIA | null>
  lerConversa(contatoId: string): Promise<ConversaIA | null>
  /** Um atendente escreveu pelo CRM nas últimas `horas`? */
  equipeAtendendo(contatoId: string, horas: number): Promise<boolean>
  /** true só na primeira vez: é a trava de resposta em dobro. */
  reservar(mensagemId: string, contatoId: string): Promise<boolean>
  finalizar(mensagemId: string, estado: 'respondida' | 'encaminhada' | 'ignorada' | 'falhou', motivo: string | null): Promise<void>
  /** Chegou mensagem do cliente depois desta? Então esta não é respondida: a mais nova cuida disso. */
  temMensagemMaisNova(contatoId: string, mensagemId: string): Promise<boolean>
  historico(contatoId: string, limite: number): Promise<ItemHistorico[]>
  contexto(): Promise<{ negocio: string; fuso: string }>
  conversar(pedido: PedidoLLM): Promise<RespostaLLM>
  servicos(): Promise<Servico[]>
  horarios(dia: string, duracaoMinutos: number): Promise<string[]>
  encaminhar(contatoId: string, resumo: string): Promise<void>
  /** O cliente pediu (ou parece ter pedido) para parar: calar a IA na conversa, avisar a equipe e, se for pedido claro, revogar o marketing. */
  pararDeFalar(contatoId: string, nivel: Exclude<NivelOptOut, 'nenhum'>): Promise<void>
  /** Envia e grava a mensagem como `agente`. Lança se não saiu: nunca reenviar. */
  enviar(contatoId: string, telefone: string, texto: string): Promise<void>
}

// ---------- o texto que vai para o cliente ----------

/**
 * O modelo às vezes escapa do combinado (markdown, travessão, texto longo). Aqui o combinado é garantido:
 * limpa o que não deve ir, parte em até 3 mensagens e corta o excesso por parágrafo inteiro.
 */
export function prepararResposta(bruto: string): string[] {
  const limpo = bruto
    .replace(/```[\s\S]*?```/g, ' ').replace(/[*_`#>]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '').replace(/\s*[—–]\s*/g, ', ')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  const partes = limpo.split(/\n\s*\n/).map(p => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).slice(0, 3)
  // Teto duro de 1,5x o pedido: um pouco de folga evita cortar uma frase útil no meio.
  const teto = Math.round(LIMITE_PALAVRAS * 1.5)
  const saida: string[] = []
  let total = 0
  for (const p of partes) {
    const n = p.split(/\s+/).length
    if (total + n > teto) {
      if (!saida.length) saida.push(p.split(/\s+/).slice(0, teto).join(' ').replace(/[,;:]$/, '') + '.')
      break
    }
    saida.push(p); total += n
  }
  return saida
}

const ROTULO_MIDIA: Record<string, string> = { imagem: 'imagem', audio: 'áudio', video: 'vídeo', documento: 'documento' }

/** A conversa como o modelo espera: começa e termina em "user", sem dois papéis iguais seguidos. */
export function montarMensagens(historico: ItemHistorico[]): MensagemLLM[] {
  const saida: MensagemLLM[] = []
  for (const h of historico) {
    const texto = h.texto?.trim() || (h.tipo === 'texto' ? '' : `[${ROTULO_MIDIA[h.tipo] ?? 'anexo'}]`)
    if (!texto) continue
    const papel = h.deCliente ? 'user' : 'assistant'
    const ultima = saida[saida.length - 1]
    if (ultima && ultima.papel === papel && typeof ultima.conteudo === 'string') ultima.conteudo += '\n' + texto
    else saida.push({ papel, conteudo: texto })
  }
  while (saida.length && saida[0].papel !== 'user') saida.shift()
  return saida
}

// ---------- ferramentas ----------

const AAAA_MM_DD = /^\d{4}-\d{2}-\d{2}$/
const reais = (v: number | null) => v === null ? 'sob consulta' : `a partir de R$ ${v.toFixed(2).replace('.', ',')}`

async function executar(deps: DepsIA, contatoId: string, nome: string, a: Record<string, unknown>): Promise<{ texto: string; encaminhou?: boolean }> {
  try {
    if (nome === 'consultar_servicos') {
      const s = await deps.servicos()
      return { texto: s.length ? JSON.stringify(s.map(x => ({ servico: x.nome, descricao: x.descricao, preco: reais(x.preco_a_partir_de), minutos: x.duracao_minutos, exige_reuniao_previa: x.exige_reuniao_previa }))) : 'Nenhum serviço cadastrado ainda. Chame a equipe.' }
    }
    if (nome === 'consultar_horarios') {
      const dia = typeof a.dia === 'string' ? a.dia.trim() : ''
      if (!AAAA_MM_DD.test(dia) || Number.isNaN(Date.parse(dia))) return { texto: 'Data inválida: use AAAA-MM-DD.' }
      let minutos = 60
      if (typeof a.servico === 'string' && a.servico.trim()) {
        const alvo = a.servico.trim().toLowerCase()
        const achado = (await deps.servicos()).find(s => s.nome.toLowerCase() === alvo || s.nome.toLowerCase().includes(alvo))
        if (achado) minutos = achado.duracao_minutos
      }
      const h = await deps.horarios(dia, minutos)
      return { texto: h.length ? `Horários livres em ${dia} (para ${minutos} minutos): ${h.slice(0, 12).join(', ')}. A equipe confirma o agendamento.` : `Sem horário livre em ${dia}. O negócio pode não abrir nesse dia.` }
    }
    if (nome === 'chamar_equipe') {
      const resumo = typeof a.resumo === 'string' ? a.resumo.trim().slice(0, 500) : ''
      await deps.encaminhar(contatoId, resumo || 'Cliente pediu atendimento da equipe.')
      return { texto: 'Conversa encaminhada para a equipe. Avise o cliente em uma frase e não escreva mais nada depois.', encaminhou: true }
    }
    return { texto: 'Ferramenta desconhecida.' }
  } catch {
    // O modelo recebe o erro como texto e decide: não vaza detalhe e não derruba a resposta.
    return { texto: 'Não consegui consultar agora. Diga que a equipe confirma.' }
  }
}

// ---------- o caminho completo ----------

export async function responderComIA(deps: DepsIA, entrada: EntradaIA): Promise<ResultadoIA> {
  const config = await deps.lerConfig()
  const conversa = config ? await deps.lerConversa(entrada.contatoId) : null
  if (!config || !conversa) return { estado: 'ignorada', motivo: 'sem_configuracao' }
  // `aposEncaminhar`: chamar a equipe desliga a IA na conversa, mas a frase de despedida ainda precisa sair.
  // Só a trava "IA ligada nesta conversa" é dispensada; todas as outras continuam valendo.
  const avaliar = async (aposEncaminhar = false) => {
    const atual = (await deps.lerConversa(entrada.contatoId)) ?? conversa
    return decidir({ config, conversa: aposEncaminhar ? { ...atual, iaLigada: true } : atual, entrada, equipeAtendendo: await deps.equipeAtendendo(entrada.contatoId, HORAS_DE_SILENCIO) })
  }

  const inicial = await avaliar()
  if (!inicial.responder) return { estado: 'ignorada', motivo: inicial.motivo }
  if (!(await deps.reservar(entrada.mensagemId, entrada.contatoId))) return { estado: 'ignorada', motivo: 'ja_reservada' }

  const fim = async (r: ResultadoIA): Promise<ResultadoIA> => {
    await deps.finalizar(entrada.mensagemId, r.estado, r.estado === 'respondida' ? null : ('motivo' in r ? r.motivo : null)).catch(() => {})
    return r
  }
  try {
    // Trava 9. Vem antes de qualquer espera ou modelo: quem pediu para parar não recebe nem a tentativa de reter.
    const optout = classificarOptOut(entrada.texto)
    if (optout !== 'nenhum') {
      try { await deps.pararDeFalar(entrada.contatoId, optout) } catch { return await fim({ estado: 'falhou', motivo: 'erro_ao_registrar_pedido_para_parar' }) }
      return await fim({ estado: 'ignorada', motivo: optout === 'pedido' ? 'pediu_para_parar' : 'possivel_pedido_para_parar' })
    }
    // Rajada: quem escreve em pedaços é respondido uma vez só, pela última mensagem.
    if (config.esperaSegundos > 0) await deps.esperar(config.esperaSegundos * 1000)
    if (await deps.temMensagemMaisNova(entrada.contatoId, entrada.mensagemId)) return await fim({ estado: 'ignorada', motivo: 'mensagem_mais_nova' })
    // Depois da espera tudo pode ter mudado: a equipe pode ter respondido ou desligado a IA.
    const depois = await avaliar()
    if (!depois.responder) return await fim({ estado: 'ignorada', motivo: depois.motivo })

    const limite = Date.now() + PRAZO_TOTAL_MS
    const { negocio, fuso } = await deps.contexto()
    const sistema = montarPrompt({ nome: config.nome, negocio, instrucoes: config.instrucoes, agora: deps.agora(), fuso })
    const mensagens = montarMensagens(await deps.historico(entrada.contatoId, 20))
    if (!mensagens.length || mensagens[mensagens.length - 1].papel !== 'user') return await fim({ estado: 'falhou', motivo: 'historico_sem_pergunta' })

    let texto = '', encaminhou = false
    for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
      if (Date.now() > limite) return await fim({ estado: 'falhou', motivo: 'prazo_esgotado' })
      const r = await deps.conversar({ modelo: config.modelo, sistema, mensagens, ferramentas: FERRAMENTAS, maxTokens: 700 })
      if (!r.chamadas.length) { texto = r.texto; break }
      mensagens.push({ papel: 'assistant', conteudo: r.texto, chamadas: r.chamadas })
      for (const c of r.chamadas) {
        const out = await executar(deps, entrada.contatoId, c.nome, c.argumentos)
        if (out.encaminhou) encaminhou = true
        mensagens.push({ papel: 'ferramenta', conteudo: out.texto, chamadaId: c.id })
      }
    }
    const partes = prepararResposta(texto)
    if (!partes.length) return await fim(encaminhou ? { estado: 'encaminhada' } : { estado: 'falhou', motivo: 'resposta_vazia' })

    // Última conferência antes de falar: a equipe pode ter assumido enquanto o modelo pensava.
    const ultima = await avaliar(encaminhou)
    if (!ultima.responder) return await fim({ estado: 'ignorada', motivo: ultima.motivo })

    for (let i = 0; i < partes.length; i++) {
      if (i > 0) await deps.esperar(1200)
      try { await deps.enviar(entrada.contatoId, entrada.telefone, partes[i]) }
      catch { return await fim({ estado: 'falhou', motivo: 'envio_falhou' }) } // pode ter saído: nunca reenviar
    }
    return await fim({ estado: encaminhou ? 'encaminhada' : 'respondida' })
  } catch (e) {
    console.error('assistente: falha', e instanceof Error ? e.message.slice(0, 120) : 'erro')
    return await fim({ estado: 'falhou', motivo: 'erro_interno' })
  }
}
