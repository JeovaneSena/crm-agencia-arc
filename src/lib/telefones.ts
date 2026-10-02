/**
 * Telefones — países atendidos, contagem de dígitos e formatação.
 *
 * FORMATO CANÔNICO: o `whatsapp` é gravado sempre como **só dígitos, com
 * o código do país e sem nada mais** — `5511987654321`. É exatamente o formato
 * que o n8n já grava ao criar o lead da conversa do WhatsApp.
 *
 * Isso não é preciosismo. Se a tela gravasse `+55 (11) 98765-4321` e o agente
 * gravasse `5511987654321`, o mesmo telefone viraria dois textos diferentes: a
 * busca do agendamento não acharia o contato criado pelo agente, a recepção
 * cadastraria a pessoa de novo, e o índice único do banco deixaria passar —
 * porque para o Postgres são strings distintas.
 *
 * A lista de países é curta de propósito. Cobrir "todos" com regra escrita à
 * mão é uma promessa impossível de manter; estes dez são os que a empresa
 * atende. Acrescentar outro é acrescentar um item aqui.
 */

export interface Pais {
  iso: string
  nome: string
  /** Código do país, só dígitos, sem o `+`. */
  ddi: string
  bandeira: string
  /** Quantidades aceitas de dígitos do número nacional (sem o DDI). */
  tamanhos: number[]
  exemplo: string
  /** Formata o número nacional para leitura. Recebe só dígitos. */
  formatar: (digitos: string) => string
  /** Observação exibida abaixo do campo, quando o país tem pegadinha. */
  dica?: string
}

/** Agrupa dígitos em blocos: emGrupos('912345678', [3,3,3]) → '912 345 678'. */
function emGrupos(digitos: string, grupos: number[], separador = ' '): string {
  const partes: string[] = []
  let i = 0
  for (const tamanho of grupos) {
    if (i >= digitos.length) break
    partes.push(digitos.slice(i, i + tamanho))
    i += tamanho
  }
  if (i < digitos.length) partes.push(digitos.slice(i))
  return partes.join(separador)
}

/** (11) 98765-4321 — celular com 9 dígitos ou fixo com 8. */
function formatarBrasil(d: string): string {
  if (d.length <= 2) return d
  const ddd = d.slice(0, 2)
  const resto = d.slice(2)
  if (resto.length <= 4) return `(${ddd}) ${resto}`
  const corte = resto.length >= 9 ? 5 : 4
  return `(${ddd}) ${resto.slice(0, corte)}-${resto.slice(corte)}`
}

/** (415) 555-0123 — Plano de Numeração Norte-Americano (EUA e Canadá). */
function formatarNanp(d: string): string {
  if (d.length <= 3) return d
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
}

/** 9 11 2345-6789 — o 9 inicial é o que o WhatsApp exige nos celulares. */
function formatarArgentina(d: string): string {
  if (d.length === 11 && d.startsWith('9')) {
    const resto = d.slice(1)
    return `9 ${resto.slice(0, 2)} ${resto.slice(2, 6)}-${resto.slice(6)}`
  }
  if (d.length <= 2) return d
  return `${d.slice(0, 2)} ${emGrupos(d.slice(2), [4], '-')}`
}

