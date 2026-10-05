import ModalPortal from '../components/ModalPortal'
import OportunidadeReuniao from '../components/OportunidadeReuniao'
import CamposDoContato from '../components/CamposPersonalizados'
import PrivacidadeContato from '../components/PrivacidadeContato'
import Oportunidades from '../components/Oportunidades'
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Phone, Clock, Save, Plus, X, CalendarDays, ClipboardList, MessagesSquare, History, Tag, ListChecks } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { isCliente } from '../lib/pessoas'
import { formatarParaExibicao } from '../lib/telefones'
import { useCatalogoProcedimentos } from '../lib/procedimentos'
import { buscarPorWhatsapp, ERRO_DUPLICADO, type PessoaResumo } from '../lib/contatos'
import { STATUS_CONSULTA, ROTULO_CONSULTA } from '../lib/statusLead'
import { useFunil } from '../lib/funil'
import { moduloAtivo } from '../lib/modulos'
import { motivoForaDaJornada } from '../lib/agenda'
import CampoTelefone from '../components/CampoTelefone'
import ApagarEstaPessoa from '../components/ApagarEstaPessoa'
import ConsentimentoMarketing from '../components/ConsentimentoMarketing'
import LinhaDoTempo from '../components/LinhaDoTempo'
import OrigemDoContato from '../components/OrigemDoContato'
import EtiquetasDoContato from '../components/EtiquetasDoContato'
import { TarefasDoContato } from '../components/Tarefas'
import type { Contato, Consulta, ReuniaoStatus, Profissional, ProfissionalHorario } from '../types'

/* ──────────────────────────────────────────────
   Constants
────────────────────────────────────────────── */
/* ──────────────────────────────────────────────
   Helpers
────────────────────────────────────────────── */
function fmtDate(str: string | null) {
  if (!str) return '—'
  return new Date(str).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const campoStyle: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13.5,
  fontFamily: "var(--font-body)", color: 'var(--text)', outline: 'none',
  background: 'var(--surface)',
}


