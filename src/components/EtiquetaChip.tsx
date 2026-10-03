import { X } from 'lucide-react'
import type { Etiqueta } from '../lib/etiquetasRegras'

/** A etiqueta como um selo colorido. Com `onRemover`, ganha o ✕. */
export default function EtiquetaChip({ etiqueta, onRemover }: { etiqueta: Etiqueta; onRemover?: () => void }) {
  return <span className="tag-chip" style={{ background: `var(--${etiqueta.cor}-soft)`, color: `var(--${etiqueta.cor})` }}>
    {etiqueta.nome}
    {onRemover && <button type="button" aria-label={`Tirar a etiqueta ${etiqueta.nome}`} onClick={onRemover}><X size={11} /></button>}
  </span>
}
