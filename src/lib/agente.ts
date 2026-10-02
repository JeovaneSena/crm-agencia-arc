import { useSyncExternalStore } from 'react'

/**
 * Como o Agente de IA se chama **dentro do sistema**.
 *
 * ⚠️ ISTO NÃO VALE PARA O WHATSAPP. Aqui a equipe precisa saber, de relance,
 * que quem respondeu foi a IA e não uma colega — por isso o título vem antes do
 * nome. Na conversa com o cliente é o contrário: o prompt proíbe, em regra
 * inegociável, que ela diga ser assistente virtual, inteligência artificial,
 * bot, robô ou sistema.
 *
 * São dois públicos e dois contratos.
 *
 * ── O NOME É DADO; O CARGO É CÓDIGO ────────────────────────────────────────
 *
 * O **nome** vem de `configuracoes_agente.nome_agente` (migração `0019`), e o
 * mesmo valor alimenta o marcador `{{NOME_AGENTE}}` do prompt. Uma fonte, dois
 * leitores — antes eram dois sistemas que não se falavam, e renomear exigia
 * editar os dois torcendo para não esquecer nenhum.
 *
 * O **cargo** ("Secretária IA") e o **nome da página** ("Secretária de IA")
 * continuam constantes de propósito: são o que ela faz e como a tela se chama.
 * Trocar "Assistente" por "Sofia" não deve renomear a página.
 */

/** O que ela é. Só aparece nas telas da equipe. */
export const AGENTE_TITULO = 'Assistente comercial'

/**
 * O nome da PÁGINA dela, no menu do usuário.
 *
 * Repare que aqui tem "de": foi como o produto pediu. `AGENTE_TITULO` é o
 * crachá que vem antes do nome ("Secretária IA · Assistente"); este é o nome da
 * tela. Se um dia os dois tiverem que virar um só, é aqui que se decide.
 */
export const AGENTE_PAGINA = 'Assistente comercial de IA'

/**
 * O nome enquanto o banco não respondeu.
 *
 * Não é "o nome de verdade" — é o que a tela mostra no meio segundo entre
 * abrir e a resposta chegar. Deixar vazio faria a interface piscar frases sem
 * sujeito ("nada chega na ").
 */
export const NOME_PADRAO = 'Assistente'

// ---------------------------------------------------------------------------
// A loja: um valor e quem quer saber quando ele muda
//
// `useSyncExternalStore` em vez de Context porque o nome é lido em treze
// arquivos, alguns deles fora de componente (`conversas.ts`). Um provider
// obrigaria todos a virarem componente; isto atende os dois mundos com o mesmo
// valor.
// ---------------------------------------------------------------------------

let nome = NOME_PADRAO
const ouvintes = new Set<() => void>()

function inscrever(aviso: () => void): () => void {
  ouvintes.add(aviso)
  return () => { ouvintes.delete(aviso) }
}

/** Quem carregou do banco avisa por aqui. Hoje é o `Layout`, uma vez por sessão. */
export function definirNomeDoAgente(novo: string): void {
  const limpo = (novo ?? '').trim()
  if (!limpo || limpo === nome) return
  nome = limpo
  ouvintes.forEach((f) => { f() })
}

/** Para código que não é componente. Em componente, use `useAgente()`. */
export function nomeDoAgente(): string {
  return nome
}

/** `Secretária IA · Assistente`. Para rótulos, não para frases. */
export function rotuloDoAgente(): string {
  return `${AGENTE_TITULO} · ${nome}`
}

/**
 * O nome dela numa tela, que re-renderiza sozinho quando alguém troca.
 *
 * Devolve as três formas porque as três aparecem, e montá-las na mão em cada
 * componente é como surgem "Secretária IA - Assistente" e "Secretaria IA Assistente"
 * na mesma tela.
 */
export function useAgente(): {
  /** Só o nome: `Assistente`. Para frases. */
  nome: string
  /** O cargo: `Secretária IA`. */
  titulo: string
  /** `Secretária IA · Assistente`. Para rótulos e etiquetas. */
  rotulo: string
  /** `Secretária IA Assistente`. Para frases que precisam do cargo junto. */
  porExtenso: string
} {
  const atual = useSyncExternalStore(inscrever, nomeDoAgente, () => NOME_PADRAO)
  return {
    nome: atual,
    titulo: AGENTE_TITULO,
    rotulo: `${AGENTE_TITULO} · ${atual}`,
    porExtenso: `${AGENTE_TITULO} ${atual}`,
  }
}
