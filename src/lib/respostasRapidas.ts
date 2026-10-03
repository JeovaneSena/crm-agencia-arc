/**
 * Respostas rápidas: textos prontos que a equipe insere na conversa (tabela `respostas_rapidas`, 0013).
 *
 * Regras puras (sem banco nem React), testadas em `scripts/testes/lib_test.ts`:
 *  - `{{nome}}` e `{{primeiro_nome}}` são preenchidos com o contato da conversa;
 *  - uma variável sem valor FICA como está ("{{nome}}"), nunca vira texto quebrado ou vazio, e a tela
 *    recusa o envio enquanto sobrar uma: sairia para o cliente com as chaves à mostra;
 *  - digitar `/atalho` e enviar expande o texto em vez de mandá-lo; inserir NUNCA envia.
 *
 * Ideia adaptada do DeskcommCRM (MIT, © 2026 Rafael Melgaço): `lib/inbox/template-vars.ts`.
 */
export interface RespostaRapida {
  id: string
  titulo: string
  texto: string
  atalho: string | null
  /** `null` = da equipe. */
  dono_id: string | null
}

const VARIAVEL = /\{\{\s*([a-z_]+)\s*\}\}/gi
const ATALHO = /^\/([a-z0-9_-]{0,20})$/

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Preenche as variáveis que o contato permite. As outras ficam literais. */
export function preencher(texto: string, contato: { nome?: string | null }): string {
  const nome = contato.nome?.trim() ?? ''
  const valores: Record<string, string> = nome ? { nome, primeiro_nome: nome.split(/\s+/)[0] } : {}
  return texto.replace(VARIAVEL, (inteiro, chave: string) => valores[chave.toLowerCase()] ?? inteiro)
}

/** As variáveis que sobraram no texto (ex.: `{{nome}}`), sem repetir. Vazio = pode enviar. */
export function variaveisPendentes(texto: string): string[] {
  return [...new Set([...texto.matchAll(VARIAVEL)].map((m) => `{{${m[1].toLowerCase()}}}`))]
}

/** `/ola` → `ola`; `/` → `` (lista tudo); qualquer outra coisa → `null`. */
export function atalhoDigitado(texto: string): string | null {
  const m = ATALHO.exec(texto.trim())
  return m ? m[1] : null
}

/**
 * Filtra por título, atalho ou texto, sem acento nem caixa. Quem tem o atalho igual vem primeiro, depois
 * o atalho que começa com o termo; empate: da equipe antes das pessoais, depois por título.
 */
export function filtrar(respostas: RespostaRapida[], termo: string): RespostaRapida[] {
  const t = semAcento(termo.trim().replace(/^\//, ''))
  const peso = (r: RespostaRapida) => (r.atalho === t ? 0 : r.atalho?.startsWith(t) && t ? 1 : 2)
  return respostas
    .filter((r) => !t || semAcento(r.titulo).includes(t) || r.atalho?.includes(t) || semAcento(r.texto).includes(t))
    .sort((a, b) => peso(a) - peso(b) || Number(a.dono_id !== null) - Number(b.dono_id !== null) || a.titulo.localeCompare(b.titulo, 'pt-BR'))
}

/**
 * Se o texto é exatamente `/atalho` de uma resposta, devolve o texto dela já preenchido; senão `null`
 * (e a mensagem segue o caminho normal). Atalho de duas famílias: a pessoal vence a da equipe.
 */
export function expandirAtalho(texto: string, respostas: RespostaRapida[], contato: { nome?: string | null }): string | null {
  const a = atalhoDigitado(texto)
  if (!a) return null
  const achadas = respostas.filter((r) => r.atalho === a)
  const escolhida = achadas.find((r) => r.dono_id !== null) ?? achadas[0]
  return escolhida ? preencher(escolhida.texto, contato) : null
}
