import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Save } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useFunil } from '../lib/funil'
import { PageHeader, Notice, LoadingState } from '../components/ui'
import { chamarCampanhas, mensagemDoBanco, ORIGENS, parametrosDoModelo, previaDoModelo, type Campanha, type FiltrosPublico, type ModeloCampanha, type ParametroMapeado } from '../lib/campanhas'

const campo = { width: '100%', padding: 10, border: '1px solid var(--border)', borderRadius: 8, font: 'inherit', boxSizing: 'border-box' as const }
const botao = { padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', font: 'inherit' }
interface ContatoBusca { id: string; nome: string | null; whatsapp: string | null }

/** Criar ou editar o rascunho de uma campanha. Depois de salvar, o público é congelado e revisado na tela da campanha. */
export default function NovaCampanha() {
  const { id } = useParams()
  const navegar = useNavigate()
  const funil = useFunil()
  const [modelos, setModelos] = useState<ModeloCampanha[] | null>(null)
  const [erroModelos, setErroModelos] = useState('')
  const [carregando, setCarregando] = useState(Boolean(id))
  const [nome, setNome] = useState(''); const [objetivo, setObjetivo] = useState('')
  const [modeloId, setModeloId] = useState(''); const [mapa, setMapa] = useState<ParametroMapeado[]>([])
  const [filtros, setFiltros] = useState<FiltrosPublico>({})
  const [limite, setLimite] = useState(1000); const [intervalo, setIntervalo] = useState(24)
  const [servicos, setServicos] = useState<string[]>([])
  const [busca, setBusca] = useState(''); const [achados, setAchados] = useState<ContatoBusca[]>([]); const [escolhidos, setEscolhidos] = useState<ContatoBusca[]>([])
  const [salvando, setSalvando] = useState(false); const [erro, setErro] = useState('')

  useEffect(() => {
    chamarCampanhas<{ modelos: ModeloCampanha[] }>('/modelos').then(r => setModelos(r.modelos)).catch(e => { setErroModelos(e instanceof Error ? e.message : 'Não consegui listar os modelos.'); setModelos([]) })
    void supabase.from('catalogo_servicos').select('nome').eq('ativo', true).eq('arquivado', false).eq('e_reuniao_previa', false).order('nome').then(({ data }) => setServicos((data ?? []).map(s => s.nome as string)))
  }, [])

  useEffect(() => {
    if (!id) return
    void supabase.from('campanhas').select('*').eq('id', id).maybeSingle().then(async ({ data }) => {
      const c = data as Campanha | null
      if (c) {
        setNome(c.nome); setObjetivo(c.objetivo ?? ''); setModeloId(c.modelo_id); setMapa(c.mapeamento_parametros); setFiltros(c.filtros_publico)
        setLimite(c.limite_destinatarios); setIntervalo(c.intervalo_minimo_horas)
        const ids = c.filtros_publico.contato_ids ?? []
        if (ids.length) { const { data: cs } = await supabase.from('contatos_dados').select('id,nome,whatsapp').in('id', ids); setEscolhidos((cs ?? []) as ContatoBusca[]) }
      }
      setCarregando(false)
    })
  }, [id])

  useEffect(() => {
    const termo = busca.trim()
    if (termo.length < 2) return
    const t = window.setTimeout(() => {
      void supabase.from('contatos_dados').select('id,nome,whatsapp').or(`nome.ilike.%${termo.replace(/[%,()]/g, '')}%,whatsapp.ilike.%${termo.replace(/\D/g, '') || '@@'}%`).limit(8)
        .then(({ data }) => setAchados((data ?? []) as ContatoBusca[]))
    }, 250)
    return () => window.clearTimeout(t)
  }, [busca])

  const modelo = modelos?.find(m => m.id === modeloId)
  function escolherModelo(novo: string) {
    setModeloId(novo)
    const m = modelos?.find(x => x.id === novo)
    setMapa(m ? parametrosDoModelo(m.campos).map(p => ({ ...p, origem: p.posicao === 1 && p.tipo === 'body' ? 'primeiro_nome' : 'fixo', valor: '' })) : [])
  }
  const mudaMapa = (i: number, parte: Partial<ParametroMapeado>) => setMapa(mapa.map((p, j) => j === i ? { ...p, ...parte } : p))
  const marcaEtapa = (chave: string) => { const atual = filtros.status ?? []; setFiltros({ ...filtros, status: atual.includes(chave) ? atual.filter(s => s !== chave) : [...atual, chave] }) }
  function adicionar(c: ContatoBusca) { if (!escolhidos.some(x => x.id === c.id)) setEscolhidos([...escolhidos, c]); setBusca(''); setAchados([]) }

  async function salvar() {
    if (!modelo && !id) { setErro('Escolha um modelo aprovado.'); return }
    if (mapa.some(p => p.origem === 'fixo' && !p.valor?.trim())) { setErro('Preencha o texto fixo de cada parâmetro marcado como "Texto fixo".'); return }
    setSalvando(true); setErro('')
    const filtrosLimpos: FiltrosPublico = {}
    if (filtros.status?.length) filtrosLimpos.status = filtros.status
    if (filtros.interesse) filtrosLimpos.interesse = filtros.interesse
    if (escolhidos.length) filtrosLimpos.contato_ids = escolhidos.map(c => c.id)
    const base = {
      nome: nome.trim(), objetivo: objetivo.trim() || null, mapeamento_parametros: mapa.map(p => p.origem === 'fixo' ? p : { tipo: p.tipo, posicao: p.posicao, origem: p.origem }),
      filtros_publico: filtrosLimpos, limite_destinatarios: limite, intervalo_minimo_horas: intervalo,
      ...(modelo ? { modelo_id: modelo.id, modelo_nome: modelo.nome, modelo_idioma: modelo.idioma, modelo_snapshot: { campos: modelo.campos } } : {}),
    }
    const r = id ? await supabase.from('campanhas').update(base).eq('id', id).select('id').single()
      : await supabase.from('campanhas').insert(base).select('id').single()
    setSalvando(false)
    if (r.error || !r.data) { setErro(mensagemDoBanco(r.error, 'Não foi possível salvar a campanha. Confira os campos e tente de novo.')); return }
    navegar(`/campanhas/${r.data.id}`)
  }

  if (carregando || modelos === null) return <div className="page-content"><LoadingState label="Carregando…" /></div>
  const valoresExemplo: Record<string, string[]> = {}
  for (const p of mapa) (valoresExemplo[p.tipo] ??= [])[p.posicao - 1] = p.origem === 'fixo' ? (p.valor || '…') : p.origem === 'empresa' ? 'Empresa Exemplo' : p.origem === 'nome' ? 'Maria Souza' : 'Maria'

  return <div className="page-content">
    <PageHeader title={id ? 'Editar campanha' : 'Nova campanha'} description="Escolha o modelo aprovado, defina quem recebe e salve. Antes de enviar, você revisa a lista exata de contatos." />
    {erroModelos && <Notice tone="warning">{erroModelos} Sem a lista da Meta não dá para escolher um modelo novo{id ? ' (o modelo atual da campanha continua valendo)' : ''}.</Notice>}
    <form aria-label="Dados da campanha" onSubmit={e => { e.preventDefault(); void salvar() }} style={{ display: 'grid', gap: 20, maxWidth: 780 }}>
      <label>Nome da campanha<input required maxLength={160} style={campo} value={nome} onChange={e => setNome(e.target.value)} /></label>
      <label>Objetivo (opcional)<input maxLength={1000} style={campo} value={objetivo} onChange={e => setObjetivo(e.target.value)} /></label>

      <fieldset style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, display: 'grid', gap: 12 }}>
        <legend style={{ fontWeight: 700 }}>Modelo da Meta</legend>
        {(!id || modelos.length > 0) && <label>Modelo aprovado
          <select required={!id} style={campo} value={modeloId} onChange={e => escolherModelo(e.target.value)}>
            <option value="">{id ? 'Manter o modelo atual' : 'Escolha…'}</option>
            {modelos.map(m => <option key={m.id} value={m.id} disabled={!m.compativel}>{m.nome} ({m.idioma}){m.compativel ? '' : ` — indisponível: ${m.motivo}`}</option>)}
          </select></label>}
        {modelo && <p style={{ margin: 0, padding: 10, background: 'var(--surface-subtle)', borderRadius: 8, whiteSpace: 'pre-wrap', fontSize: 14 }}>{previaDoModelo(modelo.campos, valoresExemplo)}</p>}
        {mapa.map((p, i) => <div key={`${p.tipo}${p.posicao}`} style={{ display: 'grid', gap: 6, gridTemplateColumns: 'minmax(120px,160px) 1fr', alignItems: 'center' }}>
          <span style={{ fontSize: 13 }}>{p.tipo === 'header' ? 'Título' : 'Texto'} · {`{{${p.posicao}}}`}</span>
          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select aria-label={`Valor de ${`{{${p.posicao}}}`} (${p.tipo})`} style={{ ...campo, width: 'auto' }} value={p.origem} onChange={e => mudaMapa(i, { origem: e.target.value as ParametroMapeado['origem'] })}>{ORIGENS.map(o => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}</select>
            {p.origem === 'fixo' && <input aria-label="Texto fixo" style={{ ...campo, flex: 1, width: 'auto', minWidth: 160 }} maxLength={200} value={p.valor ?? ''} onChange={e => mudaMapa(i, { valor: e.target.value })} />}
          </span>
        </div>)}
        {mapa.some(p => p.origem !== 'fixo') && <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>Quem não tiver o dado escolhido (por exemplo, sem nome) fica de fora da lista, com o motivo.</p>}
      </fieldset>

      <fieldset style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, display: 'grid', gap: 12 }}>
        <legend style={{ fontWeight: 700 }}>Quem recebe</legend>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>Só recebe quem tem autorização registrada e não pediu para parar. Sem filtros, vale para todos os autorizados.</p>
        <div><div style={{ fontSize: 13, marginBottom: 4 }}>Etapa do funil</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{funil.etapas.map(e => <label key={e.chave} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 14 }}>
            <input type="checkbox" checked={filtros.status?.includes(e.chave) ?? false} onChange={() => marcaEtapa(e.chave)} /> {e.rotulo}</label>)}</div></div>
        <label>Interesse<select style={campo} value={filtros.interesse ?? ''} onChange={e => setFiltros({ ...filtros, interesse: e.target.value || undefined })}><option value="">Qualquer</option>{servicos.map(s => <option key={s}>{s}</option>)}</select></label>
        <div><label>Contatos específicos (para um teste, escolha o seu próprio contato)
            <input style={campo} placeholder="Buscar por nome ou número" value={busca} onChange={e => setBusca(e.target.value)} /></label>
          {achados.length > 0 && busca.trim().length >= 2 && <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0', border: '1px solid var(--border)', borderRadius: 8 }}>
            {achados.map(c => <li key={c.id}><button type="button" onClick={() => adicionar(c)} style={{ ...botao, border: 'none', width: '100%', textAlign: 'left' }}>{c.nome || 'Sem nome'} · {c.whatsapp ?? 'sem WhatsApp'}</button></li>)}</ul>}
          {escolhidos.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>{escolhidos.map(c =>
            <span key={c.id} style={{ padding: '3px 8px', borderRadius: 999, background: 'var(--surface-subtle)', fontSize: 13 }}>{c.nome || c.whatsapp} <button type="button" aria-label={`Tirar ${c.nome || c.whatsapp}`} onClick={() => setEscolhidos(escolhidos.filter(x => x.id !== c.id))} style={{ border: 'none', background: 'none', cursor: 'pointer' }}>×</button></span>)}</div>}
        </div>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <label>Máximo de contatos<input type="number" min={1} max={100000} style={campo} value={limite} onChange={e => setLimite(Number(e.target.value))} /></label>
          <label>Não repetir para quem recebeu campanha nas últimas (horas)<input type="number" min={0} max={8760} style={campo} value={intervalo} onChange={e => setIntervalo(Number(e.target.value))} /></label>
        </div>
      </fieldset>

      {erro && <p role="alert" style={{ color: 'var(--danger)', margin: 0 }}>{erro}</p>}
      <div><button disabled={salvando || !nome.trim()} style={{ ...botao, background: 'var(--action)', color: 'var(--on-action)' }}><Save size={15} /> {salvando ? 'Salvando…' : 'Salvar e revisar o público'}</button></div>
    </form>
  </div>
}
