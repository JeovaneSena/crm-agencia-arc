import { useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useFocusScope } from '../lib/useFocusScope'

/**
 * Joga o modal para fora da árvore da página, direto no `<body>`.
 *
 * POR QUE ISSO É NECESSÁRIO — e não é preciosismo:
 *
 * `position: fixed` promete "em relação à janela". A promessa se quebra quando
 * QUALQUER ancestral tem `transform`: o elemento transformado vira o novo
 * referencial, e o modal passa a se centralizar dentro dele.
 *
 * As classes `fade-in-*` do [`index.css`](../index.css) animam com
 * `translateY` e `forwards` — o que deixa `transform: translateY(0)` gravado
 * no elemento depois da animação. Não é `none`, então o referencial fica de pé
 * para sempre.
 *
 * Em Configurações isso é visível: o conteúdo da aba mora dentro de um
 * `fade-in-3` alto (a lista de 20 procedimentos), e o modal ia se centralizar
 * no meio DAQUELA lista — aparecendo lá embaixo, metade fora da tela.
 *
 * O portal resolve na raiz: sem ancestral transformado, `fixed` volta a
 * significar o que diz. **Todo modal novo deve nascer dentro dele.**
 */
export default function ModalPortal({ children, label, onClose, busy = false }: { children: ReactNode; label: string; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useFocusScope(ref, true, () => { if (!busy) onClose() }, true)
  return createPortal(<div ref={ref} className="modal-portal" role="dialog" aria-modal="true" aria-label={label} aria-busy={busy} tabIndex={-1}
    onClickCapture={event => { if (busy) { event.preventDefault(); event.stopPropagation() } }}>
    {children}
  </div>, document.body)
}
