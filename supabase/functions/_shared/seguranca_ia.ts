/** Adaptado de DeskcommCRM (MIT, Rafael Melgaço): human-handoff, human-promise,
 * vazamento-interno e atraso-humano. Detectores conservadores; nunca usam outro modelo. */
const normalizar = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
export const AVISO_EQUIPE = 'Encaminhei sua conversa para a equipe. Uma pessoa vai continuar o atendimento por aqui.'
export function passagemDireta(texto: string): 'pedido_pessoa' | 'juridico' | null {
 const t=normalizar(texto)
 if (/\b(procon|advogad[oa]|processo judicial|acao judicial|notificacao extrajudicial|vou processar)\b/.test(t)) return 'juridico'
 if (/\b(?:falar|conversar)\s+com\s+(?:um[a]?\s+|o |a )?(?:atendente|humano|pessoa|consultor|responsavel)\b|\batendimento humano\b|\b(?:quero|prefiro)\s+(?:um[a]?\s+|o |a )(?:atendente|humano|pessoa)\b|\b(?:me )?(?:passa|passe|transfere|transfira|encaminhe)\s+(?:pra|para|pro)\s+(?:um[a]?\s+|o |a )?(?:atendente|humano|pessoa|consultor)\b/.test(t)) return 'pedido_pessoa'
 return null
}
export type BloqueioIA = 'vocabulario_interno' | 'preco_fora_catalogo' | 'promessa_equipe' | 'juridico'
export function verificarResposta(texto: string, precos: number[], encaminhou=false): BloqueioIA | null {
 const t=normalizar(texto)
 if (/\b(consultar_servicos|consultar_horarios|chamar_equipe|contatos_dados|assistente_respostas|service_role|postgreserror|sqlstate|stack trace|permission denied|OPENAI_API_KEY|ANTHROPIC_API_KEY)\b/i.test(texto) || /\b(?:erro|error)\s*(?:http\s*)?(?:401|403|429|500|503)\b/.test(t)) return 'vocabulario_interno'
 if (/\b(procon|advogad[oa]|processo judicial|acao judicial)\b/.test(t)) return 'juridico'
 if (!encaminhou && /\b(?:(?:a |nossa )?equipe|um atendente|uma pessoa|o consultor)\s+(?:vai|ira|entrara|retornara|ligara)|\b(?:encaminhei|transferi|passei sua conversa|chamei a equipe)|\bvou\s+(?:te |lhe )?(?:encaminhar|transferir|chamar a equipe)\b/.test(t)) return 'promessa_equipe'
 const valores=[...t.matchAll(/(?:R\$\s*|\bBRL\s*|\b(?:custa|preco(?: e| de)?|valor(?: e| de)?)\s+)(\d[\d.]*[,.]?\d*)|(\d[\d.]*[,.]?\d*)\s*reais\b/gi)].map(m=>{
  const v=m[1]??m[2]; return Number(v.includes(',') ? v.replace(/\./g,'').replace(',','.') : /^\d{1,3}(\.\d{3})+$/.test(v) ? v.replace(/\./g,'') : v)
 })
 if (valores.some(v=>!Number.isFinite(v)||!precos.some(p=>Math.abs(p-v)<0.005))) return 'preco_fora_catalogo'
 // Valores por extenso, descontos e parcelas não podem contornar o catálogo.
 if (/\b(?:R\$\s*[a-z]|desconto de|\d+\s*%\s*(?:de desconto|off)|(?:cem|mil|duzentos|trezentos|quinhentos|vinte|trinta|cinquenta) reais|\d+\s*x\s*(?:de\s*)?(?:R\$)?\s*\d)/i.test(texto)) return 'preco_fora_catalogo'
 return null
}
export function esperaProporcional(texto: string, decorridoMs: number): number {
 return Math.max(0, Math.min(7500, Math.max(1200,900+22*texto.length))-Math.max(0,decorridoMs))
}
