import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, Check, X } from 'lucide-react'
import {
  listarConsultasPendentes, darBaixa, quandoPassou, type ConsultaPendente,
} from '../lib/baixaConsulta'

/**
 * O aviso de consultas esperando baixa.
 *
 * **É o mesmo componente nos três lugares** — Contatos, Clientes e o painel
 * da conversa —, e é de propósito: a pergunta é uma só ("essa pessoa apareceu
 * ou não?") e uma segunda implementação divergiria no dia em que alguém
 * mudasse a regra em um lugar. Muda `leadId` e muda a abrangência; o resto é
 * idêntico.
 *
 * **Silencioso quando não há nada.** Sem pendência, não renderiza — aviso que
 * fica na tela mesmo vazio é aviso que ninguém lê quando enche.
 *
 * A cor é âmbar, não vermelha: isto é tarefa pendente, não erro. Vermelho aqui
 * competiria com as caixas de erro de verdade das mesmas telas.
 */

const FONTE = "var(--font-body)"

interface Props {
  /** Sem ele, mostra as pendências de todo mundo. Com ele, só as de uma pessoa. */
  leadId?: string
  /**
   * Chamado depois de cada baixa. Quem hospeda precisa recarregar: dar baixa
   * pode MUDAR A PESSOA DE TELA — quem compareceu deixa /leads e passa a
   * aparecer em /clientes na mesma hora.
   */
  onBaixa?: () => void
  /** Versão estreita, para a coluna lateral da conversa. */
  compacto?: boolean
}

export default function AvisoBaixaConsulta({ leadId, onBaixa, compacto = false }: Props) {
  const [pendentes, setPendentes] = useState<ConsultaPendente[]>([])
  const [salvando, setSalvando] = useState<string | null>(null)
  const [erro, setErro] = useState('')

  const recarregar = useCallback(() =>
    listarConsultasPendentes(leadId)
      .then(setPendentes)
      .catch(() => setErro('Não consegui carregar as reuniões pendentes.')),
  [leadId])

  useEffect(() => { recarregar() }, [recarregar])

  async function confirmar(consulta: ConsultaPendente, compareceu: boolean) {
    setSalvando(consulta.id)
    setErro('')
    try {
      await darBaixa(consulta.id, compareceu)
      setPendentes((prev) => prev.filter((c) => c.id !== consulta.id))
      onBaixa?.()
    } catch {
      setErro('Não consegui salvar. Tente de novo.')
    }
    setSalvando(null)
  }

  if (pendentes.length === 0 && !erro) return null

  const n = pendentes.length
  const titulo = leadId
    ? n === 1 ? 'Uma reunião esperando confirmação' : `${n} reuniões esperando confirmação`
    : n === 1 ? '1 reunião esperando confirmação' : `${n} reuniões esperando confirmação`

  return (
    <div style={{
      background: 'var(--warning-soft)', border: '1px solid var(--warning-border)', borderRadius: 12,
      padding: compacto ? '12px 13px' : '15px 18px',
      // A margem vertical vive AQUI, e não no invólucro de quem hospeda: o
      // componente some quando não há pendência, e um invólucro com padding
      // deixaria um vão de vários pixels no lugar do nada.
      margin: compacto ? '14px 0 0' : '0 0 18px',
      fontFamily: FONTE,
    }}>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
        <CalendarClock size={compacto ? 14 : 16} color="var(--warning)" style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: compacto ? 12.5 : 13.5, fontWeight: 700, color: 'var(--warning)' }}>
            {titulo}
          </div>
          <div style={{ fontSize: compacto ? 11.5 : 12.5, color: 'var(--warning)', opacity: 0.85, lineHeight: 1.55, marginTop: 3 }}>
            {leadId
              ? 'A hora já passou. Confirme se a pessoa apareceu.'
              : 'Confirme a presença para manter o histórico atualizado. O fechamento da venda é registrado separadamente no funil.'}
          </div>
        </div>
      </div>

      <div style={{
        display: 'flex', flexDirection: 'column', gap: 7,
        marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--warning-border)',
      }}>
        {pendentes.map((c) => {
          const ocupado = salvando === c.id
          const nome = c.lead?.nome?.trim() || 'Sem nome'

          return (
            <div key={c.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 10, flexWrap: 'wrap',
              background: 'var(--surface)', border: '1px solid var(--warning-border)', borderRadius: 9,
              padding: compacto ? '8px 10px' : '9px 12px',
            }}>

              <div style={{ minWidth: 0, flex: 1 }}>
                {/* No painel de uma pessoa só, repetir o nome dela seria ruído:
                    ele já está no cabeçalho, dois centímetros acima. */}
                {!leadId && (
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>
                    {c.lead
                      ? <Link to={`/leads/${c.lead.id}`} style={{ color: 'var(--text)', textDecoration: 'none' }}>{nome}</Link>
                      : nome}
                  </div>
                )}
                <div style={{
                  fontSize: 11.5, color: 'var(--muted)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {quandoPassou(c.data_reuniao)} · {c.assunto}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  onClick={() => confirmar(c, true)}
                  disabled={ocupado}
                  title="Confirmar presença na reunião"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '6px 11px', borderRadius: 8, border: '1px solid var(--success-border)',
                    background: 'var(--success-soft)', color: 'var(--success)',
                    cursor: ocupado ? 'wait' : 'pointer',
                    fontSize: 12, fontWeight: 700, fontFamily: FONTE,
                  }}>
                  <Check size={13} /> Compareceu
                </button>
                <button
                  onClick={() => confirmar(c, false)}
                  disabled={ocupado}
                  title="A pessoa não apareceu — registra falta"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '6px 11px', borderRadius: 8, border: '1px solid var(--border)',
                    background: 'var(--surface)', color: 'var(--muted)',
                    cursor: ocupado ? 'wait' : 'pointer',
                    fontSize: 12, fontWeight: 600, fontFamily: FONTE,
                  }}>
                  <X size={13} /> Faltou
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {erro && (
        <div style={{
          marginTop: 10, background: 'var(--danger-soft)', border: '1px solid var(--danger-border)',
          borderRadius: 8, padding: '8px 11px', fontSize: 12, color: 'var(--danger)',
        }}>{erro}</div>
      )}
    </div>
  )
}
