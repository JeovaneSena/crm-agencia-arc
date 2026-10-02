import { useEffect, useRef } from 'react'
import {
  distribuirEmColunas, fimDaConsulta, horaParaMinutos, inicioDaConsulta, mesmoDia,
  minutosDoDia, minutosParaHora, NOMES_DIAS_CURTOS, procedimentoComInteresse,
} from '../lib/agenda'
import { COR_SEM_PROFISSIONAL } from '../lib/cores'
import type { ReuniaoAgenda, Profissional, ProfissionalHorario } from '../types'

/* ──────────────────────────────────────────────
   Visão semanal — sete colunas de dia, horas na vertical.

   Desenhada à mão, sem biblioteca de calendário: as prontas trazem CSS e tema
   próprios, que brigariam com a estilização inline do projeto, e somariam peso
   a um bundle que já está grande.
────────────────────────────────────────────── */

/** Altura de uma hora, em pixels. Define a escala inteira da grade. */
const ALTURA_HORA = 58
const LARGURA_REGUA = 58

interface Props {
  dias: Date[]
  consultas: ReuniaoAgenda[]
  profissionaisPorId: Map<string, Profissional>
  limites: { horaInicio: number; horaFim: number }
  /** Jornada das agendas visíveis — o que fica fora dela é sombreado. */
  jornadaVisivel?: ProfissionalHorario[]
  onClickConsulta: (c: ReuniaoAgenda) => void
  onClickHorarioVazio: (quando: Date) => void
}

