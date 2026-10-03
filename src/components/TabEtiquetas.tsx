import { useState } from 'react'
import { Merge, Trash2 } from 'lucide-react'
import { alterarEtiqueta, excluirEtiqueta, juntarEtiquetas, useEtiquetas } from '../lib/etiquetas'
import { CORES_ETIQUETA, NOME_DA_COR, nomeValido, type CorEtiqueta, type Etiqueta } from '../lib/etiquetasRegras'
import ConfirmDeleteModal from './ConfirmDeleteModal'
import EtiquetaChip from './EtiquetaChip'
import { Button, EmptyState, LoadingState, Notice } from './ui'

/**
 * Aba "Etiquetas" de Configurações (gestor): o vocabulário da empresa. Renomear muda em todos os contatos;
 * juntar passa quem tinha uma para a outra e some com a primeira; excluir tira de todo mundo.
 */
export default function TabEtiquetas() {
  const { etiquetas, usos, carregando, erro: erroCarga, recarregar } = useEtiquetas()
  const [rascunho, setRascunho] = useState<Record<string, string>>({})
  const [juntando, setJuntando] = useState<{ origem: string; destino: string } | null>(null)
  const [apagando, setApagando] = useState<Etiqueta | null>(null)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [ocupado, setOcupado] = useState(false)

  async function executar(f: () => Promise<void>, falha: string) {
    setOcupado(true); setErro(''); setAviso('')
    try { await f(); recarregar() }
    catch (e) {
      const c = (e as { code?: string }).code
      setErro(e instanceof Error && e.message === 'sem_permissao' ? 'Só o gestor altera as etiquetas.' : c === '23505' ? 'Já existe uma etiqueta com esse nome.' : falha)
    }
    setOcupado(false)
  }

  if (carregando) return <LoadingState label="Carregando etiquetas…" />
  return <div style={{ display: 'grid', gap: 14 }}>
    <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13.5 }}>O vocabulário de etiquetas da empresa. Qualquer pessoa da equipe cria etiquetas ao marcar um contato; aqui o gestor renomeia, troca a cor, junta duas em uma e exclui.</p>
    {(erro || erroCarga) && <Notice tone="danger">{erro || 'Não foi possível carregar as etiquetas.'}</Notice>}
    {aviso && <Notice tone="success">{aviso}</Notice>}
    {etiquetas.length === 0 ? <EmptyState title="Nenhuma etiqueta ainda">Abra a ficha de um contato e escreva uma etiqueta para criar a primeira.</EmptyState> : (
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {etiquetas.map((e) => {
          const nome = rascunho[e.id] ?? e.nome
          const mudou = nome.trim() !== e.nome
          return <li key={e.id} className="tag-row">
            <EtiquetaChip etiqueta={{ ...e, nome: nome.trim() || e.nome }} />
            <input className="arc-field" aria-label={`Nome da etiqueta ${e.nome}`} maxLength={40} value={nome} onChange={(ev) => setRascunho({ ...rascunho, [e.id]: ev.target.value })} />
            <select className="arc-field" aria-label={`Cor da etiqueta ${e.nome}`} value={e.cor} disabled={ocupado} onChange={(ev) => void executar(() => alterarEtiqueta(e.id, { cor: ev.target.value as CorEtiqueta }), 'Não foi possível trocar a cor.')}>
              {CORES_ETIQUETA.map((c) => <option key={c} value={c}>{NOME_DA_COR[c]}</option>)}
            </select>
            <small style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{usos.get(e.id) ?? 0} {(usos.get(e.id) ?? 0) === 1 ? 'contato' : 'contatos'}</small>
            <Button disabled={!mudou || !nomeValido(nome) || ocupado} onClick={() => void executar(async () => { await alterarEtiqueta(e.id, { nome }); setRascunho((r) => Object.fromEntries(Object.entries(r).filter(([id]) => id !== e.id))) }, 'Não foi possível renomear.')}>Salvar nome</Button>
            <Button aria-label={`Juntar ${e.nome} em outra`} title="Juntar em outra etiqueta" disabled={etiquetas.length < 2 || ocupado} onClick={() => setJuntando({ origem: e.id, destino: etiquetas.find((x) => x.id !== e.id)!.id })}><Merge size={14} /></Button>
            <Button variant="danger" aria-label={`Excluir ${e.nome}`} title="Excluir" disabled={ocupado} onClick={() => setApagando(e)}><Trash2 size={14} /></Button>
          </li>
        })}
      </ul>
    )}

    {juntando && <Notice tone="warning">
      <div style={{ display: 'grid', gap: 8 }}>
        <span>Juntar <strong>{etiquetas.find((e) => e.id === juntando.origem)?.nome}</strong> em:</span>
        <select className="arc-field" aria-label="Etiqueta de destino" value={juntando.destino} onChange={(ev) => setJuntando({ ...juntando, destino: ev.target.value })}>
          {etiquetas.filter((e) => e.id !== juntando.origem).map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
        <span style={{ fontSize: 12.5 }}>Quem tem a primeira passa a ter a segunda, e a primeira deixa de existir. Não dá para desfazer.</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="primary" disabled={ocupado} onClick={() => void executar(async () => { const n = await juntarEtiquetas(juntando.origem, juntando.destino); setAviso(`Etiquetas juntadas. ${n} ${n === 1 ? 'contato passou' : 'contatos passaram'} para a de destino.`); setJuntando(null) }, 'Não foi possível juntar as etiquetas.')}>Juntar</Button>
          <Button onClick={() => setJuntando(null)}>Cancelar</Button>
        </div>
      </div>
    </Notice>}

    {apagando && <ConfirmDeleteModal itemName={apagando.nome} loading={ocupado} title="Excluir etiqueta"
      message={<>Excluir a etiqueta <strong>{apagando.nome}</strong>? Ela sai dos {usos.get(apagando.id) ?? 0} contatos que a têm. Não dá para desfazer.</>}
      onClose={() => setApagando(null)}
      onConfirm={() => void executar(async () => { await excluirEtiqueta(apagando.id); setApagando(null) }, 'Não foi possível excluir a etiqueta.')} />}
  </div>
}
