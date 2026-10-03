/**
 * Etiquetas: regras puras (sem banco nem React; testadas em `scripts/testes/lib_test.ts`).
 * O banco (migração 0017) é quem garante o que importa: nome único, limite de 20 por contato, quem pode
 * renomear ou apagar. Aqui só o que a tela decide antes de perguntar.
 */
export type CorEtiqueta = 'accent' | 'info' | 'success' | 'warning' | 'purple' | 'danger'
export const CORES_ETIQUETA: CorEtiqueta[] = ['accent', 'info', 'success', 'warning', 'purple', 'danger']
export const NOME_DA_COR: Record<CorEtiqueta, string> = { accent: 'Turquesa', info: 'Azul', success: 'Verde', warning: 'Âmbar', purple: 'Roxo', danger: 'Vermelho' }

export interface Etiqueta { id: string; nome: string; cor: CorEtiqueta }

/** Espaços repetidos viram um, bordas saem — o mesmo que o banco faz. */
export const normalizarNome = (nome: string): string => nome.replace(/\s+/g, ' ').trim()

const chave = (nome: string) => normalizarNome(nome).toLocaleLowerCase('pt-BR')

/** A etiqueta que já existe com este nome (sem diferenciar caixa nem espaços), ou `undefined`. */
export function acharPorNome(etiquetas: Etiqueta[], nome: string): Etiqueta | undefined {
  const k = chave(nome)
  return k ? etiquetas.find((e) => chave(e.nome) === k) : undefined
}

/** Nome aceito pelo banco: 1 a 30 caracteres depois de normalizar. */
export const nomeValido = (nome: string): boolean => { const n = normalizarNome(nome); return n.length >= 1 && n.length <= 30 }

/** Sugestões ao digitar: as que contêm o termo e o contato ainda não tem, começando-por primeiro. */
export function sugerir(etiquetas: Etiqueta[], termo: string, jaTem: Set<string>): Etiqueta[] {
  const k = chave(termo)
  return etiquetas
    .filter((e) => !jaTem.has(e.id) && (!k || chave(e.nome).includes(k)))
    .sort((a, b) => Number(!chave(a.nome).startsWith(k)) - Number(!chave(b.nome).startsWith(k)) || a.nome.localeCompare(b.nome, 'pt-BR'))
}

/** Contatos que têm TODAS as etiquetas escolhidas (vazio = todos). */
export function contatosComEtiquetas(porContato: Map<string, Set<string>>, escolhidas: string[], contatos: string[]): Set<string> {
  if (!escolhidas.length) return new Set(contatos)
  return new Set(contatos.filter((id) => escolhidas.every((e) => porContato.get(id)?.has(e))))
}