export const PAISES: Pais[] = [
  {
    iso: 'BR', nome: 'Brasil', ddi: '55', bandeira: '🇧🇷',
    tamanhos: [10, 11], exemplo: '(11) 98765-4321',
    formatar: formatarBrasil,
    dica: 'Digite o DDD e o número com WhatsApp.',
  },
  {
    iso: 'PT', nome: 'Portugal', ddi: '351', bandeira: '🇵🇹',
    tamanhos: [9], exemplo: '912 345 678',
    formatar: (d) => emGrupos(d, [3, 3, 3]),
  },
  {
    iso: 'US', nome: 'Estados Unidos', ddi: '1', bandeira: '🇺🇸',
    tamanhos: [10], exemplo: '(415) 555-0123',
    formatar: formatarNanp,
    dica: 'Estados Unidos e Canadá dividem o código +1.',
  },
  {
    iso: 'CA', nome: 'Canadá', ddi: '1', bandeira: '🇨🇦',
    tamanhos: [10], exemplo: '(416) 555-0123',
    formatar: formatarNanp,
    dica: 'Canadá e Estados Unidos dividem o código +1.',
  },
  {
    iso: 'AR', nome: 'Argentina', ddi: '54', bandeira: '🇦🇷',
    tamanhos: [10, 11], exemplo: '9 11 2345-6789',
    formatar: formatarArgentina,
    dica: 'Para WhatsApp, celulares argentinos levam um 9 antes do código de área (11 dígitos).',
  },
  {
    iso: 'CO', nome: 'Colômbia', ddi: '57', bandeira: '🇨🇴',
    tamanhos: [10], exemplo: '300 123 4567',
    formatar: (d) => emGrupos(d, [3, 3, 4]),
  },
  {
    iso: 'ES', nome: 'Espanha', ddi: '34', bandeira: '🇪🇸',
    tamanhos: [9], exemplo: '612 345 678',
    formatar: (d) => emGrupos(d, [3, 3, 3]),
  },
  {
    iso: 'FR', nome: 'França', ddi: '33', bandeira: '🇫🇷',
    tamanhos: [9], exemplo: '6 12 34 56 78',
    formatar: (d) => emGrupos(d, [1, 2, 2, 2, 2]),
  },
  {
    iso: 'AO', nome: 'Angola', ddi: '244', bandeira: '🇦🇴',
    tamanhos: [9], exemplo: '923 456 789',
    formatar: (d) => emGrupos(d, [3, 3, 3]),
  },
  {
    iso: 'AU', nome: 'Austrália', ddi: '61', bandeira: '🇦🇺',
    tamanhos: [9], exemplo: '412 345 678',
    formatar: (d) => emGrupos(d, [3, 3, 3]),
  },
]

export const PAIS_PADRAO = 'BR'

export function paisPorIso(iso: string): Pais {
  return PAISES.find((p) => p.iso === iso) ?? PAISES[0]
}

export function apenasDigitos(valor: string): string {
  return (valor ?? '').replace(/\D/g, '')
}

export function maiorTamanho(pais: Pais): number {
  return Math.max(...pais.tamanhos)
}

/** "10 ou 11 dígitos" — usado nas mensagens de erro e na dica do campo. */
export function descricaoTamanhos(pais: Pais): string {
  return pais.tamanhos.length === 1
    ? `${pais.tamanhos[0]} dígitos`
    : `${pais.tamanhos.slice(0, -1).join(', ')} ou ${pais.tamanhos[pais.tamanhos.length - 1]} dígitos`
}

/**
 * Valida o número nacional. Devolve a mensagem de erro, ou null se estiver bom.
 * É esta função que cumpre o "bloqueio de quantidade de números": cada país tem
 * a sua contagem, e nada fora dela é aceito.
 */
export function validarNacional(pais: Pais, nacional: string): string | null {
  const d = apenasDigitos(nacional)
  if (d.length === 0) return 'Informe o número.'
  if (!pais.tamanhos.includes(d.length)) {
    return `Número de ${pais.nome} tem ${descricaoTamanhos(pais)} (sem o +${pais.ddi}). Você digitou ${d.length}.`
  }
  return null
}

/** Junta país e número no formato que vai para o banco. */
export function paraCanonico(pais: Pais, nacional: string): string {
  return pais.ddi + apenasDigitos(nacional)
}

/**
 * Caminho inverso: descobre o país de um número já gravado.
 *
 * Testa os DDIs do mais longo para o mais curto (senão o `1` dos EUA casaria
 * com qualquer coisa) e só aceita quando o que sobra tem um tamanho válido
 * daquele país. Com EUA e Canadá dividindo o +1 não há como distinguir pelo
 * número — vence o primeiro da lista, e isso não afeta nada além do rótulo.
 */
export function separarCanonico(canonico: string): { pais: Pais; nacional: string } | null {
  const d = apenasDigitos(canonico)
  if (!d) return null
  const porDdiDesc = [...PAISES].sort((a, b) => b.ddi.length - a.ddi.length)

  for (const pais of porDdiDesc) {
    if (!d.startsWith(pais.ddi)) continue
    const nacional = d.slice(pais.ddi.length)
    if (pais.tamanhos.includes(nacional.length)) return { pais, nacional }
  }
  return null
}

/**
 * Número gravado → texto legível: '5511987654321' → '+55 (11) 98765-4321'.
 * Devolve o valor original quando não reconhece o formato, para nunca esconder
 * da equipe um dado que está no banco.
 */
export function formatarParaExibicao(canonico: string | null | undefined): string {
  if (!canonico) return ''
  const separado = separarCanonico(canonico)
  if (!separado) return canonico
  return `+${separado.pais.ddi} ${separado.pais.formatar(separado.nacional)}`
}