export default function AgendaSemana({
  dias, consultas, profissionaisPorId, limites, jornadaVisivel, onClickConsulta, onClickHorarioVazio,
}: Props) {
  const corpoRef = useRef<HTMLDivElement>(null)
  const hoje = new Date()

  const minutoInicial = limites.horaInicio * 60
  const totalMinutos = (limites.horaFim - limites.horaInicio) * 60
  const pxPorMinuto = ALTURA_HORA / 60
  const alturaGrade = totalMinutos * pxPorMinuto

  const horas = Array.from({ length: limites.horaFim - limites.horaInicio }, (_, i) => limites.horaInicio + i)

  /* Abre a semana já com o começo do expediente à vista, e não à meia-noite. */
  useEffect(() => {
    if (!corpoRef.current) return
    corpoRef.current.scrollTop = Math.max(0, (8 * 60 - minutoInicial) * pxPorMinuto - 20)
  }, [minutoInicial, pxPorMinuto])

  const handleClickColuna = (e: React.MouseEvent<HTMLDivElement>, dia: Date) => {
    // Clique num bloco já é tratado pelo próprio bloco.
    if (e.target !== e.currentTarget) return
    const rect = e.currentTarget.getBoundingClientRect()
    const minutos = minutoInicial + (e.clientY - rect.top) / pxPorMinuto
    const arredondado = Math.floor(minutos / 15) * 15
    const quando = new Date(dia)
    quando.setHours(Math.floor(arredondado / 60), arredondado % 60, 0, 0)
    onClickHorarioVazio(quando)
  }

  /* FAIXAS SOMBREADAS FORA DA JORNADA — DE QUALQUER NÚMERO DE AGENDAS.

     Isto só era desenhado quando havia UMA agenda filtrada. Com as duas à
     vista, que é como a tela abre, domingo era desenhado igual a uma
     quarta-feira: nada na grade dizia que a empresa está fechada, e o clique
     numa coluna vazia abria o modal como em qualquer outro dia. Foi por aí
     que entrou uma consulta num domingo.

     Com várias agendas, a faixa é a UNIÃO delas — abre com a primeira e fecha
     com a última. O que está fora da jornada de todo mundo está fora da
     empresa; sombrear a interseção esconderia horário em que alguém atende. */
  const sombrasDoDia = (dia: Date) => {
    if (!jornadaVisivel) return null
    const doDia = jornadaVisivel.filter((h) => h.dia_semana === dia.getDay() && h.ativo)
    const estilo: React.CSSProperties = { position: 'absolute', left: 0, right: 0, background: 'var(--surface-subtle)', pointerEvents: 'none' }
    if (doDia.length === 0) return <div style={{ ...estilo, top: 0, height: alturaGrade }} />
    const ini = Math.min(...doDia.map((h) => horaParaMinutos(h.hora_inicio)))
    const fim = Math.max(...doDia.map((h) => horaParaMinutos(h.hora_fim)))
    return (
      <>
        {ini > minutoInicial && <div style={{ ...estilo, top: 0, height: (ini - minutoInicial) * pxPorMinuto }} />}
        {fim < minutoInicial + totalMinutos && (
          <div style={{ ...estilo, top: (fim - minutoInicial) * pxPorMinuto, height: (minutoInicial + totalMinutos - fim) * pxPorMinuto }} />
        )}
      </>
    )
  }

  return (
    <div className="calendar-week" style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>

      {/* Cabeçalho dos dias */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', paddingRight: 8 }}>
        <div style={{ width: LARGURA_REGUA, flexShrink: 0 }} />
        {dias.map((dia) => {
          const ehHoje = mesmoDia(dia, hoje)
          return (
            <div key={dia.toISOString()} style={{ flex: 1, textAlign: 'center', padding: '10px 4px', borderLeft: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: ehHoje ? 'var(--accent)' : 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                {NOMES_DIAS_CURTOS[dia.getDay()]}
              </div>
              <div style={{
                fontSize: 17, fontWeight: 700, marginTop: 3,
                color: ehHoje ? 'var(--on-action)' : 'var(--text)',
                background: ehHoje ? 'var(--action)' : 'transparent',
                width: 30, height: 30, lineHeight: '30px', borderRadius: '50%', margin: '3px auto 0',
              }}>
                {dia.getDate()}
              </div>
            </div>
          )
        })}
      </div>

      {/* Grade */}
      <div ref={corpoRef} style={{ display: 'flex', maxHeight: '62vh', overflowY: 'auto' }}>

        {/* Régua de horas */}
        <div style={{ width: LARGURA_REGUA, flexShrink: 0, position: 'relative', height: alturaGrade }}>
          {horas.map((h, i) => (
            <div key={h} style={{ position: 'absolute', top: i * ALTURA_HORA - 6, right: 9, fontSize: 11, color: 'var(--muted)', fontWeight: 500 }}>
              {i === 0 ? '' : minutosParaHora(h * 60)}
            </div>
          ))}
        </div>

        {/* Colunas dos dias */}
        {dias.map((dia) => {
          const doDia = consultas.filter((c) => mesmoDia(inicioDaConsulta(c), dia))
          const posicionadas = distribuirEmColunas(
            doDia,
            (c) => minutosDoDia(inicioDaConsulta(c)),
            (c) => minutosDoDia(inicioDaConsulta(c)) + c.duracao_minutos,
          )
          const ehHoje = mesmoDia(dia, hoje)

          return (
            <div key={dia.toISOString()}
              onClick={(e) => handleClickColuna(e, dia)}
              style={{
                flex: 1, position: 'relative', height: alturaGrade, borderLeft: '1px solid var(--border-subtle)', cursor: 'copy',
                background: `repeating-linear-gradient(to bottom, var(--border-subtle) 0, var(--border-subtle) 1px, transparent 1px, transparent ${ALTURA_HORA}px)`,
              }}>

              {sombrasDoDia(dia)}

              {/* Linha do agora */}
              {ehHoje && minutosDoDia(hoje) >= minutoInicial && minutosDoDia(hoje) <= minutoInicial + totalMinutos && (
                <div style={{ position: 'absolute', left: 0, right: 0, top: (minutosDoDia(hoje) - minutoInicial) * pxPorMinuto, height: 2, background: 'var(--danger-solid)', zIndex: 3, pointerEvents: 'none' }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--danger-solid)', position: 'absolute', left: -3, top: -2.5 }} />
                </div>
              )}

              {posicionadas.map(({ item: c, coluna, colunas }) => {
                const inicio = inicioDaConsulta(c)
                const prof = c.profissional_id ? profissionaisPorId.get(c.profissional_id) : undefined
                const cor = prof?.cor ?? COR_SEM_PROFISSIONAL.hex
                const topo = (minutosDoDia(inicio) - minutoInicial) * pxPorMinuto
                const altura = Math.max(20, c.duracao_minutos * pxPorMinuto - 2)
                // Falta e cancelamento se desenham igual: as duas dizem "não aconteceu".
                // A diferença entre elas é dado, e vive no status da consulta — não no
                // bloco do calendário, onde viraria mais uma cor para decorar.
                const naoAconteceu = c.status === 'cancelada' || c.status === 'faltou'

                return (
                  <button key={c.id}
                    onClick={(e) => { e.stopPropagation(); onClickConsulta(c) }}
                    title={`${inicio.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} – ${fimDaConsulta(c).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · ${c.lead?.nome ?? 'Sem nome'} · ${procedimentoComInteresse(c)}`}
                    style={{
                      position: 'absolute',
                      top: topo,
                      height: altura,
                      left: `calc(${(coluna / colunas) * 100}% + 2px)`,
                      width: `calc(${100 / colunas}% - 4px)`,
                      background: naoAconteceu ? 'var(--surface)' : cor,
                      border: `1px solid ${cor}`,
                      borderLeft: `3px solid ${cor}`,
                      borderRadius: 6,
                      padding: '3px 6px',
                      textAlign: 'left',
                      overflow: 'hidden',
                      cursor: 'pointer',
                      opacity: naoAconteceu ? 0.6 : 1,
                      color: naoAconteceu ? 'var(--muted)' : 'var(--on-solid)',
                      fontFamily: "var(--font-body)",
                      zIndex: 2,
                    }}>
                    <div style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: naoAconteceu ? 'line-through' : 'none' }}>
                      {inicio.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} {c.lead?.nome ?? 'Sem nome'}
                    </div>
                    {altura > 32 && (
                      <div style={{ fontSize: 10.5, lineHeight: 1.3, opacity: 0.9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {procedimentoComInteresse(c)}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
