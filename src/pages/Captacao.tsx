import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, EmptyState, LoadingState, Notice, PageHeader } from '../components/ui'
import { supabase } from '../lib/supabase'
import { useSessao } from '../lib/sessao'
import RelatorioOrigens from '../components/RelatorioOrigens'
import ReferenciaCaptacao from '../components/ReferenciaCaptacao'
import './Captacao.css'

interface Fonte { id: string; nome: string; ativa: boolean; codigo_ref: string | null; utm_ref: Record<string,string> }
interface Recebimento { id: string; fonte_id: string; resultado: string; motivo: string | null; recebido_em: string; utm: Record<string, string>; contato_id: string | null; contato: { nome: string | null } | null }
const ROTULO: Record<string,string> = { criado: 'Novo lead', existente: 'Contato já existente', recusado: 'Recusado' }
const MOTIVO: Record<string,string> = { formato_invalido: 'Formato inválido', telefone_invalido: 'Telefone inválido ou sem DDD', email_invalido: 'E-mail inválido', campo_longo: 'Campo acima do limite' }
const CAMPOS = 'id,fonte_id,resultado,motivo,recebido_em,utm,contato_id,contato:contatos_dados(nome)'

async function criarSegredo() {
  const segredo = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(segredo))), b => b.toString(16).padStart(2, '0')).join('')
  return { segredo, hash }
}

