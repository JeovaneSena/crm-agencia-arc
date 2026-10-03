/**
 * QUEM PEDIU PARA PARAR DE RECEBER MENSAGEM — a regra, num lugar só.
 *
 * Duas partes do sistema precisam responder a mesma pergunta ("esta mensagem é um
 * pedido de descadastro?"): o webhook das campanhas, que revoga o consentimento, e o
 * assistente, que precisa calar. Com uma regra para cada, uma delas fica mais frouxa
 * que a outra. Aqui há uma só.
 *
 * ── A REGRA: INTENÇÃO, NÃO PALAVRA ──────────────────────────────────────────
 * "parar" e "sair" são vocabulário comum de quem fala com um negócio: "tem como parar a
 * dor?", "posso sair antes das 15h?". Caçar a palavra em qualquer posição apaga o
 * cliente da conversa em silêncio. Por isso só vale:
 *   • a palavra ISOLADA (a mensagem inteira é a palavra), a convenção do canal; ou
 *   • um verbo de cessação com OBJETO DE COMUNICAÇÃO ("parar de me mandar mensagem",
 *     "sair da lista", "não quero mais receber").
 *
 * ── DOIS NÍVEIS, e a diferença importa ──────────────────────────────────────
 *   'pedido'   inequívoco. Autoriza revogar o consentimento de marketing, um estado que
 *              só uma pessoa da equipe desfaz.
 *   'provavel' ambíguo ("me deixa em paz", "chega", "cancelar", "não tenho interesse",
 *              "isso é spam"). Só cala a IA e chama a equipe, que confirma. Deixar o
 *              ambíguo revogar sozinho inverteria a política.
 *
 * Adaptado de DeskcommCRM `lib/opt-out/deteccao.ts` (MIT, © 2026 Rafael Melgaço), com o
 * vocabulário reduzido ao português e ao que esta base já tinha nas campanhas.
 */
export type NivelOptOut = 'nenhum' | 'provavel' | 'pedido'

