/**
 * Paleta dos profissionais — a cor com que cada profissional aparece na agenda.
 *
 * ATENÇÃO: isto NÃO é identidade visual. É dado, como as cores de status do
 * funil: serve para distinguir uma agenda da outra num calendário com várias
 * sobrepostas. Trocar a marca não deve trocar isto.
 *
 * A lista é fixa de propósito. Um seletor de cor livre garante que, mais cedo
 * ou mais tarde, alguém escolha amarelo-limão e o bloco suma no fundo branco —
 * ou dois profissionais fiquem com azuis indistinguíveis. Estas dez foram
 * escolhidas por serem separáveis entre si e legíveis com texto branco.
 *
 * O banco aceita qualquer hex válido (CHECK em `profissionais.cor`), então
 * ampliar a paleta aqui não exige migração.
 */

export interface CorProfissional {
  nome: string
  /** Cor sólida: bloco da agenda, ponto do filtro, borda. */
  hex: string
  /** Versão suave: pílula do mês, realce de fundo. */
  fundo: string
}

export const PALETA_PROFISSIONAIS: CorProfissional[] = [
  { nome: 'Azul Clínico', hex: '#1E6E8C', fundo: '#EAF3F6' },
  { nome: 'Índigo',       hex: '#4F46E5', fundo: '#EEF2FF' },
  { nome: 'Violeta',      hex: '#7C3AED', fundo: '#F3E8FF' },
  { nome: 'Rosa',         hex: '#DB2777', fundo: '#FCE7F3' },
  { nome: 'Carmim',       hex: '#BE123C', fundo: '#FFE4E6' },
  { nome: 'Laranja',      hex: '#EA580C', fundo: '#FFF1E7' },
  { nome: 'Âmbar',        hex: '#B45309', fundo: '#FFFBEB' },
  { nome: 'Verde',        hex: '#1A7A48', fundo: '#E8F8EF' },
  { nome: 'Turquesa',     hex: '#0D9488', fundo: '#E6FAF7' },
  { nome: 'Grafite',      hex: '#475569', fundo: '#EEF2F6' },
]

/** Cor das consultas ainda sem profissional definido. */
export const COR_SEM_PROFISSIONAL: CorProfissional = {
  nome: 'Sem profissional',
  hex: '#6B818C',
  fundo: '#F2F6F7',
}

/**
 * Fundo suave correspondente a uma cor sólida.
 *
 * Cai no `hex + '1A'` (10% de opacidade) quando a cor não está na paleta —
 * caso de dado antigo ou de alguém que gravou direto no banco. Sem esse
 * fallback, uma cor fora da lista quebraria o visual da tela inteira.
 */
export function fundoSuave(hex: string): string {
  const daPaleta = PALETA_PROFISSIONAIS.find((c) => c.hex.toLowerCase() === hex.toLowerCase())
  return daPaleta ? daPaleta.fundo : `${hex}1A`
}

/**
 * Sugere a próxima cor livre ao cadastrar um profissional, para dois profissionais
 * não nascerem com a mesma cor por descuido. Se a paleta esgotar, repete a
 * primeira — dez profissionais com cor única já é bem mais do que o cenário
 * previsto.
 */
export function proximaCorLivre(coresEmUso: string[]): string {
  const usadas = coresEmUso.map((c) => c.toLowerCase())
  const livre = PALETA_PROFISSIONAIS.find((c) => !usadas.includes(c.hex.toLowerCase()))
  return (livre ?? PALETA_PROFISSIONAIS[0]).hex
}
