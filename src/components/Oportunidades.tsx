import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { moeda, erroOportunidade, listarOportunidades, type Oportunidade } from '../lib/oportunidades'
import { useFunil } from '../lib/funil'
import { moduloAtivo } from '../lib/modulos'
import type { LeadStatus } from '../types'
import ModalPortal from './ModalPortal'
import { useSessao } from '../lib/sessao'
import './Oportunidades.css'

const campo = { width: '100%', padding: 10, border: '1px solid var(--border)', borderRadius: 8, font: 'inherit', boxSizing: 'border-box' as const }
const botao = { padding: '9px 14px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--accent)', cursor: 'pointer', font: 'inherit' }

export function EditorOportunidade({ oportunidade, leadId, statusInicial, onClose, onSaved }: { oportunidade?: Oportunidade; leadId: string; statusInicial?: LeadStatus; onClose: () => void; onSaved: () => void }) {
  const funil = useFunil()
  // Cancelar mexe em histórico financeiro: o valor sai das vendas ganhas e o
  // projeto fica marcado para revisão. O gatilho da 0034 recusa quem não é
  // gestor; esconder o botão só evita o erro depois de digitar o motivo.
  const { gestor } = useSessao()
  const [nome, setNome] = useState(oportunidade?.nome ?? '')
  const [status, setStatus] = useState<LeadStatus>(statusInicial ?? oportunidade?.status ?? 'novo_lead')
  const [valor, setValor] = useState(oportunidade?.valor_proposta == null ? '' : String(oportunidade.valor_proposta))
  const [servicos, setServicos] = useState(oportunidade?.servicos_contratados ?? [])
  const [escopo, setEscopo] = useState(oportunidade?.escopo ?? '')
  const [catalogo, setCatalogo] = useState<string[]>([])
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [eventos, setEventos] = useState<{ id: string; status_novo: LeadStatus; created_at: string; motivo: string | null }[]>([])
  const encerrada = !!oportunidade?.fechado_em
  useEffect(() => {
    let vivo = true
    void supabase.from('catalogo_servicos').select('nome').eq('ativo', true).eq('arquivado', false).eq('e_reuniao_previa', false).order('nome').then(({ data, error }) => {
      if (!vivo) return
      if (error) setErro('Não foi possível carregar os serviços.')
      else setCatalogo(data.map(s => s.nome))
    })
    if (oportunidade) void supabase.from('oportunidade_eventos').select('id,status_novo,created_at,motivo').eq('oportunidade_id', oportunidade.id).order('created_at', { ascending: false }).limit(20).then(({ data, error }) => {
      if (vivo) { if (error) setErro('Não foi possível carregar o histórico.'); else setEventos(data ?? []) }
    })
    return () => { vivo = false }
  }, [oportunidade])

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    const numero = valor.trim() ? Number(valor.replace(',', '.')) : null
    if (numero !== null && (!Number.isFinite(numero) || numero < 0)) { setErro('Informe um valor válido.'); return }
    if (!cancelando && status === 'ganho' && !encerrada && (numero === null || !servicos.length)) { setErro('Informe o valor e os serviços contratados antes de marcar Ganho.'); return }
    if (cancelando && motivo.trim().length < 5) { setErro('Descreva o motivo do cancelamento (mínimo de 5 caracteres).'); return }
    setSalvando(true); setErro('')
    try {
      const campos = cancelando ? { status: 'perdido', motivo_cancelamento: motivo.trim() } : { nome: nome.trim(), status, valor_proposta: numero, servicos_contratados: servicos, escopo }
      const q = oportunidade
        ? supabase.from('oportunidades').update(campos).eq('id', oportunidade.id).eq('updated_at', oportunidade.updated_at)
        : supabase.from('oportunidades').insert({ ...campos, contato_id: leadId })
      const { data, error } = await q.select('id').maybeSingle()
      if (error || !data) { setErro(erroOportunidade(error)); return }
      onSaved(); onClose()
    } catch { setErro('Falha de conexão. Tente novamente.') }
    finally { setSalvando(false) }
  }
  return <ModalPortal label={oportunidade ? "Oportunidade" : "Nova oportunidade"} onClose={onClose} busy={salvando}><div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', zIndex: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
    <form aria-label="Oportunidade" onSubmit={salvar} style={{ background: 'var(--surface)', padding: 24, borderRadius: 14, width: 560, maxWidth: '100%', maxHeight: '90dvh', overflowY: 'auto', display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><h2 style={{ margin: 0 }}>{oportunidade ? 'Oportunidade' : 'Nova oportunidade'}</h2><button type="button" style={botao} disabled={salvando} onClick={onClose}>Fechar</button></div>
      {encerrada && <p>Venda encerrada. Para outra compra, crie uma nova oportunidade. O histórico é preservado em caso de cancelamento.</p>}
      <label>Nome da oportunidade<input autoFocus required maxLength={160} disabled={encerrada || salvando} style={campo} value={nome} onChange={e => setNome(e.target.value)} /></label>
      <label>Etapa<select aria-label="Etapa" style={campo} disabled={encerrada || salvando} value={status} onChange={e => setStatus(e.target.value as LeadStatus)}>{funil.etapas.map(e => <option key={e.chave} value={e.chave}>{e.rotulo}</option>)}</select></label>
      <label>Valor da proposta (R$)<input type="number" min="0" max="999999999999.99" step="0.01" disabled={encerrada || salvando} style={campo} value={valor} onChange={e => setValor(e.target.value)} /></label>
      <fieldset disabled={encerrada || salvando} style={{ border: '1px solid var(--border)', borderRadius: 8 }}><legend>Serviços desta contratação</legend>{[...new Set([...catalogo, ...servicos])].map(s => <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0' }}><input type="checkbox" checked={servicos.includes(s)} onChange={e => setServicos(e.target.checked ? [...servicos, s] : servicos.filter(x => x !== s))} />{s}</label>)}{!catalogo.length && !servicos.length && <p>Nenhum serviço disponível. Confira o catálogo.</p>}</fieldset>
      <label>Escopo<textarea rows={4} disabled={encerrada || salvando} style={campo} value={escopo} onChange={e => setEscopo(e.target.value)} /></label>
      {oportunidade?.status === 'ganho' && !cancelando && (gestor
        ? <button type="button" style={botao} onClick={() => setCancelando(true)}>Cancelar venda</button>
        : <small style={{ color: 'var(--muted)' }}>Cancelar esta venda é ação de gestor: ela tira o valor das vendas ganhas.</small>)}
      {cancelando && <label>Motivo do cancelamento<textarea required minLength={5} style={campo} value={motivo} onChange={e => setMotivo(e.target.value)} /><small>O valor deixará de compor as vendas ganhas. O projeto será mantido para revisão.</small></label>}
      {erro && <p role="alert" style={{ color: 'var(--danger)' }}>{erro}</p>}
      {(!encerrada || cancelando) && <button disabled={salvando || !nome.trim()} style={{ ...botao, background: cancelando ? 'var(--danger-solid)' : 'var(--action)', color: cancelando ? 'var(--on-solid)' : 'var(--on-action)' }}>{salvando ? 'Salvando…' : cancelando ? 'Confirmar cancelamento da venda' : 'Salvar oportunidade'}</button>}
      {eventos.length > 0 && <div><h3>Histórico de etapas</h3>{eventos.map(e => <p key={e.id} style={{ fontSize: 13 }}>{new Date(e.created_at).toLocaleString('pt-BR')} · {funil.rotulo(e.status_novo)}{e.motivo ? ` — ${e.motivo}` : ''}</p>)}</div>}
    </form>
  </div></ModalPortal>
}

export default function Oportunidades({ leadId }: { leadId: string }) {
  const funil = useFunil()
  const [lista, setLista] = useState<Oportunidade[]>([])
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [editor, setEditor] = useState<Oportunidade | 'nova' | null>(null)
  const carregar = useCallback(async () => {
    try { setLista(await listarOportunidades(leadId)); setErro('') }
    catch { setErro('Não foi possível carregar as oportunidades.') }
    finally { setCarregando(false) }
  }, [leadId])
  useEffect(() => {
    void carregar()
    const canal = supabase.channel(`oportunidades-${leadId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'oportunidades', filter: `contato_id=eq.${leadId}` }, () => { void carregar() }).subscribe()
    return () => { void supabase.removeChannel(canal) }
  }, [carregar, leadId])
  const emNegociacao = lista.filter(o => o.status !== 'ganho' && o.status !== 'perdido')
  const concluidas = lista.filter(o => o.status === 'ganho' || o.status === 'perdido')
  const linha = (o: Oportunidade) => <article className="contact-deal" key={o.id}>
    <div className="contact-deal-main"><strong>{o.nome}</strong><span className={`contact-deal-status ${o.status === 'ganho' ? 'is-won' : o.status === 'perdido' ? 'is-lost' : ''}`}>{o.cancelado_em ? 'Venda cancelada' : funil.rotulo(o.status)}</span><small>{o.servicos_contratados.join(', ') || 'Serviço a definir'}</small></div>
    <strong className="contact-deal-value">{moeda(o.valor_proposta)}</strong>
    <div className="contact-deal-actions"><button onClick={() => setEditor(o)}>Abrir</button>{o.fechado_em && moduloAtivo('projetos') && <Link to={`/projetos?oportunidade=${o.id}`}>Ver projeto</Link>}</div>
  </article>
  return <section className="contact-deals">
    <div className="contact-deals-heading"><div><h2>Oportunidades e vendas</h2><p>Uma oportunidade para cada possível contratação deste contato.</p></div><button onClick={() => setEditor('nova')}>+ Nova oportunidade</button></div>
    {erro && <p role="alert">{erro} <button style={botao} onClick={() => void carregar()}>Tentar novamente</button></p>}
    {carregando ? <p>Carregando…</p> : <div className="contact-deals-groups"><div><h3>Em negociação <span>{emNegociacao.length}</span></h3>{emNegociacao.length ? emNegociacao.map(linha) : <p className="contact-deals-empty">Nenhuma negociação em andamento.</p>}</div><div><h3>Histórico de resultados <span>{concluidas.length}</span></h3>{concluidas.length ? concluidas.map(linha) : <p className="contact-deals-empty">Nenhuma venda ou negociação perdida ainda.</p>}</div></div>}
    {!carregando && !lista.length && !erro && <p>Nenhuma oportunidade cadastrada.</p>}
    {editor && <EditorOportunidade oportunidade={editor === 'nova' ? undefined : editor} leadId={leadId} onClose={() => setEditor(null)} onSaved={() => void carregar()} />}
  </section>
}
