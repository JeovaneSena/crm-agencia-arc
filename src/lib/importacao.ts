/**
 * Importar contatos de uma planilha CSV: regras puras (sem banco nem React; testadas em
 * `scripts/testes/lib_test.ts`). O banco (`contatos_importar`, migração 0019) revalida tudo e é quem barra
 * o número repetido; aqui se monta o que vai e se explica, linha a linha, o que ficou de fora.
 *
 * Só CSV, de propósito: ler .xlsx no navegador exigiria uma biblioteca com falha de segurança conhecida
 * (prototype pollution). Excel e Google Planilhas exportam CSV em dois cliques.
 *
 * Ideia adaptada do DeskcommCRM (MIT, © 2026 Rafael Melgaço): `lib/leads/planilha.ts`.
 */
export const LIMITE_DE_LINHAS = 500

/** Lê CSV com aspas, vírgula OU ponto e vírgula (o Excel brasileiro usa o segundo), BOM e quebras CRLF. */
export function lerCSV(texto: string): string[][] {
  const t = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto   // BOM do Excel
  const primeiraLinha = t.split(/\r?\n/, 1)[0] ?? ''
  const sep = (primeiraLinha.match(/;/g)?.length ?? 0) > (primeiraLinha.match(/,/g)?.length ?? 0) ? ';' : ','
  const linhas: string[][] = []
  let campo = '', linha: string[] = [], aspas = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (aspas) {
      if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++ } else aspas = false } else campo += c
    } else if (c === '"') aspas = true
    else if (c === sep) { linha.push(campo); campo = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      linha.push(campo); campo = ''
      if (linha.some((x) => x.trim() !== '')) linhas.push(linha)
      linha = []
    } else campo += c
  }
  linha.push(campo)
  if (linha.some((x) => x.trim() !== '')) linhas.push(linha)
  return linhas.map((l) => l.map((x) => x.trim()))
}

export type Campo = 'nome' | 'whatsapp' | 'empresa' | 'email'
export type MapaDeColunas = Record<Campo, number | null>

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const SINONIMOS: Record<Campo, string[]> = {
  nome: ['nome', 'name', 'cliente', 'contato', 'nome completo'],
  whatsapp: ['whatsapp', 'whats', 'zap', 'telefone', 'celular', 'fone', 'phone', 'tel', 'numero'],
  empresa: ['empresa', 'company', 'razao social', 'organizacao'],
  email: ['email', 'e-mail', 'e mail', 'mail'],
}

/** Adivinha qual coluna é qual pelo título do cabeçalho. A tela deixa a pessoa corrigir. */
export function detectarColunas(cabecalho: string[]): MapaDeColunas {
  const mapa: MapaDeColunas = { nome: null, whatsapp: null, empresa: null, email: null }
  const usadas = new Set<number>()
  for (const campo of Object.keys(SINONIMOS) as Campo[]) {
    const i = cabecalho.findIndex((h, idx) => !usadas.has(idx) && SINONIMOS[campo].includes(semAcento(h)))
    if (i >= 0) { mapa[campo] = i; usadas.add(i) }
  }
  return mapa
}

export type ResultadoDoNumero = { ok: true; numero: string } | { ok: false; motivo: string }

/** Número brasileiro com ou sem 55, com máscara ou não. Sem DDD não dá para saber de quem é: recusa. */
export function normalizarNumero(bruto: string): ResultadoDoNumero {
  let d = bruto.replace(/\D/g, '').replace(/^0+/, '')
  if (!d) return { ok: false, motivo: 'sem telefone' }
  if (d.length === 10 || d.length === 11) d = `55${d}`
  else if (d.length <= 9) return { ok: false, motivo: 'telefone sem DDD' }
  if (d.length < 12 || d.length > 15) return { ok: false, motivo: 'telefone com tamanho inválido' }
  return { ok: true, numero: d }
}

export interface LinhaPronta { nome: string | null; whatsapp: string; empresa: string | null; email: string | null }
export interface ProblemaDeLinha { linha: number; motivo: string }
export interface Preparado { prontas: LinhaPronta[]; problemas: ProblemaDeLinha[]; repetidasNoArquivo: number; excedeLimite: boolean }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * Transforma as linhas do CSV (sem o cabeçalho) no que vai para o banco. `linha` nos problemas é o número que a
 * pessoa vê na planilha (cabeçalho = 1). O mesmo telefone duas vezes no arquivo entra uma vez só.
 */
export function prepararLinhas(linhas: string[][], mapa: MapaDeColunas): Preparado {
  const r: Preparado = { prontas: [], problemas: [], repetidasNoArquivo: 0, excedeLimite: false }
  if (mapa.whatsapp === null) return r
  const vistos = new Set<string>()
  linhas.forEach((l, i) => {
    const n = i + 2
    const num = normalizarNumero(l[mapa.whatsapp!] ?? '')
    if (!num.ok) { r.problemas.push({ linha: n, motivo: num.motivo }); return }
    if (vistos.has(num.numero)) { r.repetidasNoArquivo++; return }
    const email = (mapa.email !== null ? l[mapa.email] ?? '' : '').trim().toLowerCase()
    if (email && !EMAIL.test(email)) { r.problemas.push({ linha: n, motivo: 'e-mail inválido' }); return }
    if (r.prontas.length >= LIMITE_DE_LINHAS) { r.excedeLimite = true; return }
    vistos.add(num.numero)
    const pega = (c: number | null) => (c !== null ? (l[c] ?? '').trim() || null : null)
    r.prontas.push({ nome: pega(mapa.nome), whatsapp: num.numero, empresa: pega(mapa.empresa), email: email || null })
  })
  return r
}
