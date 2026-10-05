import { rpc } from './db.ts'
import { prepararOrigem } from './captacao.ts'

/** Criação e primeira atribuição na mesma transação, inclusive durante reenvios. */
export async function contatoComOrigem(whatsapp: string, texto: string | null, meta: unknown = null, campos: Record<string, unknown> = {}): Promise<string | null> {
  return await rpc<string>('captacao_contato_whatsapp', {
    p_whatsapp: whatsapp, p_origem: prepararOrigem(texto, meta), p_ia: campos.ia_ligada === true,
  })
}
