import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useSessao } from '../lib/sessao'
import { PageHeader, LoadingState, Notice, Card } from '../components/ui'
import { EtiquetaEstado } from './Campanhas'
import { mensagemDoBanco, previaDoModelo, quando, ROTULO_DESTINATARIO, ROTULO_EXCLUSAO, type Campanha, type CampanhaLinha, type Destinatario, type EventoCampanha } from '../lib/campanhas'

const botao = { padding: '9px 13px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', font: 'inherit' } as const
const primario = { ...botao, background: 'var(--action)', color: 'var(--on-action)' } as const
const perigo = { ...botao, borderColor: 'var(--danger)', color: 'var(--danger)' } as const

export default function CampanhaDetalhe() {
  const { id } = useParams()
  const navegar = useNavigate()
  const { usuario } = useSessao()
  const gestor = usuario?.papel === 'gestor'
  const [c, setC] = useState<Campanha | null>(null)
  const [linha, setLinha] = useState<CampanhaLinha | null>(null)
  const [dest, setDest] = useState<Destinatario[]>([])
  const [eventos, setEventos] = useState<EventoCampanha[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [confirmou, setConfirmou] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [filtro, setFiltro] = useState<'todos' | 'aptos' | 'excluidos' | 'falhas'>('todos')

  const carregar = useCallback(() => !id ? Promise.resolve() : Promise.all([
      supabase.from('campanhas').select('*').eq('id', id).maybeSingle(),
      supabase.from('campanhas_lista').select('*').eq('id', id).maybeSingle(),
      supabase.from('campanha_destinatarios').select('id,contato_id,whatsapp,nome,valores,apto,motivo_exclusao,estado,erro,tentativas').eq('campanha_id', id).order('criada_em').order('id').limit(1000),
      supabase.from('campanha_eventos').select('id,tipo,descricao,criado_em').eq('campanha_id', id).order('criado_em', { ascending: false }).limit(15),
  ]).then(([a, b, d, e]) => {
    if (a.error || !a.data) { setErro('Campanha não encontrada.'); setCarregando(false); return }
    setC(a.data as Campanha); setLinha(b.data as CampanhaLinha | null); setDest((d.data ?? []) as Destinatario[]); setEventos((e.data ?? []) as EventoCampanha[]); setCarregando(false)
  }), [id])

  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => {
    if (!id) return
    const canal = supabase.channel(`campanha-${id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'campanhas', filter: `id=eq.${id}` }, () => void carregar()).subscribe()
    const i = window.setInterval(() => { if (document.visibilityState === 'visible') void carregar() }, 8000)
    return () => { window.clearInterval(i); void supabase.removeChannel(canal) }
  }, [id, carregar])

  async function acao(rpc: string, args: Record<string, unknown>, depois?: () => void) {
    setOcupado(true); setErro('')
    const { error } = await supabase.rpc(rpc, args)
    setOcupado(false)
    if (error) { setErro(mensagemDoBanco(error, 'Não foi possível concluir. Atualize a página e tente de novo.')); return }
    setConfirmou(false); setCancelando(false); setMotivo(''); depois?.(); await carregar()
  }
  async function apagarRascunho() {
    if (!id || !window.confirm('Apagar este rascunho? Não dá para desfazer.')) return
    setOcupado(true)
    const { error } = await supabase.from('campanhas').delete().eq('id', id)
    setOcupado(false)
    if (error) { setErro(mensagemDoBanco(error, 'Não foi possível apagar.')); return }
    navegar('/campanhas')
  }

  if (carregando) return <div className="page-content"><LoadingState label="Carregando a campanha…" /></div>
  if (!c) return <div className="page-content"><PageHeader title="Campanha" /><p role="alert" style={{ color: 'var(--danger)' }}>{erro}</p><Link to="/campanhas">Voltar às campanhas</Link></div>

  const campos = c.modelo_snapshot.campos ?? []
  const aptos = dest.filter(d => d.apto), excluidos = dest.filter(d => !d.apto)
  const porMotivo = excluidos.reduce<Record<string, number>>((m, d) => ({ ...m, [d.motivo_exclusao ?? 'outro']: (m[d.motivo_exclusao ?? 'outro'] ?? 0) + 1 }), {})
  const lista = dest.filter(d => filtro === 'todos' ? true : filtro === 'aptos' ? d.apto : filtro === 'excluidos' ? !d.apto : d.estado === 'falhou' || d.estado === 'incerto')
  const editavel = c.estado === 'rascunho' || c.estado === 'pronta'

  return <div className="page-content">
    <PageHeader title={c.nome} description={c.objetivo ?? undefined} eyebrow={`Modelo ${c.modelo_nome}`} actions={<EtiquetaEstado estado={c.estado} />} />
    <p><Link to="/campanhas">← Todas as campanhas</Link></p>
    {erro && <p role="alert" style={{ color: 'var(--danger)' }}>{erro}</p>}
    {c.motivo && (c.estado === 'pausada' || c.estado === 'cancelada') && <Notice tone={c.estado === 'cancelada' ? 'danger' : 'warning'}>{c.estado === 'cancelada' ? 'Cancelada' : 'Pausada'}: {c.motivo}</Notice>}

    {gestor && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
      {editavel && <Link to={`/campanhas/${c.id}/editar`} style={{ ...botao, textDecoration: 'none' }}>Editar configuração</Link>}
      {editavel && <button disabled={ocupado} style={botao} onClick={() => void acao('campanha_congelar_publico', { p_campanha: c.id })}>{c.estado === 'pronta' ? 'Recalcular o público' : 'Congelar o público para revisar'}</button>}
      {c.estado === 'rascunho' && <button disabled={ocupado} style={perigo} onClick={() => void apagarRascunho()}>Apagar rascunho</button>}
      {c.estado === 'enviando' && <button disabled={ocupado} style={botao} onClick={() => void acao('campanha_pausar', { p_campanha: c.id, p_motivo: 'Pausada pelo gestor' })}>Pausar</button>}
      {c.estado === 'pausada' && <button disabled={ocupado} style={primario} onClick={() => void acao('campanha_retomar', { p_campanha: c.id })}>Retomar</button>}
      {['pronta', 'enviando', 'pausada'].includes(c.estado) && <button disabled={ocupado} style={perigo} onClick={() => setCancelando(true)}>Cancelar campanha</button>}
    </div>}

    {cancelando && <form aria-label="Cancelar campanha" onSubmit={e => { e.preventDefault(); void acao('campanha_cancelar', { p_campanha: c.id, p_motivo: motivo }) }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 16px' }}>
      <input required minLength={5} aria-label="Motivo do cancelamento" placeholder="Por que está cancelando?" value={motivo} onChange={e => setMotivo(e.target.value)} style={{ flex: 1, minWidth: 220, padding: 9, border: '1px solid var(--border)', borderRadius: 8, font: 'inherit' }} />
      <button disabled={ocupado || motivo.trim().length < 5} style={perigo}>Confirmar cancelamento</button>
      <button type="button" style={botao} onClick={() => setCancelando(false)}>Voltar</button></form>}

    {linha && c.estado !== 'rascunho' && <Card style={{ padding: 16, margin: '8px 0 18px' }}>
      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
        {([['Na lista', linha.aptos], ['Fora da lista', linha.excluidos], ['Na fila', linha.na_fila], ['Enviados', linha.aceitos], ['Entregues', linha.entregues], ['Lidos', linha.lidos], ['Falhas', linha.falhas], ['Sem confirmação', linha.incertos]] as [string, number][]).map(([r, n]) =>
          <div key={r}><div style={{ fontSize: 22, fontWeight: 700 }}>{n}</div><div style={{ fontSize: 12, color: 'var(--muted)' }}>{r}</div></div>)}
      </div>
      {linha.incertos > 0 && <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--warning)' }}>"Sem confirmação": a Meta não confirmou. O sistema nunca reenvia sozinho; confira na conversa do contato se a mensagem saiu.</p>}
    </Card>}

    {c.estado === 'pronta' && <Card style={{ padding: 16, margin: '8px 0 18px', display: 'grid', gap: 10 }}>
      <h2 style={{ margin: 0, fontSize: 17 }}>Revise antes de enviar</h2>
      <p style={{ margin: 0 }}><strong>{aptos.length}</strong> contato(s) vão receber. <strong>{excluidos.length}</strong> ficam de fora{excluidos.length ? ':' : '.'}</p>
      {excluidos.length > 0 && <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>{Object.entries(porMotivo).map(([m, n]) => <li key={m}>{n} · {ROTULO_EXCLUSAO[m] ?? m}</li>)}</ul>}
      {aptos[0] && <div><div style={{ fontSize: 13, color: 'var(--muted)' }}>Exemplo, como {aptos[0].nome ?? 'o primeiro contato'} vai ler:</div>
        <p style={{ margin: '4px 0 0', padding: 10, background: 'var(--surface-subtle)', borderRadius: 8, whiteSpace: 'pre-wrap' }}>{previaDoModelo(campos, aptos[0].valores)}</p></div>}
      {gestor && aptos.length > 0 && <>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14 }}><input type="checkbox" checked={confirmou} onChange={e => setConfirmou(e.target.checked)} style={{ marginTop: 3 }} />
          <span>Revisei a lista e confirmo que estes contatos autorizaram receber mensagens de marketing por WhatsApp.</span></label>
        <div><button disabled={!confirmou || ocupado || !c.revisao_hash} style={primario} onClick={() => void acao('campanha_iniciar', { p_campanha: c.id, p_revisao_hash: c.revisao_hash })}>Iniciar envio</button></div></>}
      {aptos.length === 0 && <Notice tone="warning">Ninguém na lista. Registre a autorização dos contatos (na ficha de cada um) ou ajuste o público.</Notice>}
    </Card>}

    {c.estado === 'rascunho' && <Notice tone="info">Rascunho: {gestor ? 'edite a configuração e clique em "Congelar o público para revisar" para ver quem vai receber.' : 'o gestor ainda vai revisar o público.'}</Notice>}

    {dest.length > 0 && <section aria-label="Contatos da campanha" style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>Contatos</h2>
        {(['todos', 'aptos', 'excluidos', 'falhas'] as const).map(f => <button key={f} aria-pressed={filtro === f} onClick={() => setFiltro(f)} style={{ ...botao, padding: '4px 10px', fontWeight: filtro === f ? 700 : 400 }}>{{ todos: 'Todos', aptos: 'Na lista', excluidos: 'Fora da lista', falhas: 'Com problema' }[f]}</button>)}
        {dest.length >= 1000 && <span style={{ fontSize: 12, color: 'var(--muted)' }}>(mostrando os 1.000 primeiros)</span>}
      </div>
      <div style={{ display: 'grid', gap: 4, fontSize: 14 }}>
        {lista.slice(0, 200).map(d => <div key={d.id} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'space-between', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8 }}>
          <span><Link to={`/leads/${d.contato_id}`}>{d.nome || d.whatsapp || 'Sem nome'}</Link> <span style={{ color: 'var(--muted)' }}>{d.whatsapp ?? ''}</span></span>
          <span>{d.apto ? ROTULO_DESTINATARIO[d.estado] : (ROTULO_EXCLUSAO[d.motivo_exclusao ?? ''] ?? 'Fora da lista')}{d.erro ? <span style={{ color: 'var(--danger)' }}> · {d.erro}</span> : null}</span>
        </div>)}
        {lista.length > 200 && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Mostrando 200 de {lista.length}.</span>}
      </div>
    </section>}

    {eventos.length > 0 && <section aria-label="Histórico" style={{ marginTop: 22 }}>
      <h2 style={{ fontSize: 17 }}>Histórico</h2>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 4, fontSize: 13 }}>{eventos.map(e => <li key={e.id}><span style={{ color: 'var(--muted)' }}>{quando(e.criado_em)}</span> · {e.tipo.replaceAll('_', ' ')}{e.descricao ? ` — ${e.descricao}` : ''}</li>)}</ul>
    </section>}
  </div>
}
