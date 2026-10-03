import { useState } from 'react'
import { Plus } from 'lucide-react'
import { criarEtiqueta, desmarcarContato, marcarContato, useEtiquetas } from '../lib/etiquetas'
import { acharPorNome, nomeValido, normalizarNome, sugerir } from '../lib/etiquetasRegras'
import EtiquetaChip from './EtiquetaChip'

/**
 * As etiquetas de UM contato, na ficha. Escrever um nome que já existe só marca; um nome novo cria a etiqueta
 * (qualquer pessoa da equipe pode) e marca. Renomear, juntar e excluir etiquetas é do gestor, em Configurações.
 */
export default function EtiquetasDoContato({ contatoId }: { contatoId: string }) {
  const { etiquetas, porContato, carregando, erro: erroCarga, recarregar } = useEtiquetas()
  const [termo, setTermo] = useState('')
  const [erro, setErro] = useState('')
  const minhas = porContato.get(contatoId) ?? new Set<string>()
  const doContato = etiquetas.filter((e) => minhas.has(e.id))
  const sugestoes = sugerir(etiquetas, termo, minhas).slice(0, 6)
  const existente = acharPorNome(etiquetas, termo)

  async function adicionar(id: string | null) {
    setErro('')
    try {
      const alvo = id ?? (existente?.id ?? (await criarEtiqueta(termo)).id)
      await marcarContato(contatoId, alvo)
      setTermo(''); recarregar()
    } catch (e) {
      const codigo = (e as { code?: string }).code
      setErro(codigo === '23514' ? 'Um contato leva no máximo 20 etiquetas.' : codigo === '23505' ? 'Essa etiqueta já existe.' : 'Não foi possível salvar a etiqueta.')
    }
  }
  async function tirar(id: string) {
    setErro('')
    try { await desmarcarContato(contatoId, id); recarregar() } catch { setErro('Não foi possível tirar a etiqueta.') }
  }

  if (carregando) return null
  return <div className="tag-editor" aria-label="Etiquetas do contato">
    <div className="tag-list">
      {doContato.map((e) => <EtiquetaChip key={e.id} etiqueta={e} onRemover={() => void tirar(e.id)} />)}
      {doContato.length === 0 && <span style={{ color: 'var(--muted)', fontSize: 13 }}>Nenhuma etiqueta.</span>}
    </div>
    <form className="tag-add" onSubmit={(ev) => { ev.preventDefault(); if (nomeValido(termo)) void adicionar(null) }}>
      <input className="arc-field" aria-label="Nova etiqueta" list="sugestoes-de-etiqueta" maxLength={40} placeholder="Etiquetar: escreva e Enter" value={termo} onChange={(e) => setTermo(e.target.value)} />
      <datalist id="sugestoes-de-etiqueta">{sugestoes.map((e) => <option key={e.id} value={e.nome} />)}</datalist>
      <button type="submit" className="arc-button arc-button-secondary" disabled={!nomeValido(termo)}><Plus size={14} />{existente ? 'Marcar' : normalizarNome(termo) ? 'Criar e marcar' : 'Adicionar'}</button>
    </form>
    {(erro || erroCarga) && <p role="alert" style={{ color: 'var(--danger)', fontSize: 12.5, margin: '6px 0 0' }}>{erro || 'Não foi possível carregar as etiquetas.'}</p>}
  </div>
}
