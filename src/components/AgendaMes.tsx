import {
  gradeDoMes, inicioDaConsulta, mesmoDia, NOMES_DIAS_CURTOS, procedimentoComInteresse,
} from '../lib/agenda'
import { COR_SEM_PROFISSIONAL } from '../lib/cores'
import type { ReuniaoAgenda, Profissional } from '../types'

/* ──────────────────────────────────────────────
   Visão mensal — grade de semanas inteiras.

   Aqui não cabe horário desenhado em escala: cada dia vira uma pilha de
   pílulas coloridas pela agenda de origem. Serve para enxergar carga e vazios
   do mês; o detalhe fica na visão semanal.
────────────────────────────────────────────── */

/** Quantas consultas cabem num dia antes do "+N". */
const MAXIMO_POR_DIA = 3

interface Props {
  referencia: Date
  consultas: ReuniaoAgenda[]
  profissionaisPorId: Map<string, Profissional>
  onClickConsulta: (c: ReuniaoAgenda) => void
  onClickDia: (dia: Date) => void
}

export default function AgendaMes({ referencia, consultas, profissionaisPorId, onClickConsulta, onClickDia }: Props) {
  const dias = gradeDoMes(referencia)
  const hoje = new Date()
  const semanas = Math.ceil(dias.length / 7)

  return (
    <div className="calendar-month" style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>

      {/* Cabeçalho */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border)' }}>
        {NOMES_DIAS_CURTOS.map((nome) => (
          <div key={nome} style={{ padding: '10px 8px', textAlign: 'center', fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.3 }}>
            {nome}
          </div>
        ))}
      </div>

      {/* Grade */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridTemplateRows: `repeat(${semanas}, minmax(104px, auto))` }}>
        {dias.map((dia, idx) => {
          const doMes = dia.getMonth() === referencia.getMonth()
          const ehHoje = mesmoDia(dia, hoje)
          const doDia = consultas
            .filter((c) => mesmoDia(inicioDaConsulta(c), dia))
            .sort((a, b) => inicioDaConsulta(a).getTime() - inicioDaConsulta(b).getTime())
          const visiveis = doDia.slice(0, MAXIMO_POR_DIA)
          const restantes = doDia.length - visiveis.length

          return (
            <div key={dia.toISOString()}
              onClick={(e) => { if (e.target === e.currentTarget) onClickDia(dia) }}
              style={{
                borderRight: (idx + 1) % 7 === 0 ? 'none' : '1px solid var(--border-subtle)',
                borderBottom: idx < dias.length - 7 ? '1px solid var(--border-subtle)' : 'none',
                padding: '7px 8px 8px',
                background: doMes ? 'var(--surface)' : 'var(--surface-subtle)',
                cursor: 'pointer',
                minWidth: 0,
              }}>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 5, pointerEvents: 'none' }}>
                <span style={{
                  fontSize: 12.5, fontWeight: ehHoje ? 700 : 600,
                  color: ehHoje ? 'var(--on-action)' : doMes ? 'var(--text)' : 'var(--muted)',
                  background: ehHoje ? 'var(--action)' : 'transparent',
                  minWidth: 22, height: 22, lineHeight: '22px', textAlign: 'center', borderRadius: '50%',
                }}>
                  {dia.getDate()}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {visiveis.map((c) => {
                  const prof = c.profissional_id ? profissionaisPorId.get(c.profissional_id) : undefined
                  const cor = prof?.cor ?? COR_SEM_PROFISSIONAL.hex
                  // Falta e cancelamento se desenham igual: as duas dizem "não aconteceu".
                  // A diferença entre elas é dado, e vive no status da consulta — não no
                  // bloco do calendário, onde viraria mais uma cor para decorar.
                  const naoAconteceu = c.status === 'cancelada' || c.status === 'faltou'
                  return (
                    <button key={c.id}
                      onClick={(e) => { e.stopPropagation(); onClickConsulta(c) }}
                      title={`${c.lead?.nome ?? 'Sem nome'} · ${procedimentoComInteresse(c)}`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 5, width: '100%',
                        background: naoAconteceu ? 'transparent' : 'var(--surface-subtle)',
                        border: '1px solid var(--border)', borderLeft: `3px solid ${cor}`, borderRadius: 5, padding: '3px 6px', cursor: 'pointer',
                        fontFamily: "var(--font-body)", textAlign: 'left',
                        opacity: naoAconteceu ? 0.55 : 1, minWidth: 0,
                      }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: cor, flexShrink: 0 }} />
                      <span style={{
                        fontSize: 11, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        textDecoration: naoAconteceu ? 'line-through' : 'none',
                      }}>
                        {inicioDaConsulta(c).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}{' '}
                        {c.lead?.nome ?? 'Sem nome'}
                      </span>
                    </button>
                  )
                })}

                {restantes > 0 && (
                  <button onClick={(e) => { e.stopPropagation(); onClickDia(dia) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10.5, fontWeight: 600, color: 'var(--muted)', textAlign: 'left', padding: '1px 6px', fontFamily: "var(--font-body)" }}>
                    +{restantes} mais
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
