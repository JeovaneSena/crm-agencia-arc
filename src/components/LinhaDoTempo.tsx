import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarDays, CircleUser, Handshake, ListChecks, MessageSquare, StickyNote, UserCheck, type LucideIcon } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { montarLinhaDoTempo, type AvisoDoTempo, type EventoDeConversa, type EventoDeOportunidade, type NotaDoTempo, type ReuniaoDoTempo, type TarefaDoTempo, type TipoDeEvento } from '../lib/linhaDoTempo'
import { moduloAtivo } from '../lib/modulos'
import { useNomesDaEquipe } from '../lib/useEquipeAtiva'
import { haQuanto } from '../lib/avisos'
import { LoadingState } from './ui'

const ICONE: Record<TipoDeEvento, LucideIcon> = { contato: CircleUser, oportunidade: Handshake, reuniao: CalendarDays, aviso: AlertTriangle, mensagem: MessageSquare, nota: StickyNote, conversa: UserCheck, tarefa: ListChecks }
const VISIVEIS = 12

interface LinhaEvento { id: string; status_anterior: string | null; status_novo: string; motivo: string | null; created_at: string; oportunidades: { nome: string; contato_id: string } | null }

/** Tudo o que aconteceu com o contato, do mais novo para o mais velho. Lê eventos de oportunidade e avisos; as reuniões vêm da página. */
export default function LinhaDoTempo({ contato, reunioes, ultimaMensagem, rotuloEtapa }: {
  contato: { id: string; created_at: string }
  reunioes: ReuniaoDoTempo[]
  ultimaMensagem?: string | null
  rotuloEtapa: (chave: string) => string
}) {
  const [eventos, setEventos] = useState<EventoDeOportunidade[]>([])
  const [avisos, setAvisos] = useState<AvisoDoTempo[]>([])
  const [notas, setNotas] = useState<(NotaDoTempo & { autor_id: string | null })[]>([])
  const [conversaEventos, setConversaEventos] = useState<(EventoDeConversa & { de: string | null; para: string | null; por: string | null })[]>([])
  const [tarefas, setTarefas] = useState<(TarefaDoTempo & { por: string | null })[]>([])
  const nomes = useNomesDaEquipe()
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(false)
  const [tudo, setTudo] = useState(false)

  useEffect(() => {
    let vivo = true
    const eventosQ = supabase.from('oportunidade_eventos')
      .select('id,status_anterior,status_novo,motivo,created_at,oportunidades!inner(nome,contato_id)')
      .eq('oportunidades.contato_id', contato.id).order('created_at', { ascending: false }).limit(100)
    const avisosQ = supabase.from('avisos').select('id,contato_id,titulo,detalhe,criado_em,resolvido_em,resolucao')
      .eq('contato_id', contato.id).order('criado_em', { ascending: false }).limit(50)
    // Notas e passagens de conversa só existem com o módulo conversas.
    const comConversas = moduloAtivo('conversas')
    const notasQ = comConversas ? supabase.from('notas_conversa').select('id,contato_id,texto,autor_id,created_at').eq('contato_id', contato.id).order('created_at', { ascending: false }).limit(50) : Promise.resolve({ data: [], error: null })
    const passagensQ = comConversas ? supabase.from('conversa_eventos').select('id,contato_id,tipo,por_usuario,para_usuario,created_at').eq('contato_id', contato.id).order('created_at', { ascending: false }).limit(50) : Promise.resolve({ data: [], error: null })
    const tarefasQ = supabase.from('tarefas').select('id,contato_id,titulo,concluida_em,concluida_por').eq('contato_id', contato.id).not('concluida_em', 'is', null).order('concluida_em', { ascending: false }).limit(50)
    void Promise.all([eventosQ, avisosQ, notasQ, passagensQ, tarefasQ]).then(([ev, av, nt, ps, tf]) => {
      if (!vivo) return
      if (ev.error || av.error || nt.error || ps.error || tf.error) setErro(true)
      setTarefas(((tf.data ?? []) as unknown as { id: string; contato_id: string; titulo: string; concluida_em: string | null; concluida_por: string | null }[]).filter(t => t.contato_id === contato.id).map(t => ({ id: t.id, titulo: t.titulo, concluida_em: t.concluida_em, por: t.concluida_por, concluida_por_nome: null })))
      setNotas(((nt.data ?? []) as unknown as { id: string; contato_id: string; texto: string; autor_id: string | null; created_at: string }[]).filter(n => n.contato_id === contato.id).map(n => ({ id: n.id, texto: n.texto, created_at: n.created_at, autor_id: n.autor_id, autor_nome: null })))
      setConversaEventos(((ps.data ?? []) as unknown as { id: string; contato_id: string; tipo: EventoDeConversa['tipo']; por_usuario: string | null; para_usuario: string | null; created_at: string }[]).filter(p => p.contato_id === contato.id).map(p => ({ id: p.id, tipo: p.tipo, created_at: p.created_at, por: p.por_usuario, para: p.para_usuario, de: null, por_nome: null, para_nome: null })))
      // Defesa em profundidade: o filtro do banco já separa os contatos, mas nunca exibimos linha de outro.
      setEventos(((ev.data ?? []) as unknown as LinhaEvento[]).filter(l => l.oportunidades?.contato_id === contato.id)
        .map(l => ({ id: l.id, status_anterior: l.status_anterior, status_novo: l.status_novo, motivo: l.motivo, created_at: l.created_at, oportunidade_nome: l.oportunidades!.nome })))
      setAvisos(((av.data ?? []) as (AvisoDoTempo & { contato_id: string | null })[]).filter(a => a.contato_id === contato.id))
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [contato.id])

  const itens = useMemo(
    () => montarLinhaDoTempo({
      contato, eventos, reunioes, avisos, ultimaMensagem, rotuloEtapa,
      tarefas: tarefas.map(t => ({ ...t, concluida_por_nome: t.por ? nomes.get(t.por) ?? null : null })),
      notas: notas.map(n => ({ ...n, autor_nome: n.autor_id ? nomes.get(n.autor_id) ?? null : null })),
      conversaEventos: conversaEventos.map(c => ({ ...c, por_nome: c.por ? nomes.get(c.por) ?? null : null, para_nome: c.para ? nomes.get(c.para) ?? null : null })),
    }),
    [contato, eventos, reunioes, avisos, ultimaMensagem, rotuloEtapa, notas, conversaEventos, tarefas, nomes],
  )
  const mostrados = tudo ? itens : itens.slice(0, VISIVEIS)

  if (carregando) return <LoadingState label="Carregando a linha do tempo…" />
  return <div>
    {erro && <p role="alert" style={{ color: 'var(--danger)', fontSize: 13, marginTop: 0 }}>Parte do histórico não pôde ser carregada.</p>}
    <ol aria-label="Linha do tempo do contato" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
      {mostrados.map(ev => {
        const Icone = ICONE[ev.tipo]
        return <li key={ev.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--surface-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icone size={15} color="var(--muted)" /></span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, color: 'var(--text)', fontWeight: 600, overflowWrap: 'anywhere' }}>{ev.titulo}</div>
            {ev.detalhe && <div style={{ fontSize: 13, color: 'var(--muted)', overflowWrap: 'anywhere' }}>{ev.detalhe}</div>}
            <time dateTime={ev.quando} title={new Date(ev.quando).toLocaleString('pt-BR')} style={{ fontSize: 12, color: 'var(--muted)' }}>{haQuanto(ev.quando)} · {new Date(ev.quando).toLocaleDateString('pt-BR')}</time>
          </div>
        </li>
      })}
    </ol>
    {itens.length > VISIVEIS && <button type="button" className="arc-button arc-button-secondary" style={{ marginTop: 14 }} onClick={() => setTudo(v => !v)}>{tudo ? 'Mostrar menos' : `Mostrar tudo (${itens.length})`}</button>}
  </div>
}
