import ModalPortal from '../components/ModalPortal'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, X, Pencil, Trash2, CalendarDays, BriefcaseBusiness, ArrowRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { PALETA_PROFISSIONAIS, proximaCorLivre } from '../lib/cores'
import { NOMES_DIAS } from '../lib/agenda'
import { useSessao } from '../lib/sessao'
import { Notice } from './../components/ui'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'
import type { Profissional, ProfissionalHorario } from '../types'

/* ──────────────────────────────────────────────
   Profissionais — os profissionais da empresa.

   Cadastrar um profissional aqui É criar a agenda dele: a agenda de alguém são
   as consultas com o `profissional_id` dele, não uma segunda entidade. Por isso
   não existe tela de "criar agenda" e não há como um profissional ficar sem uma.

   O profissional NÃO faz login e NÃO está preso a procedimentos — é só nome,
   cor e jornada.
────────────────────────────────────────────── */

const JORNADA_PADRAO = Array.from({ length: 7 }, (_, dia) => ({
  dia_semana: dia,
  hora_inicio: '08:00',
  hora_fim: '18:00',
  ativo: dia >= 1 && dia <= 5,
}))

interface LinhaJornada {
  dia_semana: number
  hora_inicio: string
  hora_fim: string
  ativo: boolean
}

interface ProfissionalComJornada {
  profissional: Profissional
  jornada: LinhaJornada[]
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)', fontSize: 13.5,
  fontFamily: "var(--font-body)", color: 'var(--text)', outline: 'none', background: 'var(--surface)', boxSizing: 'border-box',
}

const timeInputStyle: React.CSSProperties = {
  padding: '6px 9px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13,
  fontFamily: "var(--font-body)", color: 'var(--text)', outline: 'none', background: 'var(--surface)',
}

/** "Seg, Ter, Qua • 08:00–18:00" — resumo da jornada no card. */
function resumoJornada(jornada: LinhaJornada[]): string {
  const ativos = jornada.filter((j) => j.ativo)
  if (ativos.length === 0) return 'Sem dias de atendimento'
  const dias = ativos.map((j) => NOMES_DIAS[j.dia_semana].slice(0, 3)).join(', ')
  const faixas = [...new Set(ativos.map((j) => `${j.hora_inicio.slice(0, 5)}–${j.hora_fim.slice(0, 5)}`))]
  return `${dias} • ${faixas.length === 1 ? faixas[0] : 'horários variados'}`
}

