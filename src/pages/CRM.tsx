import { Button, PageHeader, LoadingState } from '../components/ui'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core'
import { ArrowRight, CheckCircle2, GripVertical, XCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { moeda, listarOportunidades, erroOportunidade, type Oportunidade } from '../lib/oportunidades'
import { useFunil } from '../lib/funil'
import { EditorOportunidade } from '../components/Oportunidades'
import FiltroPeriodo from '../components/FiltroPeriodo'
import { getPeriodRange, inRange, type DateRange, type PeriodKey } from '../lib/periodo'
import type { LeadStatus } from '../types'
import './CRM.css'

type Visao = 'abertas' | 'ganhas' | 'perdidas'

function Cartao({ oportunidade: o, abrir, registrarVenda, marcarPerdida }: { oportunidade: Oportunidade; abrir: () => void; registrarVenda: () => void; marcarPerdida: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: o.id })
  return <article className="crm-deal-card kanban-card" ref={setNodeRef} style={{ zIndex: isDragging ? 5 : 0, opacity: isDragging ? .7 : 1, transform: transform ? `translate3d(${transform.x}px,${transform.y}px,0)` : undefined }}>
    <div className="crm-deal-heading"><button className="crm-drag" aria-label={`Mover ${o.nome}`} {...attributes} {...listeners}><GripVertical size={17} /></button><button className="crm-deal-title" onClick={abrir}>{o.nome}</button></div>
    <Link className="crm-deal-contact" to={`/leads/${o.contato_id}`}>{o.contato?.empresa || o.contato?.nome || 'Abrir contato'}</Link>
    <div className="crm-deal-detail"><strong>{moeda(o.valor_proposta)}</strong><span>{o.servicos_contratados.join(', ') || 'Serviço a definir'}</span></div>
    <div className="crm-deal-actions"><button onClick={registrarVenda}>Registrar venda</button><button onClick={marcarPerdida}>Marcar perdida</button></div>
  </article>
}
function Coluna({ status, lista, abrir, registrarVenda, marcarPerdida }: { status: LeadStatus; lista: Oportunidade[]; abrir: (o: Oportunidade) => void; registrarVenda: (o: Oportunidade) => void; marcarPerdida: (o: Oportunidade) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const funil = useFunil()
  const [limite, setLimite] = useState(50)
  return <section ref={setNodeRef} className={`crm-stage${isOver ? ' is-over' : ''}`} aria-label={funil.rotulo(status)}>
    <div className="crm-stage-heading"><span className="crm-stage-dot" style={{ background: funil.estilo(status).color }} /><h2>{funil.rotulo(status)}</h2><span className="crm-stage-count">{lista.length}</span></div>
    {lista.slice(0, limite).map(o => <Cartao key={o.id} oportunidade={o} abrir={() => abrir(o)} registrarVenda={() => registrarVenda(o)} marcarPerdida={() => marcarPerdida(o)} />)}
    {!lista.length && <p className="crm-stage-empty">Nenhuma negociação nesta etapa.</p>}
    {lista.length > limite && <button className="crm-more" onClick={() => setLimite(v => v + 50)}>Mostrar mais ({lista.length - limite})</button>}
  </section>
}
export default function CRM() {
  const funil = useFunil()
  const ETAPAS_ABERTAS: LeadStatus[] = funil.abertas.map(e => e.chave)
  const [lista, setLista] = useState<Oportunidade[]>([])
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState<{ oportunidade: Oportunidade; statusInicial?: LeadStatus } | null>(null)
  const [visao, setVisao] = useState<Visao>('abertas')
  const [busca, setBusca] = useState('')
  const [periodo, setPeriodo] = useState<PeriodKey>('all')
  const [faixa, setFaixa] = useState<DateRange>({ start: new Date(), end: new Date() })
  const [salvando, setSalvando] = useState(false)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor))
  const carregar = useCallback(async () => {
    try { setLista(await listarOportunidades()); setErro('') }
    catch { setErro('Não foi possível carregar as oportunidades. Tente atualizar.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => {
    void carregar()
    const canal = supabase.channel('crm-oportunidades').on('postgres_changes', { event: '*', schema: 'public', table: 'oportunidades' }, () => { void carregar() }).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'contatos_dados' }, () => { void carregar() }).subscribe()
    return () => { void supabase.removeChannel(canal) }
  }, [carregar])
  async function mover({ active, over }: DragEndEvent) {
    const o = lista.find(x => x.id === active.id)
    const etapa = over?.id as LeadStatus
    if (salvando || !o || !ETAPAS_ABERTAS.includes(etapa) || etapa === o.status) return
    setSalvando(true)
    try {
      const { data, error } = await supabase.from('oportunidades').update({ status: etapa }).eq('id', o.id).eq('updated_at', o.updated_at).select('id').maybeSingle()
      if (error || !data) setErro(erroOportunidade(error))
      else await carregar()
    } catch { setErro('Falha de conexão ao mover a oportunidade.') }
    finally { setSalvando(false) }
  }
  const filtrados = lista.filter(o => inRange(o.created_at, getPeriodRange(periodo, faixa)) && `${o.nome} ${o.contato?.nome ?? ''} ${o.contato?.empresa ?? ''}`.toLowerCase().includes(busca.toLowerCase()))
  const abertas = filtrados.filter(o => ETAPAS_ABERTAS.includes(o.status))
  const ganhas = filtrados.filter(o => o.status === 'ganho')
  const perdidas = filtrados.filter(o => o.status === 'perdido')
  const encerradas = visao === 'ganhas' ? ganhas : perdidas
  return <div className="page-content commercial-page crm-page">
    <PageHeader title="CRM · Oportunidades" description="Cada cartão é uma possível venda. Acompanhe a negociação até registrar o resultado." actions={<Link className="arc-button arc-button-primary" to="/leads">Criar oportunidade em um contato</Link>} />
    <div className="crm-overview" aria-label="Como funciona o CRM"><span><strong>1. Contato</strong><small>Quem pode comprar</small></span><ArrowRight size={16} /><span><strong>2. Oportunidade</strong><small>O que está sendo negociado</small></span><ArrowRight size={16} /><span><strong>3. Venda</strong><small>Quando a proposta é aceita</small></span><ArrowRight size={16} /><span><strong>4. Projeto</strong><small>O trabalho a entregar</small></span></div>
    <div className="crm-toolbar"><input aria-label="Buscar oportunidades" placeholder="Buscar oportunidade, contato ou empresa" value={busca} onChange={e => setBusca(e.target.value)} /><Button onClick={() => void carregar()}>Atualizar</Button><FiltroPeriodo periodo={periodo} onPeriodo={setPeriodo} faixa={faixa} onFaixa={setFaixa} /></div>
    {periodo !== 'all' && <p className="crm-period-note">O período considera a data em que a oportunidade foi criada.</p>}
    <div className="crm-views" role="tablist" aria-label="Situação das oportunidades">
      <button role="tab" aria-selected={visao === 'abertas'} className={visao === 'abertas' ? 'is-active' : ''} onClick={() => setVisao('abertas')}><span>Em negociação</span><strong>{abertas.length}</strong></button>
      <button role="tab" aria-selected={visao === 'ganhas'} className={visao === 'ganhas' ? 'is-active' : ''} onClick={() => setVisao('ganhas')}><span>Vendas ganhas</span><strong>{ganhas.length}</strong></button>
      <button role="tab" aria-selected={visao === 'perdidas'} className={visao === 'perdidas' ? 'is-active' : ''} onClick={() => setVisao('perdidas')}><span>Não fechadas</span><strong>{perdidas.length}</strong></button>
    </div>
    {erro && <p role="alert" style={{ color: 'var(--warning)', margin: 0 }}>{erro}</p>}
    {loading ? <LoadingState label="Carregando oportunidades…" /> : visao === 'abertas' ? <section className="crm-workspace" aria-label="Negociações em andamento"><div className="crm-section-heading"><h2>Negociações em andamento</h2><p>Arraste o cartão entre as etapas ou abra a oportunidade para editar. Use “Registrar venda” quando o cliente aceitar.</p></div><DndContext sensors={sensors} onDragEnd={mover}><div className="kanban-board crm-board" role="region" aria-label="Etapas da negociação" tabIndex={0}>{ETAPAS_ABERTAS.map(status => <Coluna key={status} status={status} lista={abertas.filter(o => o.status === status)} abrir={o => setEditor({ oportunidade: o })} registrarVenda={o => setEditor({ oportunidade: o, statusInicial: 'ganho' })} marcarPerdida={o => setEditor({ oportunidade: o, statusInicial: 'perdido' })} />)}</div></DndContext></section> : <section className="crm-results" aria-label={visao === 'ganhas' ? 'Vendas ganhas' : 'Negociações não fechadas'}><div className="crm-section-heading"><h2>{visao === 'ganhas' ? 'Vendas ganhas' : 'Negociações não fechadas'}</h2><p>{visao === 'ganhas' ? 'Cada venda ganha gera um projeto para acompanhar a entrega.' : 'O contato continua cadastrado. Uma nova compra pode começar com outra oportunidade.'}</p></div>{encerradas.length ? <div className="crm-results-list">{encerradas.map(o => <article className="crm-result" key={o.id}><span className={`crm-result-icon ${visao === 'ganhas' ? 'is-won' : 'is-lost'}`}>{visao === 'ganhas' ? <CheckCircle2 size={19} /> : <XCircle size={19} />}</span><div className="crm-result-main"><strong>{o.nome}</strong><Link to={`/leads/${o.contato_id}`}>{o.contato?.empresa || o.contato?.nome || 'Abrir contato'}</Link><small>{o.cancelado_em ? 'Venda cancelada' : o.servicos_contratados.join(', ') || 'Serviço não informado'}</small></div><strong className="crm-result-value">{moeda(o.valor_proposta)}</strong><div className="crm-result-actions"><button onClick={() => setEditor({ oportunidade: o })}>Ver detalhes</button>{o.fechado_em && <Link to={`/projetos?oportunidade=${o.id}`}>Ver projeto</Link>}</div></article>)}</div> : <div className="crm-results-empty">{visao === 'ganhas' ? 'Nenhuma venda ganha neste filtro.' : 'Nenhuma negociação não fechada neste filtro.'}</div>}</section>}
    {editor && <EditorOportunidade key={`${editor.oportunidade.id}-${editor.statusInicial ?? 'editar'}`} oportunidade={editor.oportunidade} leadId={editor.oportunidade.contato_id} statusInicial={editor.statusInicial} onClose={() => setEditor(null)} onSaved={() => void carregar()} />}
  </div>
}
