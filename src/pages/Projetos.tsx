import { PageHeader, LoadingState } from '../components/ui'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Save, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import ModalPortal from '../components/ModalPortal'

const ETAPAS = { planejamento: 'Planejamento', andamento: 'Em andamento', revisao: 'Revisão', entregue: 'Entregue' }
type Etapa = keyof typeof ETAPAS
interface Projeto {
  id: string; contato_id: string; oportunidade_id: string; updated_at: string; nome: string; etapa: Etapa; prazo: string | null
  escopo: string; responsavel_id: string | null
  oportunidade: { nome: string; status: string; cancelado_em: string | null } | null
  cliente: { nome: string | null; empresa: string | null; status: string } | null
}
interface Responsavel { id: string; nome: string; sobrenome: string; ativo: boolean }
const campo = { width: '100%', padding: 10, border: '1px solid var(--border)', borderRadius: 8, font: 'inherit', boxSizing: 'border-box' as const }
const botao = { padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', font: 'inherit' }

export default function Projetos() {
  const [params, setParams] = useSearchParams()
  const [projetos, setProjetos] = useState<Projeto[]>([])
  const [equipe, setEquipe] = useState<Responsavel[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [edicao, setEdicao] = useState<Projeto | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [busca, setBusca] = useState('')
  const [versao, setVersao] = useState(0)

  useEffect(() => {
    let vivo = true
    async function carregar() {
      setLoading(true); setErro('')
      try {
        const lista: Projeto[] = []
        for (let inicio = 0; ; inicio += 500) {
          const { data, error } = await supabase.from('projetos')
            .select('*, cliente:contatos_dados(nome,empresa,status), oportunidade:oportunidades(nome,status,cancelado_em)').order('created_at', { ascending: false }).order('id').range(inicio, inicio + 499)
          if (error) throw error
          lista.push(...(data as unknown as Projeto[]))
          if (!data || data.length < 500) break
        }
        const { data, error } = await supabase.from('profissionais').select('id,nome,sobrenome,ativo').order('nome')
        if (error) throw error
        if (vivo) { setProjetos(lista); setEquipe(data ?? []) }
      } catch { if (vivo) setErro('Não foi possível carregar os projetos. Tente atualizar.') }
      finally { if (vivo) setLoading(false) }
    }
    void carregar()
    return () => { vivo = false }
  }, [versao])

  useEffect(() => {
    const atualizar = () => setVersao(v => v + 1)
    const canal = supabase.channel('projetos-atualizacao')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projetos' }, () => setVersao(v => v + 1))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'oportunidades' }, () => setVersao(v => v + 1))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profissionais' }, () => setVersao(v => v + 1))
      .subscribe(status => { if (status === 'SUBSCRIBED') atualizar() })
    // Keep the board current when the realtime connection is unavailable.
    const intervalo = window.setInterval(() => {
      if (document.visibilityState === 'visible') atualizar()
    }, 15000)
    window.addEventListener('focus', atualizar)
    return () => {
      window.clearInterval(intervalo)
      window.removeEventListener('focus', atualizar)
      void supabase.removeChannel(canal)
    }
  }, [])

  async function salvar() {
    if (!edicao || !edicao.nome.trim()) return
    setSalvando(true); setErro('')
    const { data, error } = await supabase.from('projetos').update({
      nome: edicao.nome.trim(), etapa: edicao.etapa, prazo: edicao.prazo || null,
      escopo: edicao.escopo, responsavel_id: edicao.responsavel_id || null, updated_at: new Date().toISOString(),
    }).eq('id', edicao.id).eq('updated_at', edicao.updated_at).select('*, cliente:contatos_dados(nome,empresa,status), oportunidade:oportunidades(nome,status,cancelado_em)').single()
    setSalvando(false)
    if (error) { setErro('Não foi possível salvar. O projeto pode ter mudado em outra sessão; atualize e tente novamente.'); return }
    setProjetos(prev => prev.map(p => p.id === edicao.id ? data as unknown as Projeto : p))
    setEdicao(null)
  }

  const filtrados = projetos.filter(p => (!params.get('oportunidade') || p.oportunidade_id === params.get('oportunidade'))).filter(p => `${p.nome} ${p.cliente?.empresa ?? ''} ${p.cliente?.nome ?? ''}`.toLowerCase().includes(busca.toLowerCase()))
  return <div className="page-content">
    <PageHeader title="Projetos" description="Da venda à entrega. Cada oportunidade ganha tem seu próprio projeto." />
    {params.get('oportunidade') && <button style={botao} onClick={() => setParams({})}>Ver todos os projetos</button>}
    <div style={{ display: 'flex', gap: 12, margin: '24px 0' }}>
      <input aria-label="Buscar projetos" placeholder="Buscar por projeto, cliente ou empresa" value={busca} onChange={e => setBusca(e.target.value)} style={{ ...campo, maxWidth: 450 }} />
      <button style={botao} onClick={() => setVersao(v => v + 1)} disabled={loading}>Atualizar</button>
    </div>
    {erro && <p role="alert" style={{ color: 'var(--danger)' }}>{erro}</p>}
    {loading ? <LoadingState label="Carregando projetos…" /> : <div className="project-board" role="region" aria-label="Etapas dos projetos" tabIndex={0}>
      {(Object.entries(ETAPAS) as [Etapa,string][]).map(([etapa,label]) => <section key={etapa} style={{ background: 'var(--surface-subtle)', borderRadius: 12, padding: 14 }}>
        <h2 style={{ fontSize: 15 }}>{label} <span style={{ color: 'var(--muted)' }}>({filtrados.filter(p => p.etapa === etapa).length})</span></h2>
        {filtrados.filter(p => p.etapa === etapa).map(p => <article className="project-card" key={p.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginTop: 12 }}>
          <strong>{p.nome}</strong>
          <p style={{ fontSize: 13 }}><Link to={`/leads/${p.contato_id}`}>{p.cliente?.empresa || p.cliente?.nome || 'Abrir cliente'}</Link></p>
          {p.oportunidade?.status !== 'ganho' && <p style={{ fontSize: 12, color: 'var(--warning)' }}>A venda foi cancelada. Revise o andamento deste projeto.</p>}
          <p style={{ fontSize: 12, color: 'var(--muted)' }}>{equipe.find(r => r.id === p.responsavel_id)?.nome || 'Sem responsável'} · {p.prazo ? `Entrega: ${p.prazo.split('-').reverse().join('/')}` : 'Prazo a definir'}</p>
          <button style={botao} onClick={() => { setErro(''); setEdicao({ ...p }) }}>Editar projeto</button>
        </article>)}
        {!filtrados.some(p => p.etapa === etapa) && <p style={{ fontSize: 13, color: 'var(--muted)' }}>Nenhum projeto nesta etapa.</p>}
      </section>)}
    </div>}
    {edicao && <ModalPortal label="Editar projeto" onClose={() => setEdicao(null)} busy={salvando}><div style={{ position: 'fixed', inset: 0, zIndex: 150, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <form aria-label="Editar projeto" onSubmit={e => { e.preventDefault(); void salvar() }} style={{ background: 'var(--surface)', borderRadius: 16, padding: 24, width: 540, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', display: 'grid', gap: 15 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Editar projeto</h2><button type="button" aria-label="Fechar" disabled={salvando} onClick={() => setEdicao(null)} style={botao}><X size={18} /></button></div>
        <label>Nome<input required maxLength={160} style={campo} value={edicao.nome} onChange={e => setEdicao({ ...edicao, nome: e.target.value })} /></label>
        <label>Etapa<select aria-label="Etapa" style={campo} value={edicao.etapa} onChange={e => setEdicao({ ...edicao, etapa: e.target.value as Etapa })}>{Object.entries(ETAPAS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label>Responsável<select style={campo} value={edicao.responsavel_id ?? ''} onChange={e => setEdicao({ ...edicao, responsavel_id: e.target.value || null })}><option value="">A definir</option>{equipe.filter(r => r.ativo || r.id === edicao.responsavel_id).map(r => <option key={r.id} value={r.id}>{r.nome} {r.sobrenome}{!r.ativo ? " (inativo)" : ""}</option>)}</select></label>
        <label>Prazo de entrega<input type="date" style={campo} value={edicao.prazo ?? ''} onChange={e => setEdicao({ ...edicao, prazo: e.target.value || null })} /></label>
        <label>Escopo e combinados<textarea rows={5} style={campo} value={edicao.escopo} onChange={e => setEdicao({ ...edicao, escopo: e.target.value })} /></label>
        {erro && <p role="alert" style={{ color: 'var(--danger)' }}>{erro}</p>}
        <button disabled={salvando || !edicao.nome.trim()} style={{ ...botao, background: 'var(--action)', color: 'var(--on-action)' }}><Save size={15} /> {salvando ? 'Salvando…' : 'Salvar projeto'}</button>
      </form>
    </div></ModalPortal>}
  </div>
}