export default function Captacao() {
  const { gestor } = useSessao()
  const [fontes, setFontes] = useState<Fonte[]>([])
  const [linhas, setLinhas] = useState<Recebimento[]>([])
  const [fonte, setFonte] = useState('')
  const [resultado, setResultado] = useState('')
  const [pagina, setPagina] = useState(0)
  const [total, setTotal] = useState(0)
  const [nome, setNome] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [credencial, setCredencial] = useState<{ id: string; segredo: string } | null>(null)
  const [revisao, setRevisao] = useState(0)

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('')
    let query = supabase.from('captacao_recebimentos').select(CAMPOS, { count: 'exact' }).order('recebido_em', { ascending: false }).order('id').range(pagina * 50, pagina * 50 + 49)
    if (fonte) query = query.eq('fonte_id', fonte)
    if (resultado) query = query.eq('resultado', resultado)
    const [f, r] = await Promise.all([supabase.from('captacao_fontes').select('id,nome,ativa,codigo_ref,utm_ref').order('criada_em'), query])
    if (f.error || r.error) { setErro('Não foi possível carregar os recebimentos.'); setLinhas([]) }
    else { setFontes(f.data ?? []); setLinhas((r.data ?? []) as unknown as Recebimento[]); setTotal(r.count ?? 0) }
    setCarregando(false)
  }, [fonte, resultado, pagina])
  useEffect(() => { void carregar() }, [carregar, revisao])

  async function criar(e: React.FormEvent) {
    e.preventDefault(); setSalvando(true); setErro('')
    try {
      const { segredo, hash } = await criarSegredo()
      const r = await supabase.rpc('captacao_criar_fonte', { p_nome: nome.trim(), p_hash: hash })
      if (r.error) throw r.error
      setCredencial({ id: r.data, segredo }); setNome(''); setRevisao(v => v + 1)
    } catch { setErro('Não foi possível criar a fonte.') }
    finally { setSalvando(false) }
  }
  async function configurar(f: Fonte, renovar = false) {
    setSalvando(true); setErro('')
    try {
      const novo = renovar ? await criarSegredo() : null
      const r = await supabase.rpc('captacao_configurar_fonte', { p_id: f.id, p_ativa: renovar ? f.ativa : !f.ativa, p_hash: novo?.hash ?? null })
      if (r.error) throw r.error
      if (novo) setCredencial({ id: f.id, segredo: novo.segredo })
      setRevisao(v => v + 1)
    } catch { setErro('Não foi possível configurar a fonte.') }
    finally { setSalvando(false) }
  }
  const endpoint = (id: string) => `${String(import.meta.env.VITE_SUPABASE_URL).replace(/\/$/, '')}/functions/v1/captacao/receber/${id}`

  return <div className="page-content captacao-page">
    <PageHeader eyebrow="Entrada de contatos" title="Leads recebidos" description="Acompanhe os formulários recebidos, os contatos já existentes e as recusas." actions={<Button disabled={carregando} onClick={() => setRevisao(v => v + 1)}>Atualizar</Button>} />
    {erro && <Notice tone="danger">{erro}</Notice>}
    {gestor && <Card className="captacao-fontes">
      <h2>Fontes de formulários</h2>
      <p>Cada fonte nasce desligada. Configure o envio no servidor do site e ative depois de revisar.</p>
      <form onSubmit={e => void criar(e)} className="captacao-filtros">
        <label>Nome da fonte<input required maxLength={100} value={nome} onChange={e => setNome(e.target.value)} placeholder="Formulário do site" /></label>
        <Button type="submit" variant="primary" disabled={salvando || !nome.trim() || !!credencial}>Criar fonte</Button>
      </form>
      {credencial && <div className="captacao-credencial">
        <Notice tone="warning">Guarde este segredo no servidor do site. Ele aparece somente nesta sessão. Um novo segredo invalida o anterior.</Notice>
        <label>Endereço de recebimento<input readOnly value={endpoint(credencial.id)} /></label>
        <label>Segredo da fonte<input readOnly value={credencial.segredo} /></label>
        <p>Envie o segredo no cabeçalho <code>X-Captacao-Segredo</code>. O formulário deve enviar nome, whatsapp e, opcionalmente, email, empresa, id_externo e campos utm_*.</p>
        <Button onClick={() => setCredencial(null)}>Já guardei o segredo</Button>
      </div>}
      <ul className="captacao-lista-fontes">{fontes.map(f => <li key={f.id}>
        <div><strong>{f.nome}</strong><small>{f.ativa ? 'Ativa' : 'Desligada'}</small><input aria-label={`Endereço de ${f.nome}`} readOnly value={endpoint(f.id)} /></div>
        <Button disabled={salvando} onClick={() => void configurar(f)}>{f.ativa ? 'Desligar' : 'Ativar'} {f.nome}</Button>
        <Button disabled={salvando || !!credencial} onClick={() => void configurar(f, true)}>Novo segredo de {f.nome}</Button>
        <ReferenciaCaptacao key={`${f.id}:${f.codigo_ref}`} fonte={f} />
      </li>)}</ul>
    </Card>}
    <RelatorioOrigens />
    <div className="captacao-filtros">
      <label>Fonte<select aria-label="Fonte" value={fonte} onChange={e => { setFonte(e.target.value); setPagina(0) }}><option value="">Todas as fontes</option>{fontes.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></label>
      <label>Resultado<select aria-label="Resultado" value={resultado} onChange={e => { setResultado(e.target.value); setPagina(0) }}><option value="">Todos os resultados</option>{Object.entries(ROTULO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    </div>
    {carregando ? <LoadingState /> : <Card>
      {linhas.length === 0 ? <EmptyState title="Nenhum formulário recebido">Os recebimentos das fontes ativas aparecerão aqui.</EmptyState> : <>
        <p>{total} recebimento(s) neste filtro</p>
        <ul className="captacao-recebimentos">{linhas.map(r => <li key={r.id}>
          <div><strong>{r.contato_id ? <Link to={`/leads/${r.contato_id}`}>{r.contato?.nome || 'Contato sem nome'}</Link> : 'Formulário recusado'}</strong>
            <small>{fontes.find(f => f.id === r.fonte_id)?.nome || 'Fonte'} · {new Date(r.recebido_em).toLocaleString('pt-BR')}</small>
            {Object.keys(r.utm).length > 0 && <small>{Object.entries(r.utm).map(([k,v]) => `${k.replace('utm_', '')}: ${v}`).join(' · ')}</small>}
          </div><span>{ROTULO[r.resultado]}{r.motivo && ` · ${MOTIVO[r.motivo] ?? 'Confira os campos'}`}</span>
        </li>)}</ul>
      </>}
      <div className="captacao-filtros"><Button disabled={pagina === 0} onClick={() => setPagina(v => v - 1)}>Anterior</Button><span>Página {pagina + 1}</span><Button disabled={(pagina + 1) * 50 >= total} onClick={() => setPagina(v => v + 1)}>Próxima</Button></div>
    </Card>}
  </div>
}
