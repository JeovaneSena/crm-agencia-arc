/**
 * Regras puras da conversa com notas (sem banco nem React; testadas em `scripts/testes/lib_test.ts`).
 */
export interface NotaConversa {
  id: string
  contato_id: string
  texto: string
  autor_id: string | null
  created_at: string
  autor: { nome: string } | null
}

/** Mensagens e notas numa lista só, na ordem do tempo (a nota vem depois da mensagem de mesmo instante). */
export type ItemDaConversa<M extends { criada_em: string; id: string }> =
  | { tipo: 'mensagem'; quando: string; mensagem: M }
  | { tipo: 'nota'; quando: string; nota: NotaConversa }

export function mesclarConversa<M extends { criada_em: string; id: string }>(mensagens: M[], notas: NotaConversa[]): ItemDaConversa<M>[] {
  const itens: ItemDaConversa<M>[] = [
    ...mensagens.map((mensagem) => ({ tipo: 'mensagem' as const, quando: mensagem.criada_em, mensagem })),
    ...notas.map((nota) => ({ tipo: 'nota' as const, quando: nota.created_at, nota })),
  ]
  return itens.sort((a, b) => Date.parse(a.quando) - Date.parse(b.quando) || (a.tipo === b.tipo ? 0 : a.tipo === 'mensagem' ? -1 : 1))
}
