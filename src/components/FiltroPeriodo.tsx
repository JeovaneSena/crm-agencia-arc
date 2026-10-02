import { useState, type CSSProperties } from 'react'
import { CalendarRange } from 'lucide-react'
import {
  periodosFixos, endOfDay,
  type DateRange, type PeriodKey,
} from '../lib/periodo'

/**
 * O filtro de período do Dashboard, de Leads e de Clientes.
 *
 * ── DE NOVE BOTÕES PARA UMA LISTA E UM BOTÃO ───────────────────────────────
 *
 * Eram nove pílulas numa faixa que quebrava em duas linhas em qualquer tela
 * estreita, empurrando o conteúdo da página para baixo. Nove opções lado a
 * lado também não têm hierarquia: "Hoje" e "Ano passado" pediam o mesmo
 * esforço de leitura, sendo que uma é escolhida todo dia e a outra quase
 * nunca.
 *
 * ── E POR QUE "PERSONALIZADO" FICA FORA DA LISTA ───────────────────────────
 *
 * Porque ele não é um período, é um **modo**. Dentro da lista, escolhê-lo
 * fechava a lista e mostrava a palavra "Personalizado" — que não diz de quando
 * até quando —, obrigando a abrir de novo para ver o que estava valendo. Fora
 * dela, ele acende junto com as duas datas, e as datas são a resposta.
 *
 * Enquanto o modo está ligado, a lista mostra um item apagado em vez de mentir
 * "Este mês" enquanto o recorte é outro. Escolher qualquer período nela desliga
 * o modo — é o caminho de volta, sem um segundo botão para isso.
 */

const FONTE = "var(--font-body)"

interface Props {
  periodo: PeriodKey
  onPeriodo: (novo: PeriodKey) => void
  /** A faixa do modo personalizado. Ignorada enquanto ele está desligado. */
  faixa: DateRange
  onFaixa: (nova: DateRange) => void
}

const hoje = () => new Date().toISOString().split('T')[0]
const paraInput = (d: Date) => d.toISOString().split('T')[0]

export default function FiltroPeriodo({ periodo, onPeriodo, faixa, onFaixa }: Props) {
  const personalizado = periodo === 'custom'

  /* A lista tem três meses fechados no meio (Julho, Junho, Maio), e por isso
     depende de que dia é hoje. Ler o relógio direto na renderização é impuro —
     o inicializador do `useState` roda uma vez e resolve. */
  const [opcoes] = useState(() => periodosFixos())

  const campoData: CSSProperties = {
    border: 'none', outline: 'none', fontSize: 13, fontFamily: FONTE,
    color: 'var(--text)', cursor: 'pointer', background: 'transparent',
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>

      <select
        aria-label="Período"
        value={personalizado ? '' : periodo}
        onChange={(e) => { onPeriodo(e.target.value as PeriodKey) }}
        style={{
          padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)',
          fontSize: 13.5, fontWeight: 600, fontFamily: FONTE,
          color: personalizado ? 'var(--muted)' : 'var(--text)',
          background: 'var(--surface)', outline: 'none', cursor: 'pointer', minWidth: 172,
        }}
      >
        {/* Só existe enquanto o modo personalizado está ligado, e é inerte:
            serve para a lista não afirmar um período que não está valendo. */}
        {personalizado && <option value="" disabled>Período personalizado</option>}
        {opcoes.map(({ chave, rotulo }) => (
          <option key={chave} value={chave}>{rotulo}</option>
        ))}
      </select>

      <button
        onClick={() => { onPeriodo('custom') }}
        aria-pressed={personalizado}
        title="Escolher as datas de início e fim"
        style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '9px 14px', borderRadius: 10,
          border: personalizado ? 'none' : '1px solid var(--border)',
          background: personalizado ? 'var(--action)' : 'var(--surface)',
          color: personalizado ? 'var(--on-action)' : 'var(--text)',
          cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: FONTE,
          transition: 'background 0.15s ease, color 0.15s ease',
        }}
      >
        <CalendarRange size={15} /> Personalizado
      </button>

      {personalizado && (
        <div className="period-custom" style={{
          display: 'inline-flex', alignItems: 'center', gap: 10,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
          padding: '7px 14px', fontSize: 13, fontFamily: FONTE,
        }}>
          <span style={{ color: 'var(--muted)' }}>De</span>
          <input
            aria-label="Data inicial do período"
            type="date"
            max={hoje()}
            value={paraInput(faixa.start)}
            onChange={(e) => { onFaixa({ ...faixa, start: new Date(e.target.value) }) }}
            style={campoData}
          />
          <span style={{ color: 'var(--muted)' }}>até</span>
          <input
            aria-label="Data final do período"
            type="date"
            max={hoje()}
            value={paraInput(faixa.end)}
            onChange={(e) => { onFaixa({ ...faixa, end: endOfDay(new Date(e.target.value)) }) }}
            style={campoData}
          />
        </div>
      )}
    </div>
  )
}
