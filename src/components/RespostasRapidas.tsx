import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Settings2, Zap } from 'lucide-react'
import { filtrar, type RespostaRapida } from '../lib/respostasRapidas'
import { useFocusScope } from '../lib/useFocusScope'

/**
 * A lista sai por um portal no <body>, com posição fixa: o compositor tem `overflow` próprio e cortaria
 * uma lista que abre para cima (mesmo motivo de `ModalPortal`).
 *
 * O botão do raio ao lado da caixa de texto: abre a lista de respostas prontas, com busca. Escolher uma
 * só COLOCA o texto na caixa — quem envia é a pessoa, depois de ler.
 */
export default function RespostasRapidas({ respostas, onEscolher, onGerenciar, desabilitado }: {
  respostas: RespostaRapida[]
  onEscolher: (r: RespostaRapida) => void
  onGerenciar: () => void
  desabilitado?: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const [posicao, setPosicao] = useState<{ left: number; bottom: number } | null>(null)
  const botao = useRef<HTMLButtonElement | null>(null)
  const caixa = useRef<HTMLDivElement | null>(null)
  useFocusScope(caixa, aberto, () => setAberto(false))
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node
      if (caixa.current && !caixa.current.contains(alvo) && !botao.current?.contains(alvo)) setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [aberto])

  const lista = filtrar(respostas, busca)
  function alternar() {
    const r = botao.current?.getBoundingClientRect()
    if (r) setPosicao({ left: Math.max(8, Math.min(r.left, window.innerWidth - 392)), bottom: window.innerHeight - r.top + 8 })
    setAberto((v) => !v); setBusca('')
  }
  return <div className="rr-caixa">
    <button ref={botao} type="button" className="rr-botao" aria-label="Respostas rápidas" aria-expanded={aberto} title="Respostas rápidas" disabled={desabilitado} onClick={alternar}><Zap size={17} /></button>
    {aberto && posicao && createPortal(<div ref={caixa} className="rr-popover" role="dialog" aria-label="Respostas rápidas" style={{ left: posicao.left, bottom: posicao.bottom }}>
      <input className="arc-field" autoFocus aria-label="Buscar resposta" placeholder="Buscar por título, atalho ou texto" value={busca} onChange={(e) => setBusca(e.target.value)} />
      <ul className="rr-lista">
        {lista.map((r) => <li key={r.id}><button type="button" onClick={() => { onEscolher(r); setAberto(false) }}>
          <strong>{r.titulo}</strong>{r.atalho && <code>/{r.atalho}</code>}{r.dono_id === null && <small>equipe</small>}
          <span>{r.texto}</span>
        </button></li>)}
        {lista.length === 0 && <li className="rr-vazio">{respostas.length ? 'Nenhuma resposta combina com a busca.' : 'Ainda não há respostas. Crie a primeira em "Gerenciar".'}</li>}
      </ul>
      <button type="button" className="rr-gerenciar" onClick={() => { setAberto(false); onGerenciar() }}><Settings2 size={14} /> Gerenciar respostas</button>
    </div>, document.body)}
  </div>
}
