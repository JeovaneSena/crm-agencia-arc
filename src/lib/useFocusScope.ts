import { useEffect, useEffectEvent, type RefObject } from 'react'

const scopes: symbol[] = []
const FOCUSABLE = 'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])'

/** Só o diálogo mais recente recebe Escape/Tab; ao fechar, devolve o foco. */
export function useFocusScope(ref: RefObject<HTMLElement | null>, active: boolean, close: () => void, portal = false) {
  const onClose = useEffectEvent(close)
  useEffect(() => {
    const element = ref.current
    if (!active || !element) return
    const previous = document.activeElement as HTMLElement | null
    const id = Symbol()
    scopes.push(id)
    const siblings = portal ? Array.from(document.body.children).filter((el): el is HTMLElement => el instanceof HTMLElement && !el.contains(element) && (el.id === 'root' || el.classList.contains('modal-portal'))) : []
    const previousInert = siblings.map(el => el.inert)
    siblings.forEach(el => { el.inert = true })
    const controls = () => Array.from(element.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.getClientRects().length && !el.closest('[hidden],[inert]'))
    const first = element.querySelector<HTMLElement>('[data-autofocus]') ?? controls()[0] ?? element
    first.focus({ preventScroll: true })
    const keydown = (event: KeyboardEvent) => {
      if (scopes.at(-1) !== id) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
      if (event.key !== 'Tab') return
      const items = controls()
      const first = items[0] ?? element, last = items.at(-1) ?? element
      if (!items.length || !element.contains(document.activeElement) || (event.shiftKey && (document.activeElement === first || document.activeElement === element)) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      }
    }
    document.addEventListener('keydown', keydown, true)
    return () => {
      document.removeEventListener('keydown', keydown, true)
      scopes.splice(scopes.indexOf(id), 1)
      siblings.forEach((el, index) => { el.inert = previousInert[index] })
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [active, portal, ref])
}
