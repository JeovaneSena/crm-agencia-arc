import { DoorOpen, Clock, Pencil, TriangleAlert, Tag } from 'lucide-react'
import { formatarReais } from '../lib/procedimentos'
import { useAgente } from '../lib/agente'
import type { ServicoCatalogo } from '../types'

/**
 * A porta de entrada da empresa — a Avaliação Odontológica.
 *
 * ── POR QUE ELA NÃO É UM DOS CARDS ─────────────────────────────────────────
 *
 * Ela não é um tratamento: é por onde os tratamentos começam. No meio da grade
 * ela vira o vigésimo card igual aos outros, quando é a consulta que mais vai
 * acontecer na empresa — e a única que o assistente marca sozinha.
 *
 * Fica em cima, com contorno próprio, e os tratamentos ficam embaixo.
 *
 * ── E POR QUE ELA EXISTE COMO REGISTRO ─────────────────────────────────────
 *
 * Seria mais fácil o agente ter o nome dela escrito no código. Mas aí a duração
 * do bloco, a gratuidade e o próprio nome ficariam presos num deploy. Aqui a
 * empresa muda os três quando quiser, e a mudança chega na conversa seguinte.
 *
 * ── SÓ MOSTRA; QUEM EDITA É O MODAL ────────────────────────────────────────
 *
 * Nome, textos, duração e valor se mudam em **Editar**, no mesmo modal dos
 * outros procedimentos. Ter campo editável aqui e no modal seria a mesma coisa
 * em dois lugares, e um dia os dois discordariam.
 */

const FONTE = "var(--font-body)"

interface Props {
  porta: ServicoCatalogo | null
  onEditar: (p: ServicoCatalogo) => void
}

export default function PortaDeEntrada({ porta, onEditar }: Props) {
  const { nome: nomeAgente } = useAgente()
  if (!porta) {
    return (
      <div className="fade-in-2" style={{
        background: 'var(--danger-soft)', border: '1px solid var(--danger-border)', borderRadius: 13,
        padding: '16px 18px', marginBottom: 18, fontFamily: FONTE,
        display: 'flex', alignItems: 'flex-start', gap: 10,
      }}>
        <TriangleAlert size={16} color="var(--danger)" style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--danger)' }}>
            Nenhum serviço está marcado como diagnóstico
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--danger)', lineHeight: 1.6, marginTop: 4 }}>
            Sem porta de entrada, a {nomeAgente} marca qualquer projeto direto —
            inclusive os que precisam do especialista olhar antes.
          </div>
        </div>
      </div>
    )
  }

  const gratuita = porta.preco_a_partir_de === 0

  return (
    <div className="fade-in-2" style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 13,
      borderLeft: '3px solid var(--accent)',
      padding: '16px 18px', marginBottom: 18, fontFamily: FONTE,
    }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
        <DoorOpen size={15} color="var(--accent)" />
        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--accent)', letterSpacing: 0.3, textTransform: 'uppercase' }}>
          A porta de entrada
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{porta.nome}</div>
          <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, margin: '5px 0 0' }}>
            {porta.descricao}
          </p>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, marginTop: 8 }}>
            É o que a {nomeAgente} marca no lugar de todo serviço com{' '}
            <strong style={{ color: 'var(--text)' }}>&ldquo;Passa pelo diagnóstico&rdquo;</strong> ligado.
            O que a pessoa procura fica registrado junto, e aparece na Agenda.
          </div>
        </div>

        <button onClick={() => onEditar(porta)}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--text)', fontFamily: FONTE, flexShrink: 0 }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-subtle)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface)' }}>
          <Pencil size={13} color="var(--muted)" /> Editar
        </button>
      </div>

      {/* Os dois dados que o assistente usa. Mudam em Editar. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', marginTop: 13, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--muted)' }}>
          <Clock size={13} /> {porta.duracao_minutos} minutos
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: gratuita ? 'var(--success)' : 'var(--muted)' }}>
          <Tag size={13} />
          {gratuita
            ? 'Gratuita'
            : porta.preco_a_partir_de
              ? `A partir de ${formatarReais(porta.preco_a_partir_de)}`
              : 'Sem valor cadastrado'}
        </span>
      </div>

      {gratuita && (
        <div style={{ fontSize: 12, color: 'var(--success)', background: 'var(--success-soft)', border: '1px solid var(--success-border)', borderRadius: 8, padding: '8px 11px', marginTop: 11, lineHeight: 1.6 }}>
          Gratuita não é só um preço zerado: é a frase que a {nomeAgente} usa quando
          alguém trava no valor. Sem ela, a resposta vira &ldquo;o valor a gente vê no
          diagnóstico&rdquo;, que soa como desconversa.
        </div>
      )}
    </div>
  )
}
