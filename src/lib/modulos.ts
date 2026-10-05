/**
 * Módulos opcionais da instalação.
 *
 * O núcleo (contatos, oportunidades, funil, agenda, dashboard, equipe, serviços,
 * usuários) sempre existe. O resto só aparece se a instalação o ligar, pela
 * variável de build `VITE_MODULOS` — lista separada por vírgula. Vazia = só o
 * núcleo. Ex.: `VITE_MODULOS=conversas,campanhas,projetos`.
 *
 * Desligar um módulo aqui só esconde a tela. Quem impede o uso de verdade é o
 * banco: as tabelas do módulo nem existem numa instalação que não as aplicou.
 */
export type Modulo = 'conversas' | 'campanhas' | 'assistente' | 'projetos' | 'captacao'

const ATIVOS = new Set(
  String(import.meta.env.VITE_MODULOS ?? '').split(',').map(m => m.trim()).filter(Boolean),
)

export const moduloAtivo = (modulo: Modulo): boolean => ATIVOS.has(modulo)
