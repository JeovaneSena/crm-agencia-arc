import { Moon, Sun } from 'lucide-react'
import { useTema } from '../lib/tema'

export default function SeletorTema({ compacto = false }: { compacto?: boolean }) {
  const { definirTema, persistido } = useTema()
  const escuro = document.documentElement.dataset.theme === 'dark'
  const Icone = escuro ? Moon : Sun
  return <div className={`theme-control${compacto ? ' theme-compact' : ''}`}>
    <button type="button" className="theme-toggle" aria-label={escuro ? 'Ativar modo claro' : 'Ativar modo escuro'} title={escuro ? 'Modo escuro. Ativar modo claro' : 'Modo claro. Ativar modo escuro'} onClick={() => definirTema(escuro ? 'light' : 'dark')}>
      <Icone size={19} aria-hidden="true" />
    </button>
    {!persistido && <span className="sr-only" role="status">Preferência válida nesta sessão.</span>}
  </div>
}
