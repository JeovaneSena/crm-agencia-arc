import ModalPortal from './ModalPortal'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, Download, FileText, Users, UserCheck, UserPlus, X, ArrowRight, CalendarPlus, Filter } from 'lucide-react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from '../lib/supabase'
import { useFunil } from '../lib/funil'
import { isCliente } from '../lib/pessoas'
import { buscarPorWhatsapp, ERRO_DUPLICADO, type PessoaResumo } from '../lib/contatos'
import { apenasDigitos, formatarParaExibicao } from '../lib/telefones'
import { useCatalogoProcedimentos } from '../lib/procedimentos'
import { motivoForaDaJornada } from '../lib/agenda'
import CampoTelefone from './CampoTelefone'
import AvisoBaixaConsulta from './AvisoBaixaConsulta'
import FiltroPeriodo from './FiltroPeriodo'
import {
  getPeriodRange, inRange,
  type DateRange, type PeriodKey,
} from '../lib/periodo'
import type { Contato, LeadStatus, Profissional, ProfissionalHorario } from '../types'

/* ──────────────────────────────────────────────
   Implementação compartilhada entre /leads e /clientes.

   As duas páginas leem a MESMA tabela (`contatos`) e se diferenciam
   apenas pelo status: quem já realizou consulta é Cliente, o resto é
   Contato. Por isso uma única implementação com `mode`, em vez de dois
   arquivos quase idênticos.
────────────────────────────────────────────── */

export type PessoasMode = 'leads' | 'clientes'

interface ModeConfig {
  titulo: string
  subtitulo: string
  explicacao: string
  outraPagina: { rota: string; label: string }
  icone: typeof Users
  corIcone: string
  botaoNovo: string
  arquivo: string
  vazio: string
  /**
   * A última coluna da tabela, que NÃO é a mesma nas duas páginas.
   *
   * Em Contatos a pergunta é "quem tem reunião marcada?" → `proxima_reuniao`,
   * a próxima. Em Clientes essa coluna seria sempre vazia: virar cliente
   * significa que a reunião aconteceu, e a próxima só existe enquanto houver
   * uma agendada. Lá a pergunta é outra —
   * "quando essa pessoa esteve aqui?" — e quem responde é `ultima_reuniao`.
   */
  colunaData: { titulo: string; campo: 'proxima_reuniao' | 'ultima_reuniao'; vazio: string }
}

const CONFIG: Record<PessoasMode, ModeConfig> = {
  leads: {
    titulo: 'Contatos (Leads)',
    subtitulo: 'Oportunidades em acompanhamento comercial.',
    explicacao: 'Qualifique contatos, entenda o negócio e acompanhe diagnósticos, propostas e negociações.',
    outraPagina: { rota: '/clientes', label: 'Ver Clientes' },
    icone: Users,
    corIcone: 'var(--accent)',
    botaoNovo: 'Novo Contato',
    arquivo: 'contatos',
    vazio: 'Nenhum contato nesse período.',
    colunaData: { titulo: 'Reunião Marcada', campo: 'proxima_reuniao', vazio: 'Sem reunião' },
  },
  clientes: {
    titulo: 'Clientes',
    subtitulo: 'Empresas e contatos com venda fechada.',
    explicacao: 'Contatos com histórico de venda. Novas negociações não removem o cliente desta lista.',
    outraPagina: { rota: '/leads', label: 'Ver Contatos (Leads)' },
    icone: UserCheck,
    corIcone: 'var(--success)',
    botaoNovo: 'Novo Contato',
    arquivo: 'clientes',
    vazio: 'Nenhum cliente nesse período.',
    // Cliente sem data aqui é ficha ANTIGA: hoje ninguém entra em Clientes
    // sem uma consulta realizada por trás, então esta linha só descreve o que
    // já estava no banco. Dizer isso é melhor que um traço mudo.
    colunaData: { titulo: 'Última Reunião', campo: 'ultima_reuniao', vazio: 'Cadastrado à mão' },
  },
}

/* ──────────────────────────────────────────────
   Types & constants
────────────────────────────────────────────── */
/* ──────────────────────────────────────────────
   Helpers
────────────────────────────────────────────── */
function fmtDate(str: string | null) {
  if (!str) return '—'
  return new Date(str).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/* ──────────────────────────────────────────────
   StatusBadge
────────────────────────────────────────────── */
function StatusBadge({ status }: { status: LeadStatus }) {
  const funil = useFunil()
  const s = funil.estilo(status) as { bg: string; color: string; pulse?: boolean }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 600, background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>
      {s.pulse && <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, animation: 'pulse-dot 1.4s ease infinite', display: 'inline-block' }} />}
      {status === 'ganho' ? 'Cliente' : funil.rotulo(status)}
    </span>
  )
}

