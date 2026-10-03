/**
 * Gancho entre o módulo CONVERSAS e os módulos que reagem a mensagem recebida.
 *
 * Aqui é o vazio: sem módulo extra, receber mensagem só grava. Uma instalação com o
 * módulo `assistente` recebe, no lugar deste arquivo, o conteúdo de `gancho_assistente.ts`
 * (o gerador faz a troca). Assim a função `whatsapp` é uma só e não carrega código de
 * módulo que a instalação não ligou.
 */
export interface MensagemGravada {
  contatoId: string
  mensagemId: string
  whatsapp: string
  tipo: string
  texto: string | null
}

/** Campos extras de um contato criado agora pelo webhook. */
export function camposDoContatoNovo(): Promise<Record<string, unknown>> {
  return Promise.resolve({})
}

/** Chamado depois de gravar uma mensagem NOVA do cliente. Não pode lançar nem demorar o webhook. */
export function aposReceber(m: MensagemGravada): Promise<void> {
  void m
  return Promise.resolve()
}

/** Rascunho de resposta para a equipe revisar. Só o módulo assistente sabe fazer; aqui, indisponível. */
export type ResultadoRascunho = { ok: true; texto: string } | { ok: false; motivo: string }
export function rascunhoDaIA(contatoId: string): Promise<ResultadoRascunho> {
  void contatoId
  return Promise.resolve({ ok: false, motivo: 'indisponivel' })
}
