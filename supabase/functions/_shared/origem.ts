/** Gancho vazio para instalações sem captação. O gerador troca por origem_captacao.ts. */
export async function contatoComOrigem(whatsapp: string, texto: string | null, meta: unknown = null, campos: Record<string, unknown> = {}): Promise<string | null> {
  void whatsapp; void texto; void meta; void campos
  return null
}