/* ──────────────────────────────────────────────
   NewLeadModal
────────────────────────────────────────────── */
interface NewLeadForm {
  nome: string
  empresa: string
  email: string
  whatsapp: string
  procedimentos: string[]
  anotacoes: string
}

/**
 * A consulta que o cadastro pode criar junto com a pessoa.
 *
 * Note que NÃO há aqui um campo dizendo se ela já aconteceu ou vai acontecer.
 * **Quem responde isso é a própria data**: no passado, aconteceu; no futuro,
 * vai acontecer. Um seletor ao lado de um campo que já responde a pergunta é
 * pedir para os dois discordarem — e o perdedor era sempre quem digitou.
 */
interface NewConsulta {
  quando: string
  assunto: string
  profissional_id: string
  duracao: string
}

const DURACOES = [15, 30, 45, 60, 90, 120]

interface NewLeadModalProps {
  titulo: string
  onClose: () => void
  onSaved: (lead: Contato) => void
}

function NewLeadModal({ titulo, onClose, onSaved }: NewLeadModalProps) {
  const [form, setForm] = useState<NewLeadForm>({
    nome: '', empresa: '', email: '', whatsapp: '', procedimentos: [], anotacoes: '',
  })
  const [whatsappValido, setWhatsappValido] = useState(false)
  const [duplicado, setDuplicado] = useState<PessoaResumo | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const catalogo = useCatalogoProcedimentos()

  const [consulta, setConsulta] = useState<NewConsulta>({
    quando: '', assunto: '', profissional_id: '', duracao: '60',
  })
  const [agora, setAgora] = useState(() => Date.now())
  const [profissionais, setProfissionais] = useState<Profissional[]>([])
  const [horarios, setHorarios] = useState<ProfissionalHorario[]>([])
  /* A pessoa que JÁ foi criada, quando só a consulta falhou. Sem guardar isto,
     tentar de novo bateria no WhatsApp duplicado — e o erro apontaria para o
     lugar errado, culpando o número de quem acabou de ser cadastrado. */
  const [jaCriado, setJaCriado] = useState<Contato | null>(null)

  useEffect(() => {
    // A jornada vem junto com os profissionais: uma consulta no futuro é um
    // agendamento, e agendamento fora da jornada deixou de ser possível.
    void Promise.all([
      supabase.from('profissionais').select('*').eq('ativo', true).order('nome'),
      supabase.from('profissional_horarios').select('*'),
    ]).then(([{ data: profs }, { data: hors }]) => {
      setProfissionais((profs ?? []) as Profissional[])
      setHorarios((hors ?? []) as ProfissionalHorario[])
    })
  }, [])

  /* A DATA DECIDE — E É A ÚNICA COISA QUE DECIDE.

     No passado, a consulta aconteceu (`realizada`, e a pessoa vira Cliente);
     no futuro, vai acontecer (`agendada`, e ela fica em Contatos com "Consulta
     Agendada"); sem data, nenhuma consulta é criada e ela entra como Contato.

     Havia aqui um seletor "Lead / Cliente", e ele foi removido: com a data
     respondendo à mesma pergunta, ele não decidia mais nada — e quando os dois
     discordavam (Cliente + data no futuro), quem levava um erro na cara era
     quem tinha digitado a informação certa. */
  const instante = (() => {
    if (!consulta.quando) return null
    const d = new Date(consulta.quando)
    return isNaN(d.getTime()) ? null : d
  })()
  /* `Date.now()` durante a renderização é impuro, e o ESLint reprova com razão:
     o resultado mudaria sozinho a cada re-render. O relógio é lido na abertura
     do modal e relido a cada mexida no campo de data — que é o único momento em
     que a resposta pode ter mudado para quem está olhando. */
  const jaAconteceu = instante !== null && instante.getTime() <= agora

  /* A MESMA REGRA DA AGENDA, PELA MESMA FUNÇÃO — e só para o que está sendo
     MARCADO. No passado a consulta é histórico (`realizada`), e a jornada de
     hoje não tem o que dizer sobre um atendimento que já aconteceu; no futuro
     ela é agendamento, e vale a recusa. É a mesma divisão da ficha do lead. */
  const profissionalDaConsulta = profissionais.find((p) => p.id === consulta.profissional_id) ?? null
  const foraDaJornada = !jaAconteceu && instante && profissionalDaConsulta
    ? motivoForaDaJornada(
        horarios.filter((h) => h.profissional_id === consulta.profissional_id),
        instante,
        Number(consulta.duracao),
        `${profissionalDaConsulta.nome} ${profissionalDaConsulta.sobrenome}`.trim(),
      )
    : null

  const set = <C extends keyof NewLeadForm>(field: C, value: NewLeadForm[C]) =>
    setForm((f) => ({ ...f, [field]: value }))

  const setC = <C extends keyof NewConsulta>(field: C, value: NewConsulta[C]) =>
    setConsulta((c) => ({ ...c, [field]: value }))

  const handleWhatsapp = (canonico: string, valido: boolean) => {
    set('whatsapp', canonico)
    setWhatsappValido(valido)
    setDuplicado(null)
    setError('')
    // Só vale procurar quando o número está completo — com número pela metade
    // a busca não acha nada e a equipe acha que está livre.
    if (valido) buscarPorWhatsapp(canonico).then(setDuplicado)
  }

  const handleSave = async () => {
    if (!form.nome.trim()) { setError('O nome é obrigatório.'); return }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) { setError('Informe um e-mail válido.'); return }
    if (!whatsappValido) { setError('Informe um WhatsApp válido, com o código do país.'); return }
    if (duplicado) { setError('Esse WhatsApp já pertence a outra pessoa.'); return }

    // A consulta é opcional. Com data preenchida, ela passa a ter exigências
    // próprias — e `procedimento` é `not null` no banco.
    if (consulta.quando && !instante) { setError('A data da reunião não é válida.'); return }
    if (instante && !consulta.assunto) { setError('Escolha o serviço da reunião.'); return }
    if (foraDaJornada) { setError(foraDaJornada); return }

    setSaving(true); setError('')

    /* QUEM TORNA ALGUÉM CLIENTE É A CONSULTA, E NÃO O BOTÃO.

       Antes, marcar "Cliente" gravava `diagnostico` na hora — e a
       pessoa ficava com a etiqueta verde "Consulta Realizada" sem uma consulta
       sequer por trás dela. A tela afirmava um atendimento que o sistema não
       tinha como mostrar.

       Sem data — ou com data no futuro — ela entra como Contato. É a mesma
       regra que já vale no resto do sistema (ninguém vira Cliente sem uma
       consulta realizada); o cadastro manual era a única exceção, e era ela
       que produzia a etiqueta vazia.

       Para a consulta no futuro quem grava o funil nem é esta linha: o trigger
       `reunioes_sincroniza_funil` move para `diagnostico` logo depois. */
    const status: LeadStatus = 'novo_lead'

    let pessoa = jaCriado
    if (!pessoa) {
      const { data, error: err } = await supabase.from('contatos').insert({
        nome: form.nome.trim(),
        empresa: form.empresa.trim() || null,
        email: form.email.trim() || null,
        whatsapp: form.whatsapp,
        status,
        interesses: form.procedimentos,
        anotacoes: form.anotacoes.trim() || null,
      }).select().single()

      if (err) {
        setSaving(false)
        // Rede de segurança: entre a busca acima e este insert, o Agente de IA
        // pode ter criado a mesma pessoa. Quem decide é o índice do banco.
        if (err.code === ERRO_DUPLICADO) {
          setError('Esse WhatsApp acabou de ser cadastrado para outra pessoa.')
          buscarPorWhatsapp(form.whatsapp).then(setDuplicado)
          return
        }
        setError('Erro ao cadastrar. Tente novamente.')
        return
      }
      pessoa = data as Contato
      setJaCriado(pessoa)
    }

    if (instante) {
      const { error: errConsulta } = await supabase.from('reunioes').insert({
        contato_id: pessoa.id,
        profissional_id: consulta.profissional_id || null,
        assunto: consulta.assunto,
        data_reuniao: instante.toISOString(),
        duracao_minutos: Number(consulta.duracao),
        // A data decide, e é a única coisa que decide.
        status: jaAconteceu ? 'realizada' : 'agendada',
        origem: 'equipe',
      })

      if (errConsulta) {
        setSaving(false)
        // A PESSOA JÁ ESTÁ NO BANCO. Dizer só "erro ao cadastrar" mandaria
        // alguém cadastrar de novo e bater no WhatsApp duplicado, procurando
        // defeito no número de quem acabou de entrar.
        const nome = form.nome.trim()
        setError(errConsulta.code === 'JOR01'
          // JOR01 = a trava de jornada do banco . Ver o
          // comentário gêmeo em NovoAgendamentoModal: é sinal de aba antiga.
          ? `${nome} foi cadastrado, mas a reunião não: ${errConsulta.message} Recarregue a página (Ctrl+F5) e marque pela Agenda.`
          : errConsulta.code === '23P01'
          // 23P01 = a restrição `reunioes_sem_sobreposicao`.
          ? `${nome} foi cadastrado, mas a reunião não: esse profissional já tem reunião nesse horário. Marque pela Agenda.`
          : `${nome} foi cadastrado, mas a reunião não foi salva. Marque pela Agenda.`)
        return
      }

      // Consulta agendada move o funil pelo trigger `reunioes_sincroniza_funil`.
      // Reler é o que impede a lista de mostrar o status de antes — e de deixar
      // a pessoa na página errada. É o caminho normal de quem marca para o
      // futuro: sai daqui como `novo_lead` e volta `diagnostico`.
      const { data: atualizado } = await supabase.from('contatos')
        .select('*').eq('id', pessoa.id).single()
      if (atualizado) pessoa = atualizado as Contato
    }

    setSaving(false)
    onSaved(pessoa)
    onClose()
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)',
    fontSize: 13.5, fontFamily: "var(--font-body)", color: 'var(--text)',
    outline: 'none', background: 'var(--surface)', boxSizing: 'border-box',
  }

  return (
    <ModalPortal label={titulo} onClose={onClose} busy={saving}><div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)', width: '100%', maxWidth: 500, padding: '28px 28px 24px', boxShadow: '0 8px 48px rgba(0,0,0,0.12)', maxHeight: '90vh', overflowY: 'auto' }}>

        {/* Modal header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <UserPlus size={17} color="var(--accent)" />
            </div>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{titulo}</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 6 }}>
            <X size={18} color="var(--muted)" />
          </button>
        </div>

        {/* O SELETOR "Lead / Cliente" MORAVA AQUI, E FOI REMOVIDO.

            Ele perguntava "já realizou consulta?" ao lado de um campo de data
            que responde a mesma coisa melhor — e quando os dois discordavam,
            quem levava o erro era quem tinha digitado a informação certa.

            Controle que não decide mais nada não é inofensivo: ele promete uma
            escolha e o sistema faz outra coisa. Hoje quem decide é a data, e
            o botão de salvar diz o que vai sair. */}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Nome */}
          <div>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 6 }}>Nome *</label>
            <input value={form.nome} onChange={(e) => set('nome', e.target.value)} placeholder="Nome completo" style={inputStyle}
              onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')} onBlur={(e) => (e.target.style.borderColor = 'var(--border)')} />
          </div>

          <label>Empresa<input value={form.empresa} onChange={e => set('empresa', e.target.value)} placeholder="Nome da empresa" style={inputStyle} /></label>
          <label>E-mail<input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="contato@empresa.com" style={inputStyle} /></label>
          <label>Etapa comercial<p>O contato começa com uma oportunidade em Novo lead. Registre as vendas na ficha.</p></label>
          <small>Marque Ganho apenas para uma venda confirmada.</small>

          {/* WhatsApp */}
          <CampoTelefone
            valor={form.whatsapp}
            onChange={handleWhatsapp}
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

          {/* PROCEDIMENTOS: CAIXAS, E NÃO TEXTO LIVRE.

              Digitado, o mesmo tratamento vira "Lentes de Contato", "lente de
              contato" e "lente pro dente" — três linhas do mesmo no relatório,
              e a pergunta "qual o mais procurado?" fica sem resposta.

              Caixas e não lista suspensa porque uma pessoa quer mais de uma
              coisa: lentes E clareamento é o caso normal, não a exceção. */}
          <div>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
              Serviços de Interesse <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(opcional)</span>
            </label>
            {catalogo.length === 0 ? (
              <div style={{ ...inputStyle, color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>
                Carregando os serviços da empresa...
              </div>
            ) : (
              <div style={{
                border: '1px solid var(--border)', borderRadius: 9, padding: 8,
                maxHeight: 190, overflowY: 'auto',
                display: 'grid', gap: 2,
                gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
              }}>
                {catalogo.map((nome) => {
                  const marcado = form.procedimentos.includes(nome)
                  return (
                    <label key={nome} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 8px', borderRadius: 7, cursor: 'pointer',
                      background: marcado ? 'var(--accent-soft)' : 'transparent',
                      fontSize: 13, color: marcado ? 'var(--text)' : 'var(--muted)',
                      fontWeight: marcado ? 600 : 400,
                    }}>
                      <input
                        type="checkbox" checked={marcado}
                        onChange={() => set('procedimentos', marcado
                          ? form.procedimentos.filter((p) => p !== nome)
                          : [...form.procedimentos, nome])}
                        style={{ accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }}
                      />
                      {nome}
                    </label>
                  )
                })}
              </div>
            )}
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 5 }}>
              {form.procedimentos.length === 0
                ? 'Pode marcar mais de um, ou nenhum.'
                : `${form.procedimentos.length} marcado${form.procedimentos.length > 1 ? 's' : ''}.`}
            </div>
          </div>

          {/* A CONSULTA, DENTRO DO CADASTRO.

              Cadastrar um Cliente gravava "consulta realizada" sem dizer
              QUANDO: a coluna "Última Consulta" ficava em "Cadastrado à mão"
              para sempre, e a pessoa não tinha uma linha sequer no histórico.

              Só a data e a hora aparecem em repouso; o resto nasce quando ela é
              preenchida. Um formulário de agendamento inteiro sempre aberto num
              campo opcional é peso cobrado de quem não vai usá-lo.

              Vazio não cria nada, e esse caso é real: quem migra uma ficha
              antiga quase nunca sabe a data. */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-subtle)', padding: '14px 14px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, flexWrap: 'wrap' }}>
              <CalendarPlus size={14} color="var(--accent)" />
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>
                Reunião
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>(opcional)</span>
            </div>

            <input
              type="datetime-local"
              value={consulta.quando}
              onChange={(e) => {
                setAgora(Date.now())
                setC('quando', e.target.value)
                // Quem marcou UM interesse quase sempre vai marcar a consulta
                // dele. É sugestão, não trava — a lista continua aberta.
                if (e.target.value && !consulta.assunto && form.procedimentos.length === 1) {
                  setC('assunto', form.procedimentos[0])
                }
                setError('')
              }}
              style={inputStyle}
              onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')}
              onBlur={(e) => (e.target.style.borderColor = 'var(--border)')}
            />

            {!consulta.quando ? (
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>
                Sem data, nenhuma reunião é criada — e a pessoa entra como <strong>Contato</strong>.
                O contato só entra em Clientes quando a venda estiver na etapa Ganho.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 5 }}>
                    Serviço *
                  </label>
                  <select
                    value={consulta.assunto}
                    onChange={(e) => { setC('assunto', e.target.value); setError('') }}
                    style={{ ...inputStyle, cursor: 'pointer' }}
                  >
                    <option value="">{catalogo.length ? 'Escolha o serviço...' : 'Carregando...'}</option>
                    {catalogo.map((nome) => (
                      <option key={nome} value={nome}>{nome}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ flex: 2, minWidth: 0 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 5 }}>
                      Profissional
                    </label>
                    <select value={consulta.profissional_id} onChange={(e) => setC('profissional_id', e.target.value)}
                      style={{ ...inputStyle, cursor: 'pointer' }}>
                      <option value="">Sem profissional definido</option>
                      {profissionais.map((p) => (
                        <option key={p.id} value={p.id}>{`${p.nome} ${p.sobrenome}`.trim()}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 5 }}>
                      Duração
                    </label>
                    <select value={consulta.duracao} onChange={(e) => setC('duracao', e.target.value)}
                      style={{ ...inputStyle, cursor: 'pointer' }}>
                      {DURACOES.map((d) => (
                        <option key={d} value={d}>{d} min</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* A tela dizendo o que vai fazer, e a frase muda no instante em
                    que a data cruza o presente. Sem isto, "passado vira Cliente
                    e futuro não" seria uma regra que só se descobre depois. */}
                <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5 }}>
                  {jaAconteceu
                    ? <>A reunião será registrada como <strong>realizada</strong>. O fechamento da venda é independente.</>
                    : <>A reunião será registrada na agenda. A oportunidade continua no funil comercial.</>}
                </div>

                {foraDaJornada && (
                  <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger-border)', borderRadius: 8, padding: '9px 12px', fontSize: 11.5, color: 'var(--danger)', lineHeight: 1.5 }}>
                    {foraDaJornada} Escolha outro horário, outro profissional, ou ajuste a jornada em <strong>Profissionais</strong>.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Anotações */}
          <div>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
              Anotações <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(opcional)</span>
            </label>
            <textarea value={form.anotacoes} onChange={(e) => set('anotacoes', e.target.value)} rows={3} placeholder="Observações iniciais sobre o contato..." style={{ ...inputStyle, resize: 'vertical' }}
              onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')} onBlur={(e) => (e.target.style.borderColor = 'var(--border)')} />
          </div>
        </div>

        {error && (
          <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger-border)', borderRadius: 8, padding: '9px 12px', fontSize: 13, color: 'var(--danger)', marginTop: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: 'var(--muted)', fontFamily: "var(--font-body)" }}>
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving || !!duplicado || !!foraDaJornada}
            style={{ flex: 2, padding: '10px', borderRadius: 9, border: 'none', background: (duplicado || foraDaJornada) ? 'var(--border)' : saving ? 'var(--action-hover)' : 'var(--action)', cursor: (saving || duplicado || foraDaJornada) ? 'not-allowed' : 'pointer', fontSize: 13.5, fontWeight: 600, color: (duplicado || foraDaJornada) ? 'var(--muted)' : 'var(--on-action)', fontFamily: "var(--font-body)" }}>
            {/* O botão diz o que vai SAIR, não o que a página se chama: quem
                abriu "Novo Cliente" e não deu data leva um Contato, e precisa
                saber disso antes de clicar. */}
            {saving ? 'Cadastrando...' : 'Cadastrar contato'}
          </button>
        </div>
      </div>
    </div></ModalPortal>
  )
}

/* ──────────────────────────────────────────────
   Página
────────────────────────────────────────────── */
export default function PessoasPage({ mode }: { mode: PessoasMode }) {
  const funil = useFunil()
  const cfg = CONFIG[mode]
  const Icone = cfg.icone
  const navigate = useNavigate()

  const [allLeads, setAllLeads] = useState<Contato[]>([])
  const [loading, setLoading] = useState(true)

  /* O FILTRO POR ETAPA VEM DA URL, e não de um estado solto.

     Quem chega aqui pelo "+ N outros" de uma coluna do CRM chega com
     `?etapa=negociacao&periodo=all`. Guardar isso na URL é o que faz o
     link funcionar, o F5 preservar o recorte, e o "voltar" do navegador
     desfazer o filtro sem precisar de um botão para isso.

     ⚠️ O PERÍODO TAMBÉM VEM DE LÁ. Sem isso o CRM prometeria "+312 outros" e
     esta tela abriria no padrão dela ("Este mês"), mostrando 40 — o número da
     tela anterior viraria mentira no clique. */
  const [params, setParams] = useSearchParams()
  const etapa = params.get('etapa') as LeadStatus | null

  const [period, setPeriod] = useState<PeriodKey>(
    () => (params.get('periodo') as PeriodKey | null) ?? 'this_month',
  )
  const [customRange, setCustomRange] = useState<DateRange>(() => {
    const de = params.get('de')
    const ate = params.get('ate')
    return de && ate
      ? { start: new Date(de), end: new Date(ate) }
      : { start: new Date(), end: new Date() }
  })
  const [search, setSearch] = useState('')
  const [showNewLead, setShowNewLead] = useState(false)

  /* Limpar a etapa tira só ela da URL — o período escolhido continua valendo,
     que é o que a pessoa esperaria de um "✕" na etiqueta da etapa. */
  const limparEtapa = () => {
    const novo = new URLSearchParams(params)
    novo.delete('etapa')
    setParams(novo, { replace: true })
  }

  /* A etapa pedida pertence a esta página? "Consulta Realizada" e "Cliente
     Recorrente" moram em Clientes; o resto, em Contatos. O CRM já manda para
     o lugar certo — isto cobre a URL digitada à mão, que sem aviso daria uma
     lista vazia sem explicação. */
  const etapaEhDaqui = etapa === null
    || (mode === 'clientes' ? isCliente(etapa) : !isCliente(etapa))

  // Extraído para poder ser chamado de novo depois de uma baixa de consulta:
  // confirmar que a pessoa compareceu MUDA ELA DE TELA (vira Cliente), e a
  // lista precisa refletir isso na hora.
  const [erroCarga, setErroCarga] = useState('')
  const recarregarPessoas = useCallback(async () => {
    try {
      const lista: Contato[] = []
      for (let inicio = 0; ; inicio += 500) {
        const { data, error } = await supabase.from('contatos').select('*').order('created_at', { ascending: false }).order('id').range(inicio, inicio + 499)
        if (error) throw error
        lista.push(...data as Contato[])
        if (data.length < 500) break
      }
      setAllLeads(lista); setErroCarga('')
    } catch { setErroCarga('Não foi possível carregar os contatos. Tente atualizar.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { recarregarPessoas() }, [recarregarPessoas])

  const handleNewLeadSaved = (lead: Contato) => {
    setAllLeads((prev) => [lead, ...prev])
    // Cadastrou alguém que pertence à outra página? Leva o usuário até lá,
    // senão o registro "some" logo após ser criado.
    const pertenceAqui = mode === 'clientes' ? isCliente(lead.status) : !isCliente(lead.status)
    if (!pertenceAqui) navigate(cfg.outraPagina.rota)
  }

  const range = getPeriodRange(period, customRange)

  const periodFiltered = allLeads.filter((l) => inRange(l.created_at, range))

  const searched = periodFiltered.filter((l) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    // O telefone é comparado só por dígitos: quem busca digita "(11) 98765" ou
    // "11987654321", e o banco guarda "5511987654321". Comparar o texto cru
    // faria a busca por telefone nunca achar nada.
    const digitos = apenasDigitos(search)
    return (
      (l.nome ?? '').toLowerCase().includes(q) ||
      (l.empresa ?? '').toLowerCase().includes(q) ||
      (l.email ?? '').toLowerCase().includes(q) ||
      (digitos.length > 0 && (l.whatsapp ?? '').includes(digitos))
    )
  })

  const displayed = searched
    .filter((l) => (mode === 'clientes' ? isCliente(l.status) : !isCliente(l.status)))
    .filter((l) => (etapa ? l.status === etapa : true))

  /* ── Export CSV ── */
  const exportCSV = () => {
    const rows = [
      ['Nome', 'Telefone', 'Serviço', 'Status', 'Início Atendimento', cfg.colunaData.titulo],
      ...displayed.map((l) => [
        l.nome ?? '',
        formatarParaExibicao(l.whatsapp),
        l.interesses_texto ?? '',
        funil.rotulo(l.status),
        fmtDate(l.inicio_atendimento),
        fmtDate(l[cfg.colunaData.campo]),
      ]),
    ]
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `${cfg.arquivo}_${new Date().toISOString().split('T')[0]}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  /* ── Export PDF ── */
  const exportPDF = () => {
    const doc = new jsPDF({ orientation: 'landscape' })
    doc.setFont('helvetica')
    doc.setFontSize(14)
    doc.text(cfg.titulo, 14, 16)
    doc.setFontSize(10)
    doc.setTextColor(120)
    doc.text(`Exportado em ${new Date().toLocaleString('pt-BR')}`, 14, 22)
    autoTable(doc, {
      startY: 28,
      head: [['Nome', 'Telefone', 'Serviço', 'Status', 'Início Atendimento', cfg.colunaData.titulo]],
      body: displayed.map((l) => [
        l.nome ?? '—',
        formatarParaExibicao(l.whatsapp) || '—',
        l.interesses_texto ?? '—',
        funil.rotulo(l.status),
        fmtDate(l.inicio_atendimento),
        fmtDate(l[cfg.colunaData.campo]),
      ]),
      // #1E6E8C e #F7FAFB — a paleta azul, em RGB
      headStyles: { fillColor: [30, 110, 140], fontSize: 9, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8.5 },
      alternateRowStyles: { fillColor: [247, 250, 251] },
      styles: { font: 'helvetica', cellPadding: 4 },
    })
    doc.save(`${cfg.arquivo}_${new Date().toISOString().split('T')[0]}.pdf`)
  }

  if (loading) {
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
      <div className="fade-in-1" style={{ marginBottom: 22, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 660 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icone size={18} color={cfg.corIcone} strokeWidth={2} />
            </div>
            {erroCarga && <p role="alert">{erroCarga} <button onClick={() => void recarregarPessoas()}>Atualizar</button></p>}
            <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{cfg.titulo}</h1>
            <span style={{ background: 'var(--accent-soft)', color: 'var(--accent)', borderRadius: 20, fontSize: 12.5, fontWeight: 700, padding: '2px 10px' }}>
              {displayed.length}
            </span>
          </div>

          {/* Mesmo tamanho da copy do Dashboard */}
          <p style={{ fontSize: 14, fontWeight: 400, color: 'var(--muted)', marginTop: 10, marginBottom: 0, lineHeight: 1.45 }}>
            {cfg.subtitulo}
          </p>

          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8, marginBottom: 0, lineHeight: 1.6 }}>
            {cfg.explicacao}
          </p>

          <button
            onClick={() => navigate(cfg.outraPagina.rota)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 12, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--accent)', fontFamily: "var(--font-body)", transition: 'background 0.15s' }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-soft)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'var(--surface)')}
          >
            {cfg.outraPagina.label} <ArrowRight size={13} />
          </button>
        </div>

        <button
          onClick={() => setShowNewLead(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 10, border: 'none', background: 'var(--action)', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: 'var(--on-action)', fontFamily: "var(--font-body)", flexShrink: 0, transition: 'background 0.15s' }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'var(--action-hover)')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'var(--action)')}
        >
          <UserPlus size={16} /> {cfg.botaoNovo}
        </button>
      </div>

      {/* Consultas que já aconteceram e ninguém confirmou. Some sozinho
          quando não há nenhuma. */}
      <div className="fade-in-2">
        <AvisoBaixaConsulta onBaixa={recarregarPessoas} />
      </div>

      {/* Period filter */}
      <div className="fade-in-2" style={{ marginBottom: 20, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <FiltroPeriodo
          periodo={period}
          onPeriodo={setPeriod}
          faixa={customRange}
          onFaixa={setCustomRange}
        />

        {/* A ETAPA APARECE COMO ETIQUETA, e não como mais uma lista suspensa.

            Ela não é um filtro que se escolhe aqui: é um recorte que veio de
            outra tela. Etiqueta com "✕" diz as duas coisas de uma vez — o que
            está valendo, e como sair. Uma lista com "Todas as etapas" ocuparia
            espaço permanente por algo que quase nunca é escolhido daqui. */}
        {etapa && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: 'var(--accent-soft)', border: '1px solid var(--border)', borderRadius: 10,
            padding: '7px 10px 7px 12px', fontSize: 13, fontWeight: 600, color: 'var(--accent)',
          }}>
            <Filter size={13} />
            {funil.rotulo(etapa)}
            <button
              onClick={limparEtapa}
              title="Tirar o filtro de etapa"
              style={{
                display: 'flex', alignItems: 'center', background: 'none', border: 'none',
                padding: 2, borderRadius: 5, cursor: 'pointer', color: 'var(--accent)',
              }}
            >
              <X size={13} />
            </button>
          </div>
        )}
      </div>

      {/* Etapa que não é desta página: acontece com URL digitada à mão. Sem
          esta linha o resultado seria uma lista vazia sem motivo aparente. */}
      {!etapaEhDaqui && etapa && (
        <div className="fade-in-2" style={{
          marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          background: 'var(--warning-soft)', border: '1px solid var(--warning-border)', borderRadius: 10,
          padding: '10px 13px', fontSize: 12.5, color: 'var(--warning)',
        }}>
          <span>
            <strong>{funil.rotulo(etapa)}</strong> não aparece nesta página.
          </span>
          <button
            onClick={() => navigate(`${cfg.outraPagina.rota}?${new URLSearchParams({ etapa, periodo: period })}`)}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontSize: 12.5, fontWeight: 700, color: 'var(--accent)',
              fontFamily: "var(--font-body)",
            }}
          >
            Ver em {cfg.outraPagina.label.replace('Ver ', '')} →
          </button>
        </div>
      )}

      {/* Search + Export */}
      <div className="fade-in-3" style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240, position: 'relative' }}>
          <Search size={15} color="var(--muted)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            placeholder="Buscar por nome ou telefone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', padding: '9px 12px 9px 36px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 13.5, fontFamily: "var(--font-body)", color: 'var(--text)', background: 'var(--surface)', outline: 'none', transition: 'border-color 0.15s' }}
            onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')}
            onBlur={(e) => (e.target.style.borderColor = 'var(--border)')}
          />
        </div>
        <button onClick={exportCSV} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--text)', fontFamily: "var(--font-body)", transition: 'background 0.15s' }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'var(--page)')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'var(--surface)')}>
          <Download size={15} /> Exportar CSV
        </button>
        <button onClick={exportPDF} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--text)', fontFamily: "var(--font-body)", transition: 'background 0.15s' }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'var(--page)')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'var(--surface)')}>
          <FileText size={15} /> Exportar PDF
        </button>
      </div>

      {/* Table */}
      <div className="fade-in-4" style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden', marginBottom: 32 }}>
        {displayed.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', fontSize: 14 }}>
            {search ? 'Nenhum resultado para a busca.' : cfg.vazio}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-subtle)' }}>
                  {['Nome / Telefone', 'Serviço', 'Status', 'Início Atendimento', cfg.colunaData.titulo, ''].map((h, i) => (
                    <th key={i} style={{ textAlign: 'left', padding: '11px 16px', fontSize: 12, fontWeight: 600, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayed.map((lead, idx) => (
                  <tr key={lead.id}
                    style={{ borderBottom: '1px solid var(--border-subtle)', background: idx % 2 === 0 ? 'var(--surface)' : 'var(--surface-subtle)', transition: 'background 0.12s' }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = 'var(--accent-soft)')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = idx % 2 === 0 ? 'var(--surface)' : 'var(--surface-subtle)')}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text)' }}>{lead.nome ?? '—'}</div>
                      {lead.empresa && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{lead.empresa}</div>}
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{formatarParaExibicao(lead.whatsapp)}</div>
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--muted)' }}>{lead.interesses_texto ?? '—'}</td>
                    <td style={{ padding: '12px 16px' }}><StatusBadge status={lead.status} /></td>
                    <td style={{ padding: '12px 16px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmtDate(lead.inicio_atendimento)}</td>
                    <td style={{ padding: '12px 16px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {lead[cfg.colunaData.campo]
                        ? fmtDate(lead[cfg.colunaData.campo])
                        : <span style={{ color: 'var(--muted)' }}>{cfg.colunaData.vazio}</span>}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <button onClick={() => navigate(`/leads/${lead.id}`)}
                        style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--accent)', fontFamily: "var(--font-body)", transition: 'background 0.15s, border-color 0.15s', whiteSpace: 'nowrap' }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-soft)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--chart-blue)' }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)' }}>
                        Detalhes
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNewLead && (
        <NewLeadModal
          titulo={cfg.botaoNovo}
          onClose={() => setShowNewLead(false)}
          onSaved={handleNewLeadSaved}
        />
      )}

      <style>{`
        @keyframes pulse-dot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(1.4); } }
      `}</style>
    </div>
  )
}
