import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Megaphone, Plus, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useSessao } from '../lib/sessao'
import { PageHeader, Notice, LoadingState, EmptyState } from '../components/ui'
import { chamarCampanhas, COR_ESTADO, mensagemDoBanco, quando, ROTULO_ESTADO, type CampanhaLinha, type Controle } from '../lib/campanhas'

interface Conta { configurada: boolean; numero?: string | null; nome?: string | null; qualidade?: string | null; limite?: string | null; indisponivel?: boolean }
const botao = { padding: '9px 13px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', font: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 } as const
const campo = { padding: 8, border: '1px solid var(--border)', borderRadius: 8, font: 'inherit', width: 90 } as const

export function EtiquetaEstado({ estado }: { estado: keyof typeof ROTULO_ESTADO }) {
  const cor = COR_ESTADO[estado]
  return <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: `var(--${cor}-soft, var(--surface-subtle))`, color: `var(--${cor}, var(--muted))` }}>{ROTULO_ESTADO[estado]}</span>
}

export default function Campanhas() {
  const { usuario } = useSessao()
  const gestor = usuario?.papel === 'gestor'
  const [linhas, setLinhas] = useState<CampanhaLinha[]>([])
  const [controle, setControle] = useState<Controle | null>(null)
  const [conta, setConta] = useState<Conta | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [limites, setLimites] = useState({ minuto: 30, dia: 250 })

  // Escritas dentro do `.then()` (e não depois de `await`): é o padrão do projeto para carregar dentro de efeito.
  const carregar = useCallback(() => Promise.all([
    supabase.from('campanhas_lista').select('*').order('criada_em', { ascending: false }).limit(100),
    supabase.from('campanhas_controle').select('*').limit(1).maybeSingle(),
  ]).then(([l, c]) => {
    if (l.error) { setErro('Não foi possível carregar as campanhas. Atualize a página.'); setCarregando(false); return }
    setLinhas((l.data ?? []) as CampanhaLinha[])
    if (c.data) { setControle(c.data as Controle); setLimites({ minuto: (c.data as Controle).limite_por_minuto, dia: (c.data as Controle).limite_diario }) }
    setCarregando(false)
  }), [])

  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => {
    const canal = supabase.channel('campanhas-lista').on('postgres_changes', { event: '*', schema: 'public', table: 'campanhas' }, () => void carregar()).subscribe()
    const i = window.setInterval(() => { if (document.visibilityState === 'visible') void carregar() }, 15000)
    return () => { window.clearInterval(i); void supabase.removeChannel(canal) }
  }, [carregar])
  useEffect(() => { if (gestor) chamarCampanhas<Conta>('/conta').then(setConta).catch(() => setConta({ configurada: false })) }, [gestor])

  async function atualizarControle(campos: Partial<Pick<Controle, 'pausado' | 'pausa_motivo' | 'limite_por_minuto' | 'limite_diario'>>) {
    setSalvando(true); setErro('')
    const { error } = await supabase.from('campanhas_controle').update(campos).eq('id', true)
    setSalvando(false)
    if (error) { setErro(mensagemDoBanco(error, 'Não foi possível salvar. Tente novamente.')); return }
    await carregar()
  }

  if (carregando) return <div className="page-content"><LoadingState label="Carregando campanhas…" /></div>
  return <div className="page-content">
    <PageHeader title="Campanhas" description="Disparo de modelos aprovados pela Meta para contatos que autorizaram receber. Cada envio aparece na conversa do contato."
      actions={gestor ? <Link to="/campanhas/nova" style={{ ...botao, background: 'var(--action)', color: 'var(--on-action)', textDecoration: 'none' }}><Plus size={15} /> Nova campanha</Link> : undefined} />
    {erro && <p role="alert" style={{ color: 'var(--danger)' }}>{erro}</p>}
    {gestor && conta && !conta.configurada && <Notice tone="warning">A Meta ainda não está configurada no servidor. Sem as chaves e o número, dá para montar campanhas, mas nada é enviado.</Notice>}
    {gestor && conta?.configurada && !conta.indisponivel && <p style={{ fontSize: 13, color: 'var(--muted)' }}>Número: <strong>{conta.numero ?? '—'}</strong> ({conta.nome ?? 'sem nome verificado'}) · qualidade {conta.qualidade ?? '—'} · limite da Meta {conta.limite ?? '—'}</p>}

    {controle && <section aria-label="Controle dos envios" style={{ margin: '16px 0', padding: 14, border: '1px solid var(--border)', borderRadius: 10, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <span><strong>{controle.pausado ? 'Envios pausados para toda a instalação' : 'Envios liberados'}</strong>
          <span style={{ color: 'var(--muted)', fontSize: 13 }}> · hoje {controle.usados_no_dia} de {controle.limite_diario}</span></span>
        {gestor && <button disabled={salvando} onClick={() => void atualizarControle({ pausado: !controle.pausado, pausa_motivo: null })} style={{ ...botao, borderColor: controle.pausado ? 'var(--border)' : 'var(--danger)', color: controle.pausado ? undefined : 'var(--danger)' }}>
          {controle.pausado ? 'Liberar envios' : 'Pausar todos os envios'}</button>}
      </div>
      {gestor && <form onSubmit={e => { e.preventDefault(); void atualizarControle({ limite_por_minuto: limites.minuto, limite_diario: limites.dia }) }} style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'end', fontSize: 13 }}>
        <label>Por minuto<br /><input type="number" min={1} max={1000} style={campo} value={limites.minuto} onChange={e => setLimites({ ...limites, minuto: Number(e.target.value) })} /></label>
        <label>Por dia<br /><input type="number" min={1} max={1000000} style={campo} value={limites.dia} onChange={e => setLimites({ ...limites, dia: Number(e.target.value) })} /></label>
        <button disabled={salvando} style={botao}>Salvar limites</button>
        <span style={{ color: 'var(--muted)' }}>Suba o limite diário só depois de a Meta liberar mais para o seu número.</span>
      </form>}
    </section>}

    {linhas.length === 0 ? <EmptyState title="Nenhuma campanha ainda">{gestor ? 'Crie a primeira: escolha um modelo aprovado, defina o público e revise antes de enviar.' : 'Quando o gestor criar uma campanha, ela aparece aqui.'}</EmptyState> :
      <div style={{ display: 'grid', gap: 10 }}>
        {linhas.map(c => <Link key={c.id} to={`/campanhas/${c.id}`} style={{ display: 'block', padding: 14, border: '1px solid var(--border)', borderRadius: 10, textDecoration: 'none', color: 'inherit', background: 'var(--surface)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Megaphone size={15} /> {c.nome}</strong>
            <EtiquetaEstado estado={c.estado} />
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Modelo {c.modelo_nome} · criada {quando(c.criada_em)}</div>
          {c.aptos > 0 && <div style={{ fontSize: 13, marginTop: 6 }}>{c.aptos} contato(s) · {c.aceitos} enviado(s) · {c.entregues} entregue(s) · {c.lidos} lido(s){c.falhas ? ` · ${c.falhas} falha(s)` : ''}{c.incertos ? ` · ${c.incertos} sem confirmação` : ''}{c.na_fila ? ` · ${c.na_fila} na fila` : ''}</div>}
        </Link>)}
      </div>}
    <p style={{ marginTop: 16 }}><button onClick={() => void carregar()} style={botao}><RefreshCw size={14} /> Atualizar</button></p>
  </div>
}