/* ──────────────────────────────────────────────
   Section Card
────────────────────────────────────────────── */
function SectionCard({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '22px 26px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, paddingBottom: 14, borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon size={16} color="var(--accent)" />
        </div>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

/**
 * Uma linha da ficha: rótulo à esquerda, campo à direita.
 *
 * A coluna de 180px é a mesma do resto do cartão, e é ela que faz os campos
 * ficarem alinhados entre si em vez de cada um começar onde seu rótulo acabou.
 * Em tela estreita a linha quebra e o campo desce inteiro.
 */
function LinhaFicha({ rotulo, topo = false, children }: { rotulo: string; topo?: boolean; children: React.ReactNode }) {
  return (
    <div className="ficha-linha" style={{ display: 'flex', gap: 12, alignItems: topo ? 'flex-start' : 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12.5, color: 'var(--muted)', minWidth: 180, flexShrink: 0, paddingTop: topo ? 7 : 0 }}>{rotulo}</span>
      <div style={{ flex: 1, minWidth: 0, width: '100%' }}>{children}</div>
    </div>
  )
}

/* ──────────────────────────────────────────────
   New Consulta Modal
────────────────────────────────────────────── */
interface NewConsultaForm {
  procedimento: string
  data_reuniao: string
  profissional_id: string
  duracao_minutos: string
  status: ReuniaoStatus
  observacoes: string
}

const DURACOES = [15, 30, 45, 60, 90, 120]

function NewConsultaModal({ leadId, profissionais, horarios, onClose, onSaved }: { leadId: string; profissionais: Profissional[]; horarios: ProfissionalHorario[]; onClose: () => void; onSaved: (c: Consulta) => void }) {
  const [oportunidadeId, setOportunidadeId] = useState('')
  const [form, setForm] = useState<NewConsultaForm>({ procedimento: '', data_reuniao: '', profissional_id: '', duracao_minutos: '60', status: 'agendada', observacoes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const catalogo = useCatalogoProcedimentos()

  const set = (field: keyof NewConsultaForm, value: string) => setForm((f) => ({ ...f, [field]: value }))

  /* A JORNADA BARRA QUEM ESTÁ SENDO MARCADO — E SÓ ELE.

     Esta tela ficou de fora quando a jornada virou regra, do mesmo jeito que
     ficou de fora quando o procedimento virou lista fechada: ela não importava
     nada de `lib/agenda` e gravava direto em `consultas`. Domingo, feriado, 3h
     da manhã — tudo passava, em silêncio.

     Mas aqui, diferente da Agenda, existe o seletor de status. Uma consulta
     `realizada` é REGISTRO DE HISTÓRICO, não agendamento: um cliente antigo
     pode ter sido atendido num sábado que a empresa não abre mais, e barrar
     isso tornaria o passado impossível de lançar. Por isso a recusa só vale
     para `agendada` — que é o único status que significa "marcar". */
  const profissionalEscolhido = profissionais.find((p) => p.id === form.profissional_id) ?? null
  const inicioConsulta = form.data_reuniao ? new Date(form.data_reuniao) : null
  const foraDaJornada = form.status === 'agendada' && inicioConsulta && !isNaN(inicioConsulta.getTime()) && profissionalEscolhido
    ? motivoForaDaJornada(
        horarios.filter((h) => h.profissional_id === form.profissional_id),
        inicioConsulta,
        Number(form.duracao_minutos),
        `${profissionalEscolhido.nome} ${profissionalEscolhido.sobrenome}`.trim(),
      )
    : null

  const handleSave = async () => {
    if (!form.procedimento) { setError('Escolha o serviço.'); return }
    if (!form.data_reuniao) { setError('Escolha a data da reunião.'); return }
    if (foraDaJornada) { setError(foraDaJornada); return }
    setSaving(true); setError('')
    const { data, error: err } = await supabase.from('reunioes').insert({
      contato_id: leadId,
      oportunidade_id: oportunidadeId || null,
      profissional_id: form.profissional_id || null,
      assunto: form.procedimento.trim(),
      data_reuniao: form.data_reuniao,
      duracao_minutos: Number(form.duracao_minutos),
      status: form.status,
      origem: 'equipe',
      observacoes: form.observacoes.trim() || null,
    }).select().single()
    setSaving(false)
    if (err) {
      // 23P01 = exclusion_violation: a restrição `reunioes_sem_sobreposicao`
      // barrou uma consulta em cima de outra na agenda desse profissional.
      // 23514 = a trigger `consultas_procedimento_valido`: procedimento que
      // saiu do catálogo entre abrir o modal e salvar.
      // JOR01 = a trava de jornada do banco (migração 0025). Ver o comentário
      // gêmeo em NovoAgendamentoModal: chegar aqui é sinal de aba antiga.
      setError(err.code === 'JOR01'
        ? `${err.message} Recarregue a página (Ctrl+F5).`
        : err.code === '23P01'
        ? 'Esse profissional já tem reunião nesse horário. Escolha outro horário ou outra agenda.'
        : err.code === '23514'
        ? 'Esse serviço não está mais no catálogo da empresa.'
        : 'Erro ao salvar reunião.')
      return
    }
    onSaved(data as Consulta)
    onClose()
  }

  const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)', fontSize: 13.5, fontFamily: "var(--font-body)", color: 'var(--text)', outline: 'none', background: 'var(--surface)', boxSizing: 'border-box' }

  return (
    <ModalPortal label={"Agendar reunião"} onClose={onClose} busy={saving}><div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)', width: '100%', maxWidth: 480, padding: '28px 28px 24px', boxShadow: '0 8px 48px rgba(0,0,0,0.12)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Nova Reunião</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><X size={18} color="var(--muted)" /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* PROCEDIMENTO: LISTA FECHADA, COMO NAS OUTRAS PORTAS.

              Este campo era texto livre, e ficou para trás na padronização —
              o que significava que, desde a migração `0022`, digitar "Limpeza"
              aqui batia na trigger `consultas_procedimento_valido` e voltava
              como "Erro ao salvar consulta", sem dizer o motivo. Campo livre
              contra uma trava do banco não é liberdade: é um erro escondido. */}
          <div>
            <OportunidadeReuniao leadId={leadId} valor={oportunidadeId} onChange={setOportunidadeId} />
            <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 6 }}>Serviço *</label>
            <select value={form.procedimento} onChange={(e) => set('procedimento', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}
              onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')} onBlur={(e) => (e.target.style.borderColor = 'var(--border)')}>
              <option value="">{catalogo.length ? 'Escolha o serviço...' : 'Carregando...'}</option>
              {catalogo.map((nome) => (
                <option key={nome} value={nome}>{nome}</option>
              ))}
            </select>
            {catalogo.length > 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 5 }}>
                Falta algum? Cadastre em <strong>Serviços</strong> e ele aparece aqui.
              </div>
            )}
          </div>
          <div>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 6 }}>Data da Reunião *</label>
            <input type="datetime-local" value={form.data_reuniao} onChange={(e) => set('data_reuniao', e.target.value)} style={inputStyle}
              onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')} onBlur={(e) => (e.target.style.borderColor = 'var(--border)')} />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 2 }}>
              <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 6 }}>Profissional</label>
              <select value={form.profissional_id} onChange={(e) => set('profissional_id', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">Sem profissional definido</option>
                {profissionais.filter((p) => p.ativo).map((p) => (
                  <option key={p.id} value={p.id}>{`${p.nome} ${p.sobrenome}`.trim()}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 6 }}>Duração</label>
              <select value={form.duracao_minutos} onChange={(e) => set('duracao_minutos', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                {DURACOES.map((d) => (
                  <option key={d} value={d}>{d} min</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 6 }}>Status *</label>
            <select value={form.status} onChange={(e) => set('status', e.target.value as ReuniaoStatus)} style={{ ...inputStyle, cursor: 'pointer' }}>
              <option value="agendada">Agendada</option>
              <option value="realizada">Realizada</option>
              <option value="cancelada">Cancelada</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 6 }}>Observações (opcional)</label>
            <textarea value={form.observacoes} onChange={(e) => set('observacoes', e.target.value)} rows={3} placeholder="Anotações sobre a reunião..." style={{ ...inputStyle, resize: 'vertical' }}
              onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')} onBlur={(e) => (e.target.style.borderColor = 'var(--border)')} />
          </div>
        </div>

        {/* Aparece enquanto a pessoa mexe na data, e não só depois do clique:
            descobrir a recusa ao salvar é descobrir tarde demais. */}
        {foraDaJornada && (
          <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger-border)', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, color: 'var(--danger)', marginTop: 12, lineHeight: 1.5 }}>
            {foraDaJornada} Escolha outro horário, outro profissional, ou ajuste a jornada em <strong>Profissionais</strong>.
          </div>
        )}

        {error && <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger-border)', borderRadius: 8, padding: '9px 12px', fontSize: 13, color: 'var(--danger)', marginTop: 12 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: 'var(--muted)', fontFamily: "var(--font-body)" }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving || !!foraDaJornada} style={{ flex: 2, padding: '10px', borderRadius: 9, border: 'none', background: foraDaJornada ? 'var(--border)' : saving ? 'var(--action-hover)' : 'var(--action)', cursor: saving || foraDaJornada ? 'not-allowed' : 'pointer', fontSize: 13.5, fontWeight: 600, color: foraDaJornada ? 'var(--muted)' : 'var(--on-action)', fontFamily: "var(--font-body)" }}>
            {saving ? 'Salvando...' : 'Salvar Reunião'}
          </button>
        </div>
      </div>
    </div></ModalPortal>
  )
}

/* ──────────────────────────────────────────────
   Main Component
────────────────────────────────────────────── */
export default function LeadDetail() {
  const funil = useFunil()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [lead, setLead] = useState<Contato | null>(null)
  const [consultas, setConsultas] = useState<Consulta[]>([])
  const [profissionais, setProfissionais] = useState<Profissional[]>([])
  const [horarios, setHorarios] = useState<ProfissionalHorario[]>([])
  const [loading, setLoading] = useState(true)


  const [anotacoes, setAnotacoes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [notesSaved, setNotesSaved] = useState(false)
  const [notesError, setNotesError] = useState('')

  /* A FICHA EDITÁVEL.

     Nome, WhatsApp e procedimentos eram só leitura aqui: um nome que o assistente
     entendeu errado, ou um número digitado torto, só tinham conserto no banco.
     Tudo isto entra no MESMO "Salvar Ficha" que já existia — um botão por
     assunto, e não um por campo. */
  const [nome, setNome] = useState('')
  const [empresa, setEmpresa] = useState('')
  const [email, setEmail] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [whatsappValido, setWhatsappValido] = useState(false)
  /* Sem isto não dá para separar "apagou o número" de "está no meio de
     digitar": o CampoTelefone manda '' nos dois casos. Enquanto ninguém tocar
     no campo, o WhatsApp nem entra no update — e não há como zerá-lo sem
     querer. */
  const [whatsappTocado, setWhatsappTocado] = useState(false)
  const [duplicado, setDuplicado] = useState<PessoaResumo | null>(null)
  const [procedimentos, setProcedimentos] = useState<string[]>([])
  const [savingFicha, setSavingFicha] = useState(false)
  const [fichaSaved, setFichaSaved] = useState(false)
  const [fichaError, setFichaError] = useState('')

  const catalogo = useCatalogoProcedimentos()

  const [showModal, setShowModal] = useState(false)

  /* Load data */
  useEffect(() => {
    if (!id) return
    Promise.all([
      supabase.from('contatos').select('*').eq('id', id).single(),
      supabase.from('reunioes').select('*').eq('contato_id', id).order('data_reuniao', { ascending: false }),
      supabase.from('profissionais').select('*').order('nome'),
      // A jornada vem junto: é ela que decide se dá para marcar a consulta.
      supabase.from('profissional_horarios').select('*'),
    ]).then(([{ data: leadData }, { data: consultasData }, { data: profissionaisData }, { data: horariosData }]) => {
      if (leadData) {
        setLead(leadData)
        setAnotacoes(leadData.anotacoes ?? '')
        setNome(leadData.nome ?? '')
        setEmpresa(leadData.empresa ?? '')
        setEmail(leadData.email ?? '')
        setWhatsapp(leadData.whatsapp ?? '')
        setWhatsappValido(!!leadData.whatsapp)
        setProcedimentos(leadData.interesses ?? [])
      }
      setConsultas(consultasData ?? [])
      setProfissionais((profissionaisData ?? []) as Profissional[])
      setHorarios((horariosData ?? []) as ProfissionalHorario[])
      setLoading(false)
    })
  }, [id])

  /* Supabase Realtime */
  useEffect(() => {
    if (!id) return
    const channel = supabase
      .channel(`lead-detail-${id}`)
      // Realtime escuta a TABELA, não a view: o Postgres só replica tabelas.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'contatos_dados', filter: `id=eq.${id}` }, (payload) => {
        setLead((prev) => prev ? { ...prev, ...payload.new } as Contato : prev)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [id])

  /* O WhatsApp mudou: confere se o número novo já é de outra pessoa antes de
     alguém clicar em salvar e levar um 23505 sem explicação. */
  const handleWhatsapp = (canonico: string, valido: boolean) => {
    setWhatsapp(canonico)
    setWhatsappValido(valido)
    setWhatsappTocado(true)
    setDuplicado(null)
    setFichaError('')
    if (valido && canonico !== lead?.whatsapp) {
      void buscarPorWhatsapp(canonico).then((p) => setDuplicado(p && p.id !== lead?.id ? p : null))
    }
  }

  /* Save ficha */
  const handleSaveFicha = async () => {
    if (!lead) return
    if (whatsappTocado && !whatsappValido) {
      setFichaError('Informe um WhatsApp válido, com o código do país.')
      return
    }
    if (duplicado) { setFichaError('Esse WhatsApp já pertence a outra pessoa.'); return }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setFichaError('Informe um e-mail válido.'); return }

    setSavingFicha(true); setFichaError('')
    const campos: Record<string, unknown> = {
      nome: nome.trim() || null,
      empresa: empresa.trim() || null,
      email: email.trim() || null,
      // O array é que se grava. `interesses_texto` é calculada na view —
      // escrever nela é escrever numa expressão.
      interesses: procedimentos,
    }
    if (whatsappTocado) campos.whatsapp = whatsapp

    /* `.select()` traz a linha DE VOLTA, e é ela que vale — não o que foi
       enviado. A trigger `crm_procedimentos_validos` normaliza a grafia e
       reordena o array, e `interesses_texto` é calculada na leitura.
       Espelhar isso à mão daria uma tela que discorda do banco até o F5. */
    const { data: salvo, error } = await supabase.from('contatos')
      .update(campos).eq('id', lead.id).select().single()
    setSavingFicha(false)
    if (error) {
      if (error.code === ERRO_DUPLICADO) {
        setFichaError('Esse WhatsApp acabou de ser cadastrado para outra pessoa.')
        void buscarPorWhatsapp(whatsapp).then(setDuplicado)
        return
      }
      // 23514 = a trigger `crm_procedimentos_validos`, do banco: procedimento
      // que não existe mais no catálogo.
      setFichaError(error.code === '23514'
        ? 'Algum serviço escolhido não está mais no catálogo da empresa.'
        : 'Erro ao salvar. Tente novamente.')
      return
    }

    const atualizado = salvo as Contato
    setLead(atualizado)
    // E os campos acompanham o que o banco gravou: quem digitou "lentes de
    // contato" vê a caixa certa marcada, sem a ficha continuar "alterada".
    setNome(atualizado.nome ?? '')
    setProcedimentos(atualizado.interesses ?? [])
    setWhatsappTocado(false)
    setFichaSaved(true)
    setTimeout(() => setFichaSaved(false), 2000)
  }

  /* Save notes */
  const handleSaveNotes = async () => {
    if (!lead) return
    setSavingNotes(true); setNotesError('')
    const { error } = await supabase.from('contatos').update({ anotacoes }).eq('id', lead.id)
    setSavingNotes(false)
    if (error) { setNotesError('Erro ao salvar anotações. Tente novamente.'); return }
    setLead((prev) => prev ? { ...prev, anotacoes } : prev)
    setNotesSaved(true)
    setTimeout(() => setNotesSaved(false), 2000)
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '80vh' }}>
        <div style={{ width: 32, height: 32, border: '3px solid var(--accent-soft)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (!lead) {
    return (
      <div className="page-content">
        <p style={{ color: 'var(--muted)' }}>Lead não encontrado.</p>
        <button onClick={() => navigate('/leads')} style={{ marginTop: 12, background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontWeight: 600, fontSize: 13.5, fontFamily: "var(--font-body)" }}>← Voltar</button>
      </div>
    )
  }

  const statusStyle = funil.estilo(lead.status) as { bg: string; color: string; pulse?: boolean }

  /* O botão só acende quando há o que salvar — e a pendência é comparada com o
     que está GRAVADO, não com um sinalizador de "mexeu". Mexer e voltar ao
     valor original deixa de contar, e o `setLead` do salvar zera tudo sozinho.
     A ordem das caixas não conta como diferença: elas entram na ordem em que
     foram marcadas, e o banco devolve na ordem em que foram gravadas. */
  const fichaAlterada =
    nome.trim() !== (lead.nome ?? '') ||
    (whatsappTocado && whatsapp !== (lead.whatsapp ?? '')) ||
    [...procedimentos].sort().join('|') !== [...(lead.interesses ?? [])].sort().join('|')

  return (
    <div style={{ padding: '28px 36px', maxWidth: 900, margin: '0 auto' }}>

      {/* Back button */}
      <button className="fade-in" onClick={() => navigate(isCliente(lead.status) ? '/clientes' : '/leads')}
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 13, fontWeight: 500, fontFamily: "var(--font-body)", marginBottom: 20, padding: 0 }}>
        <ArrowLeft size={15} /> Voltar para {isCliente(lead.status) ? 'Clientes' : 'Leads'}
      </button>

      {/* Header */}
      <div className="fade-in-1" style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '22px 26px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{lead.nome ?? 'Sem nome'}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: statusStyle.bg, color: statusStyle.color, whiteSpace: 'nowrap' }}>
                {statusStyle.pulse && <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusStyle.color, animation: 'pulse-dot 1.4s ease infinite', display: 'inline-block' }} />}
                {funil.rotulo(lead.status)}
              </span>
              {lead.whatsapp && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--muted)' }}>
                  <Phone size={13} /> {formatarParaExibicao(lead.whatsapp)}
                </span>
              )}
              {lead.ultima_mensagem && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--muted)' }}>
                  <Clock size={13} /> Última interação: {fmtDate(lead.ultima_mensagem)}
                </span>
              )}
              {lead.inicio_atendimento && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--muted)' }}>
                  <CalendarDays size={13} /> Início do atendimento: {fmtDate(lead.inicio_atendimento)}
                </span>
              )}
            </div>
          </div>

          {lead.whatsapp && moduloAtivo('conversas') && (
            <button onClick={() => navigate(`/conversas?lead=${lead.id}`)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 15px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--accent)', fontFamily: "var(--font-body)", whiteSpace: 'nowrap' }}>
              <MessagesSquare size={14} /> Ver conversa
            </button>
          )}
          {moduloAtivo('campanhas') && <ConsentimentoMarketing contatoId={lead.id} />}
        </div>
      </div>

      <div className="fade-in-2">
        <SectionCard title="Etiquetas" icon={Tag}>
          <EtiquetasDoContato contatoId={lead.id} />
        </SectionCard>
      </div>

      <CamposDoContato contatoId={lead.id} />
      <Oportunidades leadId={lead.id} />
      <PrivacidadeContato contatoId={lead.id} />

      {/* Histórico de Reuniões */}
      <div className="fade-in-2">
        <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '22px 26px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, paddingBottom: 14, borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CalendarDays size={16} color="var(--accent)" />
              </div>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Histórico de Reuniões</span>
            </div>
            <button onClick={() => setShowModal(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 9, border: 'none', background: 'var(--action)', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--on-action)', fontFamily: "var(--font-body)" }}>
              <Plus size={14} /> Nova Reunião
            </button>
          </div>

          {consultas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--muted)' }}>
              <CalendarDays size={32} strokeWidth={1.2} style={{ marginBottom: 8 }} />
              <div style={{ fontSize: 13.5 }}>Nenhuma reunião registrada</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Serviço', 'Data', 'Profissional', 'Status', 'Observações'].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 12, fontWeight: 600, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {consultas.map((c, idx) => {
                    const cs = STATUS_CONSULTA[c.status]
                    const prof = profissionais.find((p) => p.id === c.profissional_id)
                    return (
                      <tr key={c.id} style={{ borderBottom: '1px solid var(--border-subtle)', background: idx % 2 === 0 ? 'var(--surface)' : 'var(--surface-subtle)' }}>
                        <td style={{ padding: '11px 12px', fontWeight: 600, color: 'var(--text)' }}>{c.assunto}</td>
                        <td style={{ padding: '11px 12px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                          {fmtDate(c.data_reuniao)}
                          <span style={{ color: 'var(--muted)' }}> · {c.duracao_minutos} min</span>
                        </td>
                        <td style={{ padding: '11px 12px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                          {prof ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ width: 8, height: 8, borderRadius: '50%', background: prof.cor, display: 'inline-block', flexShrink: 0 }} />
                              {`${prof.nome} ${prof.sobrenome}`.trim()}
                            </span>
                          ) : '—'}
                        </td>
                        <td style={{ padding: '11px 12px' }}>
                          <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 600, background: cs.bg, color: cs.color, whiteSpace: 'nowrap' }}>
                            {ROTULO_CONSULTA[c.status]}
                          </span>
                        </td>
                        <td style={{ padding: '11px 12px', color: 'var(--muted)', maxWidth: 200 }}>{c.observacoes ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Tarefas: o próximo passo desta pessoa, com prazo e responsável. */}
      <div className="fade-in-2">
        <SectionCard title="Tarefas" icon={ListChecks}>
          <TarefasDoContato contatoId={lead.id} />
        </SectionCard>
      </div>

      {/* Linha do tempo: etapas, reuniões e avisos do contato, numa ordem só. */}
      <div className="fade-in-2">
        <SectionCard title="Linha do tempo" icon={History}>
          {moduloAtivo('captacao') && <OrigemDoContato key={lead.id} contatoId={lead.id} />}
          <LinhaDoTempo contato={{ id: lead.id, created_at: lead.created_at }} reunioes={consultas} ultimaMensagem={moduloAtivo('conversas') ? lead.ultima_mensagem : null} rotuloEtapa={funil.rotulo} />
        </SectionCard>
      </div>

      {/* Visão Completa do Contato */}
      <div className="fade-in-3">
        <SectionCard title="Visão Completa do Contato" icon={ClipboardList}>

          {/* O RESUMO CONTINUA SÓ LEITURA: quem escreve é o assistente, pela
              ferramenta `atualizar_ficha`. Editá-lo aqui seria apagar na mão o
              que ela vai reescrever na próxima mensagem. */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <span style={{ fontSize: 12.5, color: 'var(--muted)', minWidth: 180, flexShrink: 0, paddingTop: 2 }}>Resumo da Conversa</span>
            <span style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.6 }}>{lead.resumo_conversa || '—'}</span>
          </div>

          <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '18px 0' }} />

          {/* A FICHA, EDITÁVEL — E COM UM BOTÃO SÓ.

              Um "Salvar" por campo seria seis botões num cartão; o assunto é um
              só ("os dados desta pessoa"), então o botão é um só. É a mesma
              divisão que já valia aqui: Status e Anotações têm o seu, porque
              são outras perguntas. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <LinhaFicha rotulo="Nome">
              <input
                value={nome}
                onChange={(e) => { setNome(e.target.value); setFichaError('') }}
                placeholder="Nome completo"
                style={{ ...campoStyle, width: '100%', boxSizing: 'border-box' }}
                onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')}
                onBlur={(e) => (e.target.style.borderColor = 'var(--border)')}
              />
            </LinhaFicha>

            <LinhaFicha rotulo="Empresa">
              <input value={empresa} onChange={e => setEmpresa(e.target.value)} placeholder="Nome da empresa" style={{ ...campoStyle, width: '100%' }} />
            </LinhaFicha>
            <LinhaFicha rotulo="E-mail">
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="contato@empresa.com" style={{ ...campoStyle, width: '100%' }} />
            </LinhaFicha>

            {/* O MESMO CampoTelefone das telas de cadastro: a regra de país e de
                contagem de dígitos mora num lugar só, e o que sai daqui já é o
                canônico do banco (dígitos com DDI). */}
            <LinhaFicha rotulo="WhatsApp" topo>
              <CampoTelefone
                valor={whatsapp}
                onChange={handleWhatsapp}
                rotulo=""
                marcador={false}
                aviso={duplicado && (
                  <div style={{ background: 'var(--warning-soft)', border: '1px solid var(--warning-border)', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, color: 'var(--warning)', lineHeight: 1.5 }}>
                    Esse número já é de <strong>{duplicado.nome ?? 'um contato sem nome'}</strong>.
                    <button
                      onClick={() => navigate(`/leads/${duplicado.id}`)}
                      style={{ display: 'block', marginTop: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12.5, fontWeight: 700, color: 'var(--accent)', fontFamily: "var(--font-body)" }}
                    >
                      Abrir a ficha dessa pessoa →
                    </button>
                  </div>
                )}
              />
            </LinhaFicha>

            {/* Caixas, e não texto livre — a mesma trava do cadastro e da
                Assistente. O banco confere de novo (trigger
                `crm_procedimentos_validos`, migração 0022). */}
            <LinhaFicha rotulo="Serviços de Interesse" topo>
              {catalogo.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--muted)', paddingTop: 6 }}>Carregando os serviços da empresa...</div>
              ) : (
                <div style={{
                  border: '1px solid var(--border)', borderRadius: 9, padding: 8, background: 'var(--surface)',
                  maxHeight: 180, overflowY: 'auto',
                  display: 'grid', gap: 2,
                  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                }}>
                  {catalogo.map((p) => {
                    const marcado = procedimentos.includes(p)
                    return (
                      <label key={p} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 8px', borderRadius: 7, cursor: 'pointer',
                        background: marcado ? 'var(--accent-soft)' : 'transparent',
                        fontSize: 13, color: marcado ? 'var(--text)' : 'var(--muted)',
                        fontWeight: marcado ? 600 : 400,
                      }}>
                        <input
                          type="checkbox" checked={marcado}
                          onChange={() => {
                            setProcedimentos((atual) => marcado ? atual.filter((x) => x !== p) : [...atual, p])
                            setFichaError('')
                          }}
                          style={{ accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }}
                        />
                        {p}
                      </label>
                    )
                  })}
                </div>
              )}
            </LinhaFicha>

            {fichaError && (
              <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger-border)', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, color: 'var(--danger)' }}>{fichaError}</div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button onClick={handleSaveFicha} disabled={savingFicha || !fichaAlterada || !!duplicado}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 9, border: 'none', background: fichaSaved ? 'var(--success-solid)' : (!fichaAlterada || duplicado) ? 'var(--border)' : (savingFicha ? 'var(--action-hover)' : 'var(--action)'), color: fichaSaved ? 'var(--on-solid)' : (!fichaAlterada || duplicado) ? 'var(--muted)' : 'var(--on-action)', cursor: (savingFicha || !fichaAlterada || duplicado) ? 'default' : 'pointer', fontSize: 13, fontWeight: 600, fontFamily: "var(--font-body)", transition: 'background 0.2s' }}>
                <Save size={13} /> {fichaSaved ? 'Salvo!' : savingFicha ? 'Salvando...' : 'Salvar Ficha'}
              </button>
              {/* Botão apagado sem motivo escrito parece botão quebrado. */}
              {!fichaSaved && !fichaAlterada && (
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>Nada mudou por aqui.</span>
              )}
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '18px 0' }} />

          {/* Anotações */}
          <textarea
            value={anotacoes}
            onChange={(e) => setAnotacoes(e.target.value)}
            rows={5}
            placeholder="Escreva suas anotações sobre este lead..."
            style={{ width: '100%', padding: '10px 14px', borderRadius: 9, border: '1px solid var(--border)', fontSize: 13.5, fontFamily: "var(--font-body)", color: 'var(--text)', outline: 'none', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box' }}
            onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')}
            onBlur={(e) => (e.target.style.borderColor = 'var(--border)')}
          />
          {notesError && (
            <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger-border)', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, color: 'var(--danger)', marginTop: 8 }}>{notesError}</div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <button onClick={handleSaveNotes} disabled={savingNotes}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 9, border: 'none', background: notesSaved ? 'var(--success-solid)' : (savingNotes ? 'var(--action-hover)' : 'var(--action)'), color: notesSaved ? 'var(--on-solid)' : 'var(--on-action)', cursor: savingNotes ? 'not-allowed' : 'pointer', fontSize: 13.5, fontWeight: 600, fontFamily: "var(--font-body)", transition: 'background 0.2s' }}>
              <Save size={14} /> {notesSaved ? 'Salvo!' : savingNotes ? 'Salvando...' : 'Salvar Anotações'}
            </button>
          </div>

        </SectionCard>
      </div>

      {/* A ZONA DE PERIGO É A ÚLTIMA COISA DA PÁGINA.

          Não é o fim por descuido: é a ação mais destrutiva que a ficha
          oferece, e ação destrutiva não fica no caminho do olho de quem só
          veio conferir um telefone. */}
      <div className="fade-in-4">
        <ApagarEstaPessoa pessoa={lead} />
      </div>

      {showModal && (
        <NewConsultaModal
          leadId={lead.id}
          profissionais={profissionais}
          horarios={horarios}
          onClose={() => setShowModal(false)}
          onSaved={(c) => setConsultas((prev) => [c, ...prev])}
        />
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(1.4); } }
      `}</style>
    </div>
  )
}
