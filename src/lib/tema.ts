import { useSyncExternalStore } from 'react'

export type Tema = 'system' | 'light' | 'dark'
const CHAVE = 'crm-base.tema'
const sistema = window.matchMedia('(prefers-color-scheme: dark)')
const ouvintes = new Set<() => void>()
const validar = (valor: string | null): Tema => valor === 'light' || valor === 'dark' ? valor : 'system'
let preferencia = validar(document.documentElement.dataset.preference ?? null)
let persistido = true

function aplicar() {
  const raiz = document.documentElement
  raiz.dataset.preference = preferencia
  raiz.dataset.theme = preferencia === 'system' ? (sistema.matches ? 'dark' : 'light') : preferencia
  raiz.style.colorScheme = raiz.dataset.theme
  ouvintes.forEach(ouvir => ouvir())
}

sistema.addEventListener('change', aplicar)
window.addEventListener('storage', evento => {
  if (evento.key === CHAVE || evento.key === null) {
    preferencia = validar(evento.newValue)
    aplicar()
  }
})

export function definirTema(tema: Tema) {
  preferencia = tema
  try { localStorage.setItem(CHAVE, tema); persistido = true }
  catch { persistido = false }
  aplicar()
}

function assinar(ouvir: () => void) {
  ouvintes.add(ouvir)
  return () => { ouvintes.delete(ouvir) }
}

export function useTema() {
  // A string estável permite notificar todos os seletores sem remontar páginas.
  const estado = useSyncExternalStore(assinar, () => `${preferencia}:${persistido}`)
  return { tema: estado.split(':')[0] as Tema, persistido, definirTema }
}
