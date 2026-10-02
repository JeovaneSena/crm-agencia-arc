/**
 * As regras da senha, num lugar só.
 *
 * A regra do CRM é mais exigente que a configuração atual do Supabase Auth:
 * a tela pede 10 caracteres, tipos variados e força Forte; o servidor aceita
 * a partir de 6 caracteres sem exigir tipos específicos. Por isso todos os
 * critérios da tela precisam aparecer claramente antes do botão de salvar.
 * O Supabase continua sendo a última validação de `updateUser`.
 *
 * Este arquivo nasceu quando a tela de definir senha do convite seria a
 * terceira cópia das mesmas cinco linhas.
 */

export const SENHA_MINIMO = 10

/**
 * O que o Supabase conta como símbolo — copiado do preset dele, à risca.
 *
 * `/[^A-Za-z0-9]/` seria mais curto e estaria **errado**: acento é "não
 * alfanumérico" para essa expressão, então `Josué12345` passaria aqui e seria
 * recusado lá, sem que a tela soubesse dizer por quê.
 */
export const SIMBOLOS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~"

export const REGRAS_SENHA: { rotulo: string; ok: (senha: string) => boolean }[] = [
  { rotulo: `Pelo menos ${SENHA_MINIMO} caracteres`, ok: (s) => s.length >= SENHA_MINIMO },
  { rotulo: 'Uma letra minúscula', ok: (s) => /[a-z]/.test(s) },
  { rotulo: 'Uma letra maiúscula', ok: (s) => /[A-Z]/.test(s) },
  { rotulo: 'Um número', ok: (s) => /[0-9]/.test(s) },
  { rotulo: 'Um símbolo (!, @, #…)', ok: (s) => [...s].some((c) => SIMBOLOS.includes(c)) },
]

export const FORCA_ROTULOS = ['Muito fraca', 'Fraca', 'Razoável', 'Forte', 'Muito forte']
export const FORCA_CORES = ['var(--danger)', 'var(--warning)', 'var(--warning)', 'var(--success)', 'var(--success)']

/** Nota mínima do zxcvbn aceita pelas duas telas. */
export const FORCA_MINIMA = 3
