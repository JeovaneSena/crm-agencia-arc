/**
 * Dinheiro na tela de Procedimentos.
 *
 * ── POR QUE ISTO NÃO MONTA A FRASE DA LETÍCIA ──────────────────────────────
 *
 * Existe a tentação de o card mostrar "ela vai dizer: a partir de R$ 200". Não
 * mostra, de propósito: a frase é montada pela view `view do catálogo do agente`,
 * em SQL, e reimplementá-la aqui criaria duas versões da mesma regra — um dia a
 * tela mostraria uma coisa e o cliente ouviria outra.
 *
 * A prévia da aba Empresa escapa disso porque consulta a view **de verdade**.
 * Aqui, uma consulta por card seria absurda. Então o card mostra o **dado**, não
 * a frase, e a única regra que ele repete é a que dá para ver a olho nu: campo
 * vazio, ela não fala; zero, é gratuita.
 */

import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/** `1500.5` → `"R$ 1.500,50"`. Espelha a função `reais()` do banco. */
export function formatarReais(valor: number): string {
  return valor.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * O que a pessoa digitou vira número — ou `null`, que é um valor de verdade
 * aqui: significa "não fale preço".
 *
 * Aceita os dois jeitos de escrever, porque as duas aparecem: `1.500,50` (como
 * se escreve em português) e `1500.50` (como sai de qualquer teclado numérico).
 * A regra: se tem vírgula, a vírgula é o decimal e os pontos são milhar.
 */
export function lerPreco(texto: string): number | null {
  const limpo = texto.replace(/[^\d.,-]/g, '').trim()
  if (!limpo) return null

  const normalizado = limpo.includes(',')
    ? limpo.replace(/\./g, '').replace(',', '.')
    : limpo

  const n = Number(normalizado)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100) / 100
}

/** O valor como ele entra no campo: `200` → `"200,00"`. Vazio continua vazio. */
export function precoParaCampo(valor: number | null): string {
  if (valor === null || valor === undefined) return ''
  return valor.toFixed(2).replace('.', ',')
}

// ---------------------------------------------------------------------------
// O catálogo, para os campos que precisam dele
// ---------------------------------------------------------------------------

/**
 * Os procedimentos ativos, em ordem, para preencher lista e caixas de seleção.
 *
 * ── POR QUE O CAMPO DEIXOU DE SER TEXTO LIVRE ──────────────────────────────
 *
 * Porque texto livre não soma. "Lentes de Contato", "lente de contato" e
 * "lente pro dente" são a mesma coisa para quem digitou e três linhas
 * diferentes num relatório — e a pergunta que a empresa faz ("qual o
 * procedimento mais procurado?") passa a não ter resposta, sem que nada avise.
 *
 * O banco trava por baixo (migrações `0022` e `0023`), e o assistente escolhe de
 * uma lista fechada. Isto aqui é a mesma trava do lado de quem digita: ela
 * existe para o erro **não ser possível**, e não para ser corrigido depois.
 *
 * ⚠️ Vem do banco a cada montagem, e não de uma lista no código: cadastrar um
 * procedimento novo em Procedimentos precisa valer nas outras telas na hora,
 * sem publicar nada.
 */
export function useCatalogoProcedimentos(): string[] {
  const [nomes, setNomes] = useState<string[]>([])

  useEffect(() => {
    let vivo = true
    void supabase
      .from('catalogo_servicos')
      .select('nome')
      .eq('ativo', true)
      .order('nome')
      .then(({ data }) => {
        if (vivo && data) setNomes(data.map((s) => s.nome as string))
      })
    return () => { vivo = false }
  }, [])

  return nomes
}
