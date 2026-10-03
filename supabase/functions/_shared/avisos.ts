/**
 * Abrir e fechar avisos na Central (tabela `avisos`, migração 0011).
 *
 * Recebe o `rpc` por parâmetro, como o resto de `_shared`, para ser testado sem rede.
 *
 * ⚠️ NUNCA LANÇA. Um aviso é a rede de proteção do fluxo principal; se ele falhar, o
 * envio, o webhook ou a rodada do trabalhador que o chamou não pode cair junto. O erro
 * vai para o log. As chamadas são seguras de repetir: o banco guarda um aviso aberto por
 * (tipo, chave) e só conta a recorrência.
 *
 * Ideia adaptada do DeskcommCRM (MIT, © 2026 Rafael Melgaço): Central de avisos.
 */
export type Gravidade = 'info' | 'atencao' | 'critico'
export type Rpc = <T>(nome: string, args: Record<string, unknown>) => Promise<T>

export interface NovoAviso {
  /** Minúsculas, números e `_`; 3 a 41 caracteres. Ex.: `conexao_caida`. */
  tipo: string
  /** Distingue problemas do mesmo tipo (um contato, um número). Vazio = um só por tipo. */
  chave?: string
  gravidade: Gravidade
  titulo: string
  detalhe?: string | null
  /** Caminho interno do app, como `/conversas`. Qualquer outra coisa é descartada. */
  rota?: string | null
  contatoId?: string | null
  /** Credencial, conexão: o consultor não vê. */
  somenteGestor?: boolean
  /** Quanto tempo uma dispensa da equipe silencia o mesmo aviso. Padrão do banco: 6 h. */
  silencioHoras?: number
}

const TIPO = /^[a-z][a-z0-9_]{2,40}$/
const ROTA = /^\/(?!\/)[A-Za-z0-9/_?=&.%-]*$/

const cortar = (texto: string, max: number) => texto.length <= max ? texto : `${texto.slice(0, max - 1).trimEnd()}…`

/** Os argumentos da função SQL, já dentro dos limites das CHECKs. */
export function argumentosDoAviso(a: NovoAviso): Record<string, unknown> {
  if (!TIPO.test(a.tipo)) throw new Error(`tipo de aviso inválido: ${a.tipo}`)
  const titulo = cortar(a.titulo.trim(), 120)
  if (!titulo) throw new Error('aviso sem título')
  const detalhe = a.detalhe?.trim()
  const rota = a.rota && a.rota.length <= 200 && ROTA.test(a.rota) ? a.rota : null
  const args: Record<string, unknown> = {
    p_tipo: a.tipo,
    p_chave: cortar(a.chave ?? '', 120),
    p_gravidade: a.gravidade,
    p_titulo: titulo,
    p_detalhe: detalhe ? cortar(detalhe, 500) : null,
    p_rota: rota,
    p_contato_id: a.contatoId ?? null,
    p_somente_gestor: a.somenteGestor ?? false,
  }
  if (a.silencioHoras !== undefined) args.p_silencio_horas = a.silencioHoras
  return args
}

/** Abre (ou atualiza) o aviso. Devolve o id, ou `null` se a equipe o dispensou há pouco ou se falhou. */
export async function abrirAviso(rpc: Rpc, aviso: NovoAviso): Promise<string | null> {
  try {
    return (await rpc<string | null>('aviso_abrir', argumentosDoAviso(aviso))) ?? null
  } catch (e) {
    console.error('aviso: não consegui abrir', aviso.tipo, e instanceof Error ? e.message : e)
    return null
  }
}

/** A causa sumiu. Sem `chave`, fecha todos os abertos do tipo. Devolve quantos fechou. */
export async function resolverAviso(rpc: Rpc, tipo: string, chave?: string): Promise<number> {
  try {
    return (await rpc<number>('aviso_resolver_auto', { p_tipo: tipo, p_chave: chave ?? null })) ?? 0
  } catch (e) {
    console.error('aviso: não consegui resolver', tipo, e instanceof Error ? e.message : e)
    return 0
  }
}

/**
 * Fecha os avisos abertos do tipo cuja chave NÃO está na lista: quem ainda tem o problema continua com o aviso,
 * quem não tem mais, perde. Lista vazia fecha todos do tipo. Devolve quantos fechou.
 */
export async function resolverAvisosExceto(rpc: Rpc, tipo: string, chavesQueContinuam: string[]): Promise<number> {
  try {
    return (await rpc<number>('aviso_resolver_exceto', { p_tipo: tipo, p_chaves: chavesQueContinuam })) ?? 0
  } catch (e) {
    console.error('aviso: não consegui resolver o resto', tipo, e instanceof Error ? e.message : e)
    return 0
  }
}
