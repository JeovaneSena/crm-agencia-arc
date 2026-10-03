import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarDays, CircleUser, Handshake, MessageSquare, type LucideIcon } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { montarLinhaDoTempo, type AvisoDoTempo, type EventoDeOportunidade, type ReuniaoDoTempo, type TipoDeEvento } from '../lib/linhaDoTempo'
import { haQuanto } from '../lib/avisos'
import { LoadingState } from './ui'

const ICONE: Record<TipoDeEvento, LucideIcon> = { contato: CircleUser, oportunidade: Handshake, reuniao: CalendarDays, aviso: AlertTriangle, mensagem: MessageSquare }
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
    void Promise.all([eventosQ, avisosQ]).then(([ev, av]) => {
      if (!vivo) return
      if (ev.error || av.error) setErro(true)
      // Defesa em profundidade: o filtro do banco já separa os contatos, mas nunca exibimos linha de outro.
      setEventos(((ev.data ?? []) as unknown as LinhaEvento[]).filter(l => l.oportunidades?.contato_id === contato.id)
        .map(l => ({ id: l.id, status_anterior: l.status_anterior, status_novo: l.status_novo, motivo: l.motivo, created_at: l.created_at, oportunidade_nome: l.oportunidades!.nome })))
      setAvisos(((av.data ?? []) as (AvisoDoTempo & { contato_id: string | null })[]).filter(a => a.contato_id === contato.id))
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [contato.id])

  const itens = useMemo(
    () => montarLinhaDoTempo({ contato, eventos, reunioes, avisos, ultimaMensagem, rotuloEtapa }),
    [contato, eventos, reunioes, avisos, ultimaMensagem, rotuloEtapa],
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