/** Minúsculas, sem acento, sem pontuação nem emoji, espaços simples. */
export function normalizar(texto: string): string {
  return texto.slice(0, 1000).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** A mensagem inteira é esta palavra ou frase curta. */
const ISOLADAS_PEDIDO = new Set([
  'stop', 'parar', 'pare', 'sair', 'descadastrar', 'descadastre', 'remover', 'unsubscribe',
  'cancelar mensagens', 'cancelar inscricao', 'nao me envie mais mensagens', 'nao quero receber mensagens',
  'nao quero mais receber', 'nao quero receber mais',
])
const ISOLADAS_PROVAVEIS = new Set(['nao quero mais', 'cancelar', 'chega', 'basta', 'sem interesse', 'nao tenho interesse', 'nao me interessa'])

// Verbos de comunicação (o que se pede para parar de fazer), no infinitivo.
const INFINITIVO = 'mandar|enviar|escrever|ligar|chamar|incomodar|perturbar|contatar|insistir|falar'
// Coisas que NÃO são a comunicação em si: "parar de mandar o pedido" é outro assunto.
const OBJETO_DE_NEGOCIO = '(?:o|a|os|as|meu|minha|meus|minhas|seu|sua|seus|suas|esse|essa|esses|essas)\\s+(?:pedidos?|encomendas?|entregas?|faturas?|boletos?|cobrancas?|produtos?|propostas?|orcamentos?|contratos?|notas?|arquivos?|documentos?|fotos?|link|projeto|site)'
const SEM_OBJETO_DE_NEGOCIO = `(?!\\s+(?:${OBJETO_DE_NEGOCIO}))`
// "lista de espera" é cliente querendo ser chamado; só vale a lista que é a mensagem.
const LISTAS_DE_ENVIO = 'contatos?|transmissao|envios?|mensagens|disparos?|divulgacao|promocoes|ofertas|whatsapp|zap|voces|vcs'
const FREIO_DE_LISTA = `(?!\\s+de\\s+(?!(?:${LISTAS_DE_ENVIO})\\b))`

const PEDIDOS: RegExp[] = [
  // Imperativo dirigido a nós: "pare de mandar mensagem", "para de me ligar", "pare de insistir".
  new RegExp(`\\b(?:pare|parem|para)\\s+de\\s+(?:me\\s+|nos\\s+)?(?:${INFINITIVO})\\b${SEM_OBJETO_DE_NEGOCIO}`),
  // Infinitivo só com o pronome: "quero parar de me receber", "tem como parar de me mandar". Sem "me",
  // "vou parar de enviar os arquivos" ou "parar de falar com o fornecedor" seriam falso positivo.
  new RegExp(`\\bparar\\s+de\\s+(?:me|nos)\\s+(?:${INFINITIVO})\\b${SEM_OBJETO_DE_NEGOCIO}`),
  // "não quero (mais) receber (nada/mensagens)", mas não "não quero receber ligação" nem "receber o boleto"
  new RegExp(`\\bnao\\s+(?:quero|desejo|preciso|vou)\\s+(?:mais\\s+)?receber\\b(?!\\s+(?:ligacao|ligacoes|telefonema|chamada|chamadas|email|emails|e mail)\\b)${SEM_OBJETO_DE_NEGOCIO}`),
  // imperativo: "não me mande mais", "não me ligue mais"
  /\bnao\s+(?:me\s+)?(?:mande|mandem|envie|enviem|escreva|escrevam|chame|chamem|ligue|liguem|perturbe|perturbem|incomode|incomodem|contate|contatem|procure|procurem)\s+mais\b/,
  // "me tira da lista", "sair da lista", "remova meu número da lista"
  new RegExp(`\\b(?:tira|tire|tirem|retira|retire|remove|remova|removam|exclui|exclua|excluam)\\s+(?:me\\s+)?(?:o\\s+)?(?:meu\\s+(?:numero|contato|cadastro|nome|telefone)\\s+)?d[ao]\\s+(?:sua\\s+|essa\\s+|esta\\s+|nossa\\s+)?lista\\b${FREIO_DE_LISTA}`),
  new RegExp(`\\b(?:sair|saia|me\\s+tirar|me\\s+remover)\\s+d[ao]\\s+(?:sua\\s+|essa\\s+|esta\\s+)?lista\\b${FREIO_DE_LISTA}`),
  /\bdescadastr(?:ar|e|o|em)\b/,
  /\bunsubscribe\b/,
  /\bcancel(?:ar|e|em)\s+(?:a\s+|minha\s+|meu\s+|o\s+)?(?:inscricao|assinatura|newsletter)\b/,
]

const PROVAVEIS: RegExp[] = [
  /\bme\s+(?:deixa|deixe|deixem)\s+em\s+paz\b/,
  /\bnao\s+(?:me\s+)?procura\s+mais\b/, // informal: pode descrever um terceiro
  /\bnao\s+(?:quero|vou)\s+mais\s+(?:falar|conversar|papo|contato)\b/,
  /\bnao\s+(?:me\s+)?(?:manda|envia|escreve|chama|liga)\s+mais\b/, // informal: pode descrever um terceiro
  /\bchega\s+de\s+(?:mensagens?|msgs?|spam|propaganda|insistencia)\b/,
  /\bnao\s+insista\b/,
  /\b(?:spam|denunci(?:ar|o|a)|vou\s+(?:te\s+|lhe\s+)?bloquear)\b/,
  /\bcancel(?:ar|e)\s+(?:o\s+|meu\s+)?cadastro\b/,
]

/** Classifica a mensagem. Texto vazio, ausente ou sem relação é 'nenhum'. */
export function classificarOptOut(valor: string | null | undefined): NivelOptOut {
  const t = normalizar(valor ?? '')
  if (!t) return 'nenhum'
  if (ISOLADAS_PEDIDO.has(t)) return 'pedido'
  if (PEDIDOS.some((r) => r.test(t))) return 'pedido'
  if (ISOLADAS_PROVAVEIS.has(t)) return 'provavel'
  if (PROVAVEIS.some((r) => r.test(t))) return 'provavel'
  return 'nenhum'
}

/** O pedido inequívoco: quem pode revogar o consentimento. */
export const ehPedidoDeOptOut = (valor: string | null | undefined): boolean => classificarOptOut(valor) === 'pedido'
/** Pedido ou suspeita: quem faz a IA calar e chama a equipe. */
export const ehOptOutProvavel = (valor: string | null | undefined): boolean => classificarOptOut(valor) !== 'nenhum'
