import ModalPortal from '../components/ModalPortal'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, X, Clock, User, BriefcaseMedical, ArrowRight, Ban,
  Check, UserX,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  diasDaSemana, fimDaConsulta, gradeDoMes, inicioDaConsulta, limitesDaGrade,
  procedimentoComInteresse, rotuloDoPeriodo, somarDias,
} from '../lib/agenda'
import { COR_SEM_PROFISSIONAL } from '../lib/cores'
import { STATUS_CONSULTA, ROTULO_CONSULTA } from '../lib/statusLead'
import { darBaixa } from '../lib/baixaConsulta'
import { formatarParaExibicao } from '../lib/telefones'
import AgendaSemana from '../components/AgendaSemana'
import AgendaMes from '../components/AgendaMes'
import NovoAgendamentoModal from '../components/NovoAgendamentoModal'
import type {
  ReuniaoAgenda, Profissional, ProfissionalBloqueio, ProfissionalHorario,
} from '../types'

/* ──────────────────────────────────────────────
   Agenda — todas as agendas da empresa no mesmo calendário.

   Não existe tabela de agenda: a agenda de um profissional são as consultas
   com o `profissional_id` dele. Cadastrar o profissional já cria a agenda, e a
   cor escolhida lá é a cor dos blocos aqui.
────────────────────────────────────────────── */

type Modo = 'semana' | 'mes'

/** Chave do filtro das consultas que ainda não têm profissional definido. */
const SEM_PROFISSIONAL = 'sem-profissional'

const SELECT_CONSULTAS = '*, lead:contatos_dados(id, nome, whatsapp)'