/* ──────────────────────────────────────────────
   Modal de cadastro / edição
────────────────────────────────────────────── */
function ModalProfissional({
  edicao, coresEmUso, onClose, onSalvo,
}: {
  edicao: ProfissionalComJornada | null
  coresEmUso: string[]
  onClose: () => void
  onSalvo: (p: ProfissionalComJornada) => void
}) {
  const [nome, setNome] = useState(edicao?.profissional.nome ?? '')
  const [sobrenome, setSobrenome] = useState(edicao?.profissional.sobrenome ?? '')
  const [cor, setCor] = useState(edicao?.profissional.cor ?? proximaCorLivre(coresEmUso))
  const [jornada, setJornada] = useState<LinhaJornada[]>(edicao?.jornada ?? JORNADA_PADRAO)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const atualizarDia = (dia: number, campo: keyof LinhaJornada, valor: string | boolean) =>
    setJornada((prev) => prev.map((j) => (j.dia_semana === dia ? { ...j, [campo]: valor } : j)))

  const handleSalvar = async () => {
    if (!nome.trim()) { setErro('O nome é obrigatório.'); return }
    const invalido = jornada.find((j) => j.ativo && j.hora_fim <= j.hora_inicio)
    if (invalido) { setErro(`Em ${NOMES_DIAS[invalido.dia_semana]}, o fim do expediente precisa ser depois do início.`); return }

    setSalvando(true); setErro('')

    if (edicao) {
      const { error: erroProf } = await supabase.from('profissionais')
        .update({ nome: nome.trim(), sobrenome: sobrenome.trim(), cor })
        .eq('id', edicao.profissional.id)
      if (erroProf) { setSalvando(false); setErro('Erro ao salvar o profissional. Tente novamente.'); return }

      // upsert pela chave (profissional_id, dia_semana): a jornada pode ter sido
      // criada antes com dias que agora mudaram de horário.
      const { error: erroJornada } = await supabase.from('profissional_horarios')
        .upsert(
          jornada.map((j) => ({ ...j, profissional_id: edicao.profissional.id })),
          { onConflict: 'profissional_id,dia_semana' },
        )
      if (erroJornada) { setSalvando(false); setErro('O profissional foi salvo, mas houve erro ao salvar a jornada.'); return }

      setSalvando(false)
      onSalvo({
        profissional: { ...edicao.profissional, nome: nome.trim(), sobrenome: sobrenome.trim(), cor },
        jornada,
      })
      onClose()
      return
    }

    const { data, error: erroProf } = await supabase.from('profissionais')
      .insert({ nome: nome.trim(), sobrenome: sobrenome.trim(), cor })
      .select().single()
    if (erroProf || !data) { setSalvando(false); setErro('Erro ao cadastrar o profissional. Tente novamente.'); return }

    const novo = data as Profissional
    const { error: erroJornada } = await supabase.from('profissional_horarios')
      .insert(jornada.map((j) => ({ ...j, profissional_id: novo.id })))

    if (erroJornada) {
      // Desfaz: profissional sem jornada apareceria na agenda como quem nunca
      // atende, e o erro ficaria invisível até alguém tentar agendar com ele.
      await supabase.from('profissionais').delete().eq('id', novo.id)
      setSalvando(false)
      setErro('Erro ao salvar a jornada. Nada foi cadastrado — tente novamente.')
      return
    }

    setSalvando(false)
    onSalvo({ profissional: novo, jornada })
    onClose()
  }

  return (
    <ModalPortal label={"Responsável e jornada"} onClose={onClose} busy={salvando}><div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, overflowY: 'auto' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)', width: '100%', maxWidth: 560, padding: '28px 28px 24px', boxShadow: '0 8px 48px rgba(0,0,0,0.12)', margin: 'auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
            {edicao ? 'Editar Profissional' : 'Novo Profissional'}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X size={18} color="var(--muted)" />
          </button>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 6 }}>Nome *</label>
            <input value={nome} onChange={(e) => { setNome(e.target.value); setErro('') }} placeholder="Ex: Marina" style={inputStyle}
              onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')} onBlur={(e) => (e.target.style.borderColor = 'var(--border)')} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 6 }}>Sobrenome</label>
            <input value={sobrenome} onChange={(e) => setSobrenome(e.target.value)} placeholder="Ex: Andrade" style={inputStyle}
              onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')} onBlur={(e) => (e.target.style.borderColor = 'var(--border)')} />
          </div>
        </div>

        {/* Cor */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 3 }}>Cor na agenda *</label>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 9 }}>
            É por ela que a agenda deste profissional se distingue das outras no calendário.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {PALETA_PROFISSIONAIS.map((c) => {
              const selecionada = c.hex.toLowerCase() === cor.toLowerCase()
              const jaUsada = coresEmUso.some((u) => u.toLowerCase() === c.hex.toLowerCase()) && !selecionada
              return (
                <button key={c.hex} onClick={() => setCor(c.hex)} title={jaUsada ? `${c.nome} — já usada por outro profissional` : c.nome}
                  style={{
                    width: 34, height: 34, borderRadius: 10, background: c.hex, cursor: 'pointer',
                    border: selecionada ? '3px solid var(--text)' : '3px solid transparent',
                    opacity: jaUsada ? 0.35 : 1, transition: 'opacity 0.15s, border-color 0.15s', padding: 0,
                  }} />
              )
            })}
          </div>
        </div>

        {/* Jornada */}
        <div style={{ marginBottom: 4 }}>
          <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 3 }}>Horários de atuação</label>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
            Fora dessas faixas, a agenda avisa antes de marcar.
          </div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 11, overflow: 'hidden' }}>
            {jornada.map((linha, idx) => (
              <div key={linha.dia_semana}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', borderBottom: idx < 6 ? '1px solid var(--border-subtle)' : 'none', background: linha.ativo ? 'var(--surface)' : 'var(--surface-subtle)', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 130 }}>
                  <button onClick={() => atualizarDia(linha.dia_semana, 'ativo', !linha.ativo)}
                    style={{ width: 36, height: 20, borderRadius: 10, background: linha.ativo ? 'var(--action)' : 'var(--border)', border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0, padding: 0 }}>
                    <div style={{ width: 14, height: 14, borderRadius: '50%', background: 'var(--surface)', position: 'absolute', top: 3, left: linha.ativo ? 19 : 3, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                  </button>
                  <span style={{ fontSize: 13, fontWeight: 600, color: linha.ativo ? 'var(--text)' : 'var(--muted)' }}>{NOMES_DIAS[linha.dia_semana]}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <input type="time" value={linha.hora_inicio} disabled={!linha.ativo}
                    onChange={(e) => atualizarDia(linha.dia_semana, 'hora_inicio', e.target.value)}
                    style={{ ...timeInputStyle, opacity: linha.ativo ? 1 : 0.4 }} />
                  <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>até</span>
                  <input type="time" value={linha.hora_fim} disabled={!linha.ativo}
                    onChange={(e) => atualizarDia(linha.dia_semana, 'hora_fim', e.target.value)}
                    style={{ ...timeInputStyle, opacity: linha.ativo ? 1 : 0.4 }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {erro && (
          <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger-border)', borderRadius: 8, padding: '9px 12px', fontSize: 13, color: 'var(--danger)', marginTop: 14 }}>{erro}</div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: 'var(--muted)', fontFamily: "var(--font-body)" }}>Cancelar</button>
          <button onClick={handleSalvar} disabled={salvando}
            style={{ flex: 2, padding: '10px', borderRadius: 9, border: 'none', background: salvando ? 'var(--action-hover)' : 'var(--action)', cursor: salvando ? 'not-allowed' : 'pointer', fontSize: 13.5, fontWeight: 600, color: 'var(--on-action)', fontFamily: "var(--font-body)" }}>
            {salvando ? 'Salvando...' : edicao ? 'Salvar alterações' : 'Cadastrar e criar agenda'}
          </button>
        </div>
      </div>
    </div></ModalPortal>
  )
}

/* ──────────────────────────────────────────────
   Página
────────────────────────────────────────────── */
export default function Profissionais() {
  // Consultor precisa VER a jornada para marcar reunião no horário certo.
  // Quem cadastra e muda é o gestor — `profissionais_gestor`, na 0034.
  const { gestor } = useSessao()
  const [itens, setItens] = useState<ProfissionalComJornada[]>([])
  const [carregando, setCarregando] = useState(true)
  const [modalAberto, setModalAberto] = useState(false)
  const [emEdicao, setEmEdicao] = useState<ProfissionalComJornada | null>(null)
  const [alvoExclusao, setAlvoExclusao] = useState<ProfissionalComJornada | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const [erroExclusao, setErroExclusao] = useState('')
  const [erroGeral, setErroGeral] = useState('')

  useEffect(() => {
    Promise.all([
      supabase.from('profissionais').select('*').order('nome'),
      supabase.from('profissional_horarios').select('*'),
    ]).then(([{ data: profs }, { data: horarios }]) => {
      const todosHorarios = (horarios ?? []) as ProfissionalHorario[]
      setItens((profs ?? []).map((p) => {
        const prof = p as Profissional
        const doProfissional = todosHorarios.filter((h) => h.profissional_id === prof.id)
        return {
          profissional: prof,
          jornada: JORNADA_PADRAO.map((padrao) => {
            const salvo = doProfissional.find((h) => h.dia_semana === padrao.dia_semana)
            return salvo
              ? { dia_semana: salvo.dia_semana, hora_inicio: salvo.hora_inicio.slice(0, 5), hora_fim: salvo.hora_fim.slice(0, 5), ativo: salvo.ativo }
              : { ...padrao, ativo: false }
          }),
        }
      }))
      setCarregando(false)
    })
  }, [])

  const handleToggleAtivo = async (item: ProfissionalComJornada) => {
    const novoAtivo = !item.profissional.ativo
    setErroGeral('')
    setItens((prev) => prev.map((i) => i.profissional.id === item.profissional.id
      ? { ...i, profissional: { ...i.profissional, ativo: novoAtivo } } : i))
    const { error } = await supabase.from('profissionais').update({ ativo: novoAtivo }).eq('id', item.profissional.id)
    if (error) {
      setItens((prev) => prev.map((i) => i.profissional.id === item.profissional.id
        ? { ...i, profissional: { ...i.profissional, ativo: item.profissional.ativo } } : i))
      setErroGeral('Erro ao alterar o status. Tente novamente.')
    }
  }

  const handleExcluir = async () => {
    if (!alvoExclusao) return
    setExcluindo(true); setErroExclusao('')
    const { error } = await supabase.from('profissionais').delete().eq('id', alvoExclusao.profissional.id)
    setExcluindo(false)
    if (error) {
      // 23503 = foreign_key_violation. O `on delete restrict` de `consultas`
      // protege o histórico: quem já atendeu não pode ser apagado.
      setErroExclusao(error.code === '23503'
        ? 'Este profissional tem reuniões registradas e não pode ser excluído. Desative-o para tirá-lo da agenda sem perder o histórico.'
        : 'Erro ao excluir. Tente novamente.')
      return
    }
    setItens((prev) => prev.filter((i) => i.profissional.id !== alvoExclusao.profissional.id))
    setAlvoExclusao(null)
  }

  const abrirNovo = () => { setEmEdicao(null); setModalAberto(true) }
  const abrirEdicao = (item: ProfissionalComJornada) => { setEmEdicao(item); setModalAberto(true) }

  const handleSalvo = (item: ProfissionalComJornada) => {
    setItens((prev) => {
      const existe = prev.some((i) => i.profissional.id === item.profissional.id)
      const lista = existe
        ? prev.map((i) => (i.profissional.id === item.profissional.id ? item : i))
        : [...prev, item]
      return lista.sort((a, b) => a.profissional.nome.localeCompare(b.profissional.nome, 'pt-BR'))
    })
  }

  if (carregando) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '80vh' }}>
        <div style={{ width: 32, height: 32, border: '3px solid var(--accent-soft)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  const coresEmUso = itens
    .filter((i) => !emEdicao || i.profissional.id !== emEdicao.profissional.id)
    .map((i) => i.profissional.cor)

  return (
    <div style={{ padding: '32px 36px', maxWidth: 900, margin: '0 auto' }}>

      {/* Header */}
      <div className="fade-in-1" style={{ marginBottom: 22, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 620 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <BriefcaseBusiness size={18} color="var(--accent)" strokeWidth={2} />
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Equipe</h1>
            <span style={{ background: 'var(--accent-soft)', color: 'var(--accent)', borderRadius: 20, fontSize: 12.5, fontWeight: 700, padding: '2px 10px' }}>{itens.length}</span>
          </div>
          <p style={{ fontSize: 14, fontWeight: 400, color: 'var(--muted)', marginTop: 10, marginBottom: 0, lineHeight: 1.45 }}>
            Os especialistas da empresa.
          </p>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8, marginBottom: 0, lineHeight: 1.6 }}>
            Cadastre os profissionais que realizam atendimentos na empresa. Cada profissional terá sua própria agenda para organizar reuniões e horários.
          </p>
        </div>

        {gestor && <button onClick={abrirNovo}
          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: 'none', background: 'var(--action)', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: 'var(--on-action)', fontFamily: "var(--font-body)", flexShrink: 0 }}>
          <Plus size={15} /> Novo Profissional
        </button>}
      </div>

      {!gestor && <div style={{ marginBottom: 16 }}><Notice tone="info">
        <strong>Somente leitura.</strong> Você consulta quem atende e a jornada de cada um — é o que a agenda usa para oferecer horário. Quem cadastra e altera é um gestor.
      </Notice></div>}

      {erroGeral && (
        <div className="fade-in-2" style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger-border)', borderRadius: 9, padding: '10px 14px', fontSize: 13, color: 'var(--danger)', marginBottom: 16 }}>{erroGeral}</div>
      )}

      {/* Lista */}
      <div className="fade-in-2">
        {itens.length === 0 ? (
          <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '48px 24px', textAlign: 'center' }}>
            <BriefcaseBusiness size={34} strokeWidth={1.2} color="var(--muted)" style={{ marginBottom: 10 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Nenhum profissional cadastrado</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6, lineHeight: 1.6, maxWidth: 380, marginInline: 'auto' }}>
              Enquanto não houver ninguém aqui, a agenda não tem em que coluna colocar uma reunião.
            </div>
            {gestor && <button onClick={abrirNovo}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 18, padding: '9px 16px', borderRadius: 9, border: 'none', background: 'var(--action)', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: 'var(--on-action)', fontFamily: "var(--font-body)" }}>
              <Plus size={15} /> Cadastrar o primeiro
            </button>}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {itens.map((item) => {
              const p = item.profissional
              return (
                <div key={p.id}
                  style={{ background: 'var(--surface)', borderRadius: 13, border: '1px solid var(--border)', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', opacity: p.ativo ? 1 : 0.6 }}>

                  <div style={{ width: 10, height: 40, borderRadius: 5, background: p.cor, flexShrink: 0 }} />

                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text)' }}>
                      {p.nome} {p.sobrenome}
                      {!p.ativo && (
                        <span style={{ marginLeft: 8, background: 'var(--page)', color: 'var(--muted)', borderRadius: 20, fontSize: 11, fontWeight: 600, padding: '2px 9px' }}>Inativo</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <CalendarDays size={12.5} /> {resumoJornada(item.jornada)}
                    </div>
                  </div>

                  {gestor ? <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button onClick={() => handleToggleAtivo(item)} title={p.ativo ? 'Desativar' : 'Ativar'}
                      style={{ width: 40, height: 22, borderRadius: 11, background: p.ativo ? 'var(--action)' : 'var(--border)', border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0, padding: 0, marginRight: 6 }}>
                      <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--surface)', position: 'absolute', top: 3, left: p.ativo ? 21 : 3, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                    </button>
                    <button onClick={() => abrirEdicao(item)} title="Editar"
                      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', padding: '7px 9px', display: 'flex', alignItems: 'center' }}>
                      <Pencil size={14} color="var(--muted)" />
                    </button>
                    <button onClick={() => { setAlvoExclusao(item); setErroExclusao('') }} title="Excluir"
                      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', padding: '7px 9px', display: 'flex', alignItems: 'center' }}>
                      <Trash2 size={14} color="var(--danger)" />
                    </button>
                  </div> : <span className={`arc-tag ${p.ativo ? 'arc-tag-success' : 'arc-tag-muted'}`}>{p.ativo ? 'Ativo' : 'Inativo'}</span>}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Atalho para a agenda */}
      {itens.length > 0 && (
        <div className="fade-in-3" style={{ marginTop: 18, textAlign: 'right' }}>
          <Link to="/agenda" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none' }}>
            Ver as agendas <ArrowRight size={14} />
          </Link>
        </div>
      )}

      {modalAberto && (
        <ModalProfissional
          edicao={emEdicao}
          coresEmUso={coresEmUso}
          onClose={() => { setModalAberto(false); setEmEdicao(null) }}
          onSalvo={handleSalvo}
        />
      )}

      {alvoExclusao && (
        <ConfirmDeleteModal
          itemName={`${alvoExclusao.profissional.nome} ${alvoExclusao.profissional.sobrenome}`.trim()}
          loading={excluindo}
          error={erroExclusao}
          onConfirm={handleExcluir}
          onClose={() => { setAlvoExclusao(null); setErroExclusao('') }}
        />
      )}
    </div>
  )
}