/* ──────────────────────────────────────────────
   Detalhe da consulta
────────────────────────────────────────────── */
function DetalheConsulta({
  consulta, profissional, onFechar, onCancelada,
}: {
  consulta: ReuniaoAgenda
  profissional: Profissional | undefined
  onFechar: () => void
  onCancelada: (c: ReuniaoAgenda) => void
}) {
  const navigate = useNavigate()
  const [cancelando, setCancelando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [dandoBaixa, setDandoBaixa] = useState(false)
  const [erro, setErro] = useState('')

  const inicio = inicioDaConsulta(consulta)
  const cor = profissional?.cor ?? COR_SEM_PROFISSIONAL.hex

  /**
   * A consulta já terminou? É o que troca "Cancelar" por "Compareceu / Faltou".
   *
   * Compara o FIM, não o começo: às 14h05 de uma consulta das 14h às 15h o
   * cliente está na cadeira, e perguntar se ele veio não faz sentido ainda.
   */
  // `Date.now()` solto no corpo do render é impuro, e o ESLint acusa com
  // razão: o valor mudaria a cada re-render. Aqui a hora é fotografada
  // quando o modal abre — que é exatamente o que se quer, já que o modal de
  // uma consulta vive alguns segundos.
  const [agora] = useState(() => Date.now())
  const jaAconteceu = fimDaConsulta(consulta).getTime() < agora

  /**
   * Compareceu ou faltou. Quem move o funil é o trigger
   * `consultas_sincroniza_lead` no banco — daqui só sai o status da consulta.
   */
  const handleBaixa = async (compareceu: boolean) => {
    setDandoBaixa(true); setErro('')
    try {
      await darBaixa(consulta.id, compareceu)
    } catch {
      setDandoBaixa(false)
      setErro('Não consegui salvar. Tente de novo.')
      return
    }
    setDandoBaixa(false)
    onCancelada({ ...consulta, status: compareceu ? 'realizada' : 'faltou' })
    onFechar()
  }

  const handleConfirmarPresenca=async()=>{
    setDandoBaixa(true);setErro('');try{const r=await supabase.rpc('reuniao_confirmar',{p_id:consulta.id});if(r.error)throw r.error;onCancelada({...consulta,confirmada_em:new Date().toISOString()});onFechar()}catch{setErro('Não foi possível confirmar a presença. Atualize a agenda.')}finally{setDandoBaixa(false)}
  }
  const handleCancelar = async () => {
    setCancelando(true); setErro('')
    const { error } = await supabase.from('reunioes')
      .update({ status: 'cancelada', cancelado_em: new Date().toISOString() })
      .eq('id', consulta.id)
    setCancelando(false)
    if (error) { setErro('Erro ao cancelar. Tente novamente.'); return }
    // O funil acompanha sozinho: o trigger `consultas_sincroniza_lead` devolve
    // o lead para "Consulta Cancelada" e limpa a data futura da ficha.
    onCancelada({ ...consulta, status: 'cancelada', cancelado_em: new Date().toISOString() })
    onFechar()
  }

  return (
    <ModalPortal label={"Detalhes da reunião"} onClose={onFechar} busy={cancelando || dandoBaixa}><div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={(e) => { if (e.target === e.currentTarget) onFechar() }}>
      <div style={{ background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)', width: '100%', maxWidth: 440, overflow: 'hidden', boxShadow: '0 8px 48px rgba(0,0,0,0.12)' }}>

        <div style={{ height: 5, background: cor }} />

        <div style={{ padding: '22px 26px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{consulta.lead?.nome ?? 'Sem nome'}</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3 }}>{procedimentoComInteresse(consulta)}</div>
            </div>
            <button onClick={onFechar} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, flexShrink: 0 }}>
              <X size={18} color="var(--muted)" />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: 'var(--text)' }}>
              <Clock size={14} color="var(--muted)" />
              {inicio.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}, {' '}
              {inicio.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} – {fimDaConsulta(consulta).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: 'var(--text)' }}>
              <BriefcaseMedical size={14} color="var(--muted)" />
              {profissional ? `${profissional.nome} ${profissional.sobrenome}`.trim() : 'Sem profissional definido'}
            </div>
            {consulta.lead?.whatsapp && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: 'var(--text)' }}>
                <User size={14} color="var(--muted)" /> {formatarParaExibicao(consulta.lead.whatsapp)}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              {/* Vem de `statusLead.ts`, e não de ternários aqui: com a
                  chegada de `faltou` (0015) um encadeamento local cairia no
                  `else` e pintaria a falta de verde. */}
              <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 600, marginLeft: 23,
                background: STATUS_CONSULTA[consulta.status].bg,
                color: STATUS_CONSULTA[consulta.status].color }}>
                {ROTULO_CONSULTA[consulta.status]}
              </span>
              {consulta.origem === 'agente_ia' && (
                <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 600, background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                  Agente de IA
                </span>
              )}
            </div>
            {consulta.status==='agendada'&&!jaAconteceu&&<div>{consulta.confirmada_em?<p>Presença confirmada</p>:<button disabled={dandoBaixa} onClick={()=>void handleConfirmarPresenca()}>Confirmar presença</button>}</div>}
            {consulta.observacoes && (
              <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, background: 'var(--surface-subtle)', borderRadius: 8, padding: '9px 12px', marginTop: 2 }}>
                {consulta.observacoes}
              </div>
            )}
          </div>

          {erro && (
            <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger-border)', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, color: 'var(--danger)', marginTop: 14 }}>{erro}</div>
          )}

          <div style={{ display: 'flex', gap: 9, marginTop: 20, flexWrap: 'wrap' }}>
            {consulta.lead && (
              <button onClick={() => navigate(`/leads/${consulta.lead!.id}`)}
                style={{ flex: 1, minWidth: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px', borderRadius: 9, border: 'none', background: 'var(--action)', color: 'var(--on-action)', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, fontFamily: "var(--font-body)" }}>
                Ver ficha <ArrowRight size={14} />
              </button>
            )}
            {/* Já passou da hora: a pergunta deixa de ser "cancelar?" e passa a
                ser "a pessoa veio?". É a baixa que promove o lead a Cliente. */}
            {consulta.status === 'agendada' && jaAconteceu && (
              <>
                <button onClick={() => handleBaixa(true)} disabled={dandoBaixa}
                  style={{ flex: 1, minWidth: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px', borderRadius: 9, border: 'none', background: 'var(--success-solid)', color: 'var(--on-solid)', cursor: dandoBaixa ? 'wait' : 'pointer', fontSize: 13.5, fontWeight: 600, fontFamily: "var(--font-body)" }}>
                  <Check size={14} /> Compareceu
                </button>
                <button onClick={() => handleBaixa(false)} disabled={dandoBaixa}
                  style={{ flex: 1, minWidth: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--muted)', cursor: dandoBaixa ? 'wait' : 'pointer', fontSize: 13.5, fontWeight: 600, fontFamily: "var(--font-body)" }}>
                  <UserX size={14} /> Faltou
                </button>
              </>
            )}
            {consulta.status === 'agendada' && !jaAconteceu && (
              confirmando ? (
                <button onClick={handleCancelar} disabled={cancelando}
                  style={{ flex: 1, minWidth: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px', borderRadius: 9, border: 'none', background: 'var(--danger-solid)', color: 'var(--on-solid)', cursor: cancelando ? 'not-allowed' : 'pointer', fontSize: 13.5, fontWeight: 600, fontFamily: "var(--font-body)" }}>
                  {cancelando ? 'Cancelando...' : 'Confirmar cancelamento'}
                </button>
              ) : (
                <button onClick={() => setConfirmando(true)}
                  style={{ flex: 1, minWidth: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--danger)', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, fontFamily: "var(--font-body)" }}>
                  <Ban size={14} /> Cancelar reunião
                </button>
              )
            )}
          </div>
        </div>
      </div>
    </div></ModalPortal>
  )
}

/* ──────────────────────────────────────────────
   Página
────────────────────────────────────────────── */
export default function Agenda() {
  const [modo, setModo] = useState<Modo>('semana')
  const [referencia, setReferencia] = useState(new Date())

  const [profissionais, setProfissionais] = useState<Profissional[]>([])
  const [horarios, setHorarios] = useState<ProfissionalHorario[]>([])
  const [bloqueios, setBloqueios] = useState<ProfissionalBloqueio[]>([])
  const [consultas, setConsultas] = useState<ReuniaoAgenda[]>([])

  const [visiveis, setVisiveis] = useState<Set<string>>(new Set())
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  const [modalNovo, setModalNovo] = useState<{ quando?: Date } | null>(null)
  const [detalhe, setDetalhe] = useState<ReuniaoAgenda | null>(null)

  /* Intervalo carregado: exatamente o que a visão atual desenha. */
  const intervalo = useMemo(() => {
    if (modo === 'semana') {
      const dias = diasDaSemana(referencia)
      return { inicio: dias[0], fim: somarDias(dias[6], 1) }
    }
    const dias = gradeDoMes(referencia)
    return { inicio: dias[0], fim: somarDias(dias[dias.length - 1], 1) }
  }, [modo, referencia])

  /* Profissionais, jornadas e bloqueios — carregam uma vez. */
  useEffect(() => {
    Promise.all([
      supabase.from('profissionais').select('*').order('nome'),
      supabase.from('profissional_horarios').select('*'),
      supabase.from('profissional_bloqueios').select('*'),
    ]).then(([{ data: profs }, { data: hors }, { data: blocs }]) => {
      const lista = (profs ?? []) as Profissional[]
      setProfissionais(lista)
      setHorarios((hors ?? []) as ProfissionalHorario[])
      setBloqueios((blocs ?? []) as ProfissionalBloqueio[])
      setVisiveis(new Set([...lista.map((p) => p.id), SEM_PROFISSIONAL]))
    })
  }, [])

  const carregarConsultas = useCallback(async () => {
    const { data, error } = await supabase.from('reunioes')
      .select(SELECT_CONSULTAS)
      .gte('data_reuniao', intervalo.inicio.toISOString())
      .lt('data_reuniao', intervalo.fim.toISOString())
      .order('data_reuniao')
    if (error) { setErro('Erro ao carregar a agenda. Recarregue a página.'); setCarregando(false); return }
    setErro('')
    setConsultas((data ?? []) as unknown as ReuniaoAgenda[])
    setCarregando(false)
  }, [intervalo])

  useEffect(() => { carregarConsultas() }, [carregarConsultas])

  /* Realtime: o Agente de IA marca pelo WhatsApp com a agenda aberta na
     recepção. Sem isto, a tela mente até alguém apertar F5.
     Recarrega o período em vez de aplicar o payload: o evento vem da tabela
     `consultas` e não traz o nome do cliente, que vem do join. */
  useEffect(() => {
    const canal = supabase
      .channel('agenda-reuniões')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consultas' }, () => { carregarConsultas() })
      // O nome exibido vem do join com o contato. Se a pessoa informa o nome
      // depois de a reunião entrar, atualizar só `consultas` deixa "Sem nome"
      // na tela até o próximo F5.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'contatos_dados' }, () => { carregarConsultas() })
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [carregarConsultas])

  const profissionaisPorId = useMemo(
    () => new Map(profissionais.map((p) => [p.id, p])),
    [profissionais],
  )

  const consultasVisiveis = useMemo(
    () => consultas.filter((c) => visiveis.has(c.profissional_id ?? SEM_PROFISSIONAL)),
    [consultas, visiveis],
  )

  /* A jornada das agendas visíveis, para a grade sombrear o que está fora
     dela. Vale com uma agenda filtrada ou com todas — antes valia só com uma,
     e no padrão da tela (todas visíveis) domingo não se distinguia de uma
     quarta. Sem nenhuma agenda real visível não há jornada a desenhar. */
  const idsVisiveisReais = [...visiveis].filter((v) => v !== SEM_PROFISSIONAL)
  const jornadaVisivel = idsVisiveisReais.length > 0
    ? horarios.filter((h) => idsVisiveisReais.includes(h.profissional_id))
    : undefined

  const limites = useMemo(() => {
    const relevantes = idsVisiveisReais.length > 0
      ? horarios.filter((h) => idsVisiveisReais.includes(h.profissional_id))
      : horarios
    return limitesDaGrade(relevantes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horarios, visiveis])

  const alternarVisivel = (id: string) => {
    setVisiveis((prev) => {
      const novo = new Set(prev)
      if (novo.has(id)) novo.delete(id)
      else novo.add(id)
      return novo
    })
  }

  const navegar = (passo: number) => {
    setReferencia((prev) => {
      if (modo === 'semana') return somarDias(prev, passo * 7)
      return new Date(prev.getFullYear(), prev.getMonth() + passo, 1)
    })
  }

  const temSemProfissional = consultas.some((c) => !c.profissional_id)
  const ativos = profissionais.filter((p) => p.ativo)

  const botaoIcone: React.CSSProperties = {
    width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
  }

  if (carregando) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '80vh' }}>
        <div style={{ width: 32, height: 32, border: '3px solid var(--accent-soft)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  return (
    <div className="page-content">

      {/* Header */}
      <div className="fade-in-1" style={{ marginBottom: 18, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <CalendarDays size={18} color="var(--accent)" strokeWidth={2} />
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Agenda</h1>
          </div>
          <p style={{ fontSize: 14, fontWeight: 400, color: 'var(--muted)', marginTop: 10, marginBottom: 0, lineHeight: 1.45 }}>
            Todos os agendamentos da empresa em um só lugar.
          </p>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8, marginBottom: 0, lineHeight: 1.6 }}>
            Visualize e organize as reuniões de todos os profissionais em um único calendário.
          </p>
        </div>

        <button onClick={() => setModalNovo({})}
          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: 'none', background: 'var(--action)', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: 'var(--on-action)', fontFamily: "var(--font-body)", flexShrink: 0 }}>
          <Plus size={15} /> Novo Agendamento
        </button>
      </div>

      {/* Barra de controle */}
      <div className="fade-in-2" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={() => navegar(-1)} style={botaoIcone} title="Anterior"><ChevronLeft size={16} color="var(--muted)" /></button>
          <button onClick={() => navegar(1)} style={botaoIcone} title="Próximo"><ChevronRight size={16} color="var(--muted)" /></button>
          <button onClick={() => setReferencia(new Date())}
            style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--muted)', fontFamily: "var(--font-body)" }}>
            Hoje
          </button>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginLeft: 4 }}>
            {rotuloDoPeriodo(referencia, modo)}
          </span>
        </div>

        <div style={{ display: 'inline-flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9, padding: 3, gap: 3 }}>
          {(['semana', 'mes'] as Modo[]).map((m) => (
            <button key={m} aria-pressed={modo === m} onClick={() => setModo(m)}
              style={{ padding: '6px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: "var(--font-body)", background: modo === m ? 'var(--action)' : 'transparent', color: modo === m ? 'var(--on-action)' : 'var(--muted)', transition: 'background 0.15s' }}>
              {m === 'semana' ? 'Semana' : 'Mês'}
            </button>
          ))}
        </div>
      </div>

      {/* Filtro por agenda */}
      {(ativos.length > 0 || temSemProfissional) && (
        <div className="fade-in-2" style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 14, flexWrap: 'wrap' }}>
          {ativos.map((p) => {
            const ligado = visiveis.has(p.id)
            return (
              <button key={p.id} aria-pressed={ligado} onClick={() => alternarVisivel(p.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7, padding: '6px 13px', borderRadius: 20, cursor: 'pointer',
                  border: `1px solid ${ligado ? p.cor : 'var(--border)'}`,
                  background: ligado ? 'var(--surface-subtle)' : 'var(--surface)',
                  color: 'var(--text)',
                  fontSize: 12.5, fontWeight: 600, fontFamily: "var(--font-body)", transition: 'all 0.15s',
                }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: ligado ? p.cor : 'var(--border)', display: 'inline-block' }} />
                {p.nome} {p.sobrenome}
              </button>
            )
          })}

          {temSemProfissional && (
            <button aria-pressed={visiveis.has(SEM_PROFISSIONAL)} onClick={() => alternarVisivel(SEM_PROFISSIONAL)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7, padding: '6px 13px', borderRadius: 20, cursor: 'pointer',
                border: `1px dashed ${visiveis.has(SEM_PROFISSIONAL) ? COR_SEM_PROFISSIONAL.hex : 'var(--border)'}`,
                background: 'var(--surface)',
                color: visiveis.has(SEM_PROFISSIONAL) ? 'var(--text)' : 'var(--muted)',
                fontSize: 12.5, fontWeight: 600, fontFamily: "var(--font-body)",
              }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: COR_SEM_PROFISSIONAL.hex, display: 'inline-block' }} />
              Sem profissional
            </button>
          )}
        </div>
      )}

      {erro && (
        <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger-border)', borderRadius: 9, padding: '10px 14px', fontSize: 13, color: 'var(--danger)', marginBottom: 14 }}>{erro}</div>
      )}

      {/* Sem profissionais ainda */}
      {profissionais.length === 0 ? (
        <div className="fade-in-3" style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '48px 24px', textAlign: 'center' }}>
          <CalendarDays size={34} strokeWidth={1.2} color="var(--muted)" style={{ marginBottom: 10 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Nenhuma agenda ainda</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6, lineHeight: 1.6, maxWidth: 400, marginInline: 'auto' }}>
            A agenda de um profissional nasce junto com o cadastro dele. Cadastre o primeiro especialista para o calendário ganhar conteúdo.
          </div>
          <Link to="/profissionais"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 18, padding: '9px 16px', borderRadius: 9, background: 'var(--action)', color: 'var(--on-action)', textDecoration: 'none', fontSize: 13.5, fontWeight: 600 }}>
            <BriefcaseMedical size={15} /> Cadastrar profissional
          </Link>
        </div>
      ) : (
        <div className="fade-in-3 calendar-scroll" role="region" aria-label="Calendário de reuniões" tabIndex={0}>
          {modo === 'semana' ? (
            <AgendaSemana
              dias={diasDaSemana(referencia)}
              consultas={consultasVisiveis}
              profissionaisPorId={profissionaisPorId}
              limites={limites}
              jornadaVisivel={jornadaVisivel}
              onClickConsulta={setDetalhe}
              onClickHorarioVazio={(quando) => setModalNovo({ quando })}
            />
          ) : (
            <AgendaMes
              referencia={referencia}
              consultas={consultasVisiveis}
              profissionaisPorId={profissionaisPorId}
              onClickConsulta={setDetalhe}
              onClickDia={(dia) => { setReferencia(dia); setModo('semana') }}
            />
          )}
        </div>
      )}

      {modalNovo && (
        <NovoAgendamentoModal
          profissionais={profissionais}
          horarios={horarios}
          bloqueios={bloqueios}
          consultas={consultas}
          dataInicial={modalNovo.quando}
          profissionalInicial={idsVisiveisReais.length === 1 ? idsVisiveisReais[0] : null}
          onClose={() => setModalNovo(null)}
          onSalvo={(c) => setConsultas((prev) => [...prev, c])}
        />
      )}

      {detalhe && (
        <DetalheConsulta
          consulta={detalhe}
          profissional={detalhe.profissional_id ? profissionaisPorId.get(detalhe.profissional_id) : undefined}
          onFechar={() => setDetalhe(null)}
          onCancelada={(c) => setConsultas((prev) => prev.map((x) => (x.id === c.id ? c : x)))}
        />
      )}
    </div>
  )
}
