import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, Calendar, TrendingUp, TriangleAlert,
} from 'lucide-react'
import {
  LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { formatarParaExibicao } from '../lib/telefones'
import { PageHeader, LoadingState, EmptyState } from '../components/ui'
import FiltroPeriodo from '../components/FiltroPeriodo'
import { COR_SEM_PROFISSIONAL } from '../lib/cores'
import { useMediaQuery } from '../lib/useMediaQuery'
import {
  getPeriodRange,
  type DateRange, type PeriodKey,
} from '../lib/periodo'

/* ──────────────────────────────────────────────
   O DASHBOARD NÃO CARREGA PESSOAS — ELE FAZ PERGUNTAS.

   Antes, esta tela pedia `select * from contatos` e contava tudo aqui. O
   PostgREST corta em `max_rows` (1000 neste projeto) **sem avisar**: a partir
   do lead 1001 as contas não ficariam incompletas, ficariam ERRADAS — e erro
   de contagem não grita, fica na tela parecendo certo.

   Agora são cinco chamadas de função SQL (migração `0024`), cada uma
   devolvendo números já contados. Dezenas de linhas, independente de a empresa
   ter cem ou cem mil leads.

   ⚠️ O AGRUPAMENTO POR DIA MORA NO BANCO, E É DE PROPÓSITO. Ele precisa saber
   onde o dia começa, e a sessão do PostgREST roda em UTC: um contato das 23h
   de São Paulo cairia no dia seguinte, sempre. As funções usam o
   `configuracoes_negocio.fuso_horario` — o mesmo campo da `agenda_marcar`.
────────────────────────────────────────────── */

/* ──────────────────────────────────────────────
   O que cada função devolve
────────────────────────────────────────────── */
interface Numeros { novos_contatos: number; reunioes_agendadas: number; vendas_ganhas: number; conversao: number; valor_fechado: number; em_negociacao: number }
interface PontoDia { dia: string; atendimentos: number; agendamentos: number }
interface BarraSemana { dia_semana: number; contatos: number }
interface BarraProfissional {
  profissional_id: string | null
  nome: string
  /**
   * `null` na linha "Sem profissional" — e é de propósito.
   *
   * O SQL devolve a cor **do profissional**, que é dado. A cor do "sem profissional" é
   * decisão de tela, e quem é dono dela é `COR_SEM_PROFISSIONAL`, em
   * [`cores.ts`](../lib/cores.ts) — o mesmo que as três telas da Agenda usam.
   * Um hex escrito no SQL seria uma segunda paleta, num lugar onde ninguém
   * procuraria ao trocar a identidade visual.
   */
  cor: string | null
  reunioes: number
}
interface LinhaProcedimento { servico: string; procurado: number; realizado: number }

interface ProximaConsulta {
  id: string
  data_reuniao: string
  assunto: string
  duracao_minutos: number
  lead: { id: string; nome: string | null; whatsapp: string | null } | null
  profissional: { nome: string; sobrenome: string; cor: string } | null
}

/* ──────────────────────────────────────────────
   Helpers
────────────────────────────────────────────── */

/**
 * `2026-09-02` → `02/09`.
 *
 * ⚠️ **Sem passar por `new Date()`, de propósito.** `new Date('2026-09-02')` é
 * interpretado como meia-noite em UTC; em qualquer fuso negativo — o Brasil
 * inteiro — isso vira **1º de setembro** na hora de formatar, e o gráfico sai
 * um dia atrasado. A data já vem pronta do banco, no fuso da empresa; cortar a
 * string é a única leitura que não a move.
 */
function rotuloDia(iso: string): string {
  const [, mes, dia] = iso.split('-')
  return `${dia}/${mes}`
}

function fmtDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/** Quantos procedimentos o ranking mostra. O resto é rodapé, nunca silêncio. */
const TETO_PROCEDIMENTOS = 10

const CARTAO: React.CSSProperties = {
  background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)',
  padding: '24px', minWidth: 0, boxShadow: 'var(--shadow)', transition: 'box-shadow 0.2s',
}

/* ──────────────────────────────────────────────
   Animated Counter
────────────────────────────────────────────── */
function AnimatedCounter({ value, suffix = '' }: { value: number; suffix?: string }) {
  return <>{value.toLocaleString('pt-BR')}{suffix}</>
}

/* ──────────────────────────────────────────────
   Custom Tooltip for Line Chart
────────────────────────────────────────────── */
/**
 * O que a recharts entrega ao tooltip — só o que esta tela usa.
 *
 * Era `any`, e estava na lista de débito técnico do CLAUDE.md. O tipo da
 * biblioteca é genérico demais para ser útil aqui; um formato mínimo e honesto
 * pega o que importa: campo renomeado, série removida, `value` que virou
 * string.
 */
interface DadosTooltip {
  active?: boolean
  label?: string | number
  payload?: { name?: string; value?: number | string; color?: string }[]
}

function LineTooltip({ active, payload, label }: DadosTooltip) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', boxShadow: '0 4px 16px rgba(0,0,0,0.08)', fontSize: 13 }}>
      <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 6, color: p.color, marginBottom: 2 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.color }} />
          <span style={{ color: 'var(--muted)' }}>{p.name}:</span>
          <span style={{ fontWeight: 600, color: 'var(--text)' }}>{p.value}</span>
        </div>
      ))}
    </div>
  )
}

/* ──────────────────────────────────────────────
   Cabeçalho de cartão de gráfico
────────────────────────────────────────────── */
function TituloGrafico({ titulo, explicacao }: { titulo: string; explicacao: string }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{titulo}</h3>
      <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>{explicacao}</p>
    </div>
  )
}

function Vazio({ texto }: { texto: string }) {
  return <EmptyState title={texto} />
}

/* ──────────────────────────────────────────────
   KPI Card
────────────────────────────────────────────── */
function KpiCard({
  icon: Icon, label, value, description, suffix = '', delay,
}: {
  icon: React.ElementType; label: string; value: number
  description: string; suffix?: string; delay: string
}) {
  return (
    <div
      className={`fade-in-${delay}`}
      style={{ ...CARTAO, padding: '22px 24px', flex: 1, minWidth: 0, cursor: 'default' }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 20px rgba(0,0,0,0.08)')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.boxShadow = 'none')}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 500, marginBottom: 8 }}>{label}</div>
          <div className="metric-value" style={{ fontSize: 32, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>
            <AnimatedCounter value={value} suffix={suffix} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>{description}</div>
        </div>
        <div className="metric-icon" style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon size={20} color="var(--accent)" strokeWidth={1.8} />
        </div>
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────
   Main Component
────────────────────────────────────────────── */
export default function Dashboard() {
  const navigate = useNavigate()
  const reduzirMovimento = useMediaQuery('(prefers-reduced-motion: reduce)')

  const [periodo, setPeriodo] = useState<PeriodKey>('this_month')
  const [faixa, setFaixa] = useState<DateRange>(() => ({ start: new Date(), end: new Date() }))
  const [loading, setLoading] = useState(true)

  const [numeros, setNumeros] = useState<Numeros>({ novos_contatos: 0, reunioes_agendadas: 0, vendas_ganhas: 0, conversao: 0, valor_fechado: 0, em_negociacao: 0 })
  const [porDia, setPorDia] = useState<PontoDia[]>([])
  const [porSemana, setPorSemana] = useState<BarraSemana[]>([])
  const [profissionais, setProfissionais] = useState<BarraProfissional[]>([])
  const [procedimentos, setProcedimentos] = useState<LinhaProcedimento[]>([])
  const [proximas, setProximas] = useState<ProximaConsulta[]>([])
  /* Calculado no efeito, junto com os dados que ele descreve.

     Comparar aqui embaixo o primeiro dia devolvido com `range.start` tinha dois
     defeitos: o `range` é recalculado a cada renderização, então entre trocar o
     filtro e a resposta chegar a comparação misturava o período novo com os
     dados velhos; e as duas datas vinham de fusos diferentes — a do banco no
     fuso da empresa, a da tela no do navegador. */
  const [serieCortada, setSerieCortada] = useState(false)
  /* PAINEL QUE NÃO SABE TEM QUE DIZER QUE NÃO SABE.

     `supabase.rpc()` não lança em erro do banco: devolve `{ data: null, error }`.
     Com `?? 0` no caminho de leitura, uma função que falhasse pintaria **zero**
     em todos os cartões — e zero é um número, indistinguível de uma empresa
     parada. Seria trocar o corte silencioso de 1000 linhas por um silêncio
     pior. */
  const [falhou, setFalhou] = useState(false)

  /* Os cinco números do período — todos vêm contados do banco. */
  useEffect(() => {
    let vivo = true
    const range = getPeriodRange(periodo, faixa)
    const p = { p_inicio: range.start.toISOString(), p_fim: range.end.toISOString() }

    void Promise.all([
      supabase.rpc('resumo_periodo', p),
      supabase.rpc('dashboard_por_dia', p),
      supabase.rpc('dashboard_dia_semana', p),
      supabase.rpc('dashboard_profissionais', p),
      supabase.rpc('dashboard_servicos', p),
    ]).then(([n, dia, semana, profs, procs]) => {
      if (!vivo) return

      const erro = [n, dia, semana, profs, procs].find((r) => r.error)
      if (erro) {
        console.error('dashboard:', erro.error)
        setFalhou(true)
        setLoading(false)
        return
      }
      setFalhou(false)
      // `count()` volta como bigint; o Number() aqui é cinto de segurança para
      // o dia em que uma delas passar a somar (numeric vem como string).
      setNumeros({
        novos_contatos: Number(n.data?.[0]?.novos_contatos ?? 0),
        reunioes_agendadas: Number(n.data?.[0]?.reunioes_agendadas ?? 0),
        vendas_ganhas: Number(n.data?.[0]?.vendas_ganhas ?? 0),
        conversao: Number(n.data?.[0]?.conversao ?? 0),
        valor_fechado: Number(n.data?.[0]?.valor_fechado ?? 0),
        em_negociacao: Number(n.data?.[0]?.em_negociacao ?? 0),
      })
      const dias = (dia.data ?? []) as PontoDia[]
      setPorDia(dias.map((r) => ({
        dia: r.dia,
        atendimentos: Number(r.atendimentos),
        agendamentos: Number(r.agendamentos),
      })))
      /* Quantos dias cabiam no período pedido, contra quantos vieram. Menos
         quer dizer que o teto de 370 da `dashboard_por_dia` entrou em ação.
         As duas pontas do cálculo saem do MESMO `range` desta consulta. */
      const diasPedidos = Math.round(
        (range.end.getTime() - range.start.getTime()) / 86_400_000,
      )
      setSerieCortada(dias.length > 0 && diasPedidos > dias.length)
      setPorSemana((semana.data ?? []).map((r: BarraSemana) => ({
        dia_semana: Number(r.dia_semana),
        contatos: Number(r.contatos),
      })))
      setProfissionais((profs.data ?? []).map((r: BarraProfissional) => ({
        ...r, reunioes: Number(r.reunioes),
      })))
      setProcedimentos((procs.data ?? []).map((r: LinhaProcedimento) => ({
        servico: r.servico,
        procurado: Number(r.procurado),
        realizado: Number(r.realizado),
      })))
      setLoading(false)
    }).catch((e) => {
      // Rede caindo no meio: o `.then` acima nunca roda, e sem este ramo a
      // tela ficaria girando o carregador para sempre.
      if (!vivo) return
      console.error('dashboard:', e)
      setFalhou(true)
      setLoading(false)
    })

    return () => { vivo = false }
  }, [periodo, faixa])

  /* PRÓXIMAS CONSULTAS — DA TABELA `consultas`, E NÃO DA FICHA DO LEAD.

     Ela lia `contatos.data_agendamento`, que é reflexo mantido por trigger:
     traz UMA data por pessoa, não a consulta. Sem ordem e sem limite, dentro de
     um `select *` cortado em 1000, um cliente com consulta amanhã podia
     simplesmente não aparecer.

     Aqui é a fonte, ordenada e limitada — e não depende do filtro de período,
     porque "próximas" é sempre sobre o futuro. */
  useEffect(() => {
    let vivo = true
    void supabase
      .from('reunioes')
      .select('id, data_reuniao, assunto, duracao_minutos, lead:contatos_dados(id, nome, whatsapp), profissional:profissionais(nome, sobrenome, cor)')
      .eq('status', 'agendada')
      .gt('data_reuniao', new Date().toISOString())
      .order('data_reuniao', { ascending: true })
      .limit(10)
      .then(({ data }) => {
        if (vivo) setProximas((data ?? []) as unknown as ProximaConsulta[])
      })
    return () => { vivo = false }
  }, [])

  const taxaConversao = numeros.conversao

  const dadosLinha = porDia.map((p) => ({
    date: rotuloDia(p.dia),
    Atendimentos: p.atendimentos,
    Agendamentos: p.agendamentos,
  }))

  const maxSemana = Math.max(0, ...porSemana.map((s) => s.contatos))
  const dadosSemana = porSemana.map((s) => ({
    name: DAY_NAMES[s.dia_semana] ?? '?',
    Contatos: s.contatos,
    isMax: s.contatos === maxSemana && maxSemana > 0,
  }))

  const dadosProcedimentos = procedimentos
    .slice(0, TETO_PROCEDIMENTOS)
    .map((p) => ({
      servico: p.servico,
      Procurado: p.procurado,
      Vendido: p.realizado,
    }))

  if (loading) return <LoadingState label="Carregando o resumo da empresa…" />

  return (
    <div className="page-content">
      <PageHeader title="Dashboard" eyebrow="Visão geral" description="Acompanhe os resultados da empresa e as próximas reuniões." actions={
        <FiltroPeriodo periodo={periodo} onPeriodo={setPeriodo} faixa={faixa} onFaixa={setFaixa} />
      } />

      {falhou && (
        <div className="fade-in-3" style={{
          display: 'flex', alignItems: 'flex-start', gap: 9, marginBottom: 24,
          background: 'var(--danger-soft)', border: '1px solid var(--danger-border)', borderRadius: 12,
          padding: '13px 16px', fontSize: 13, color: 'var(--danger)', lineHeight: 1.55,
        }}>
          <TriangleAlert size={15} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            <strong>Não consegui carregar os números.</strong> O que está na tela
            abaixo não é da sua empresa — pode ser uma queda de rede. Escolha o
            período de novo ou recarregue a página.
          </span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="dashboard-metrics">
        <KpiCard icon={Users} label="Novos Contatos" value={numeros.novos_contatos} description="Pessoas que entraram em contato no período" delay="3" />
        <KpiCard icon={Calendar} label="Reuniões Agendadas" value={numeros.reunioes_agendadas} description="Total de reuniões marcadas no período" delay="4" />
        <KpiCard icon={TrendingUp} label="Vendas ganhas" value={numeros.vendas_ganhas} description="Vendas fechadas no período" delay="4" />
        <KpiCard icon={TrendingUp} label="Conversão comercial" value={taxaConversao} suffix="%" description="Das oportunidades criadas no período, quantas estão em Ganho" delay="5" />
      </div>
      <div className="arc-card dashboard-money">
        <div><div>Valor fechado no período</div><strong>{numeros.valor_fechado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong><div style={{ fontSize: 12, color: 'var(--muted)' }}>Soma das propostas ganhas com valor informado; não representa recebimentos.</div></div>
        <div><div>Propostas e negociações abertas</div><strong>{numeros.em_negociacao}</strong><div style={{ fontSize: 12, color: 'var(--muted)' }}>Carteira atual, independente do período.</div></div>
      </div>

      {/* Gráfico 1: linha */}
      <div className="fade-in-4" style={{ ...CARTAO, marginBottom: 24 }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 20px rgba(0,0,0,0.06)')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.boxShadow = 'none')}
      >
        <TituloGrafico
          titulo="Atendimentos vs Agendamentos"
          explicacao="Quantas pessoas chegaram e quantas marcaram reunião, por dia do período"
        />

        {serieCortada && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 8, margin: '10px 0 2px',
            background: 'var(--warning-soft)', border: '1px solid var(--warning-border)', borderRadius: 9,
            padding: '9px 12px', fontSize: 12, color: 'var(--warning)', lineHeight: 1.5,
          }}>
            <TriangleAlert size={13} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              Período longo demais para um ponto por dia — mostrando os últimos{' '}
              <strong>{porDia.length}</strong> dias. Os números acima continuam sendo
              do período inteiro.
            </span>
          </div>
        )}

        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={dadosLinha} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} minTickGap={16} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip content={<LineTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} iconType="circle" iconSize={8} />
            <Line isAnimationActive={!reduzirMovimento} type="monotone" dataKey="Atendimentos" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 3, fill: 'var(--accent)' }} activeDot={{ r: 5 }} />
            <Line isAnimationActive={!reduzirMovimento} type="monotone" dataKey="Agendamentos" stroke="var(--chart-blue)" strokeWidth={2.5} strokeDasharray="6 3" dot={{ r: 3, fill: 'var(--chart-blue)' }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Gráficos 2 e 3, lado a lado */}
      <div className="dashboard-grid">

        {/* Dias da semana */}
        <div className="fade-in-5" style={CARTAO}
          onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 20px rgba(0,0,0,0.06)')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.boxShadow = 'none')}
        >
          <TituloGrafico
            titulo="Dias com Mais Movimento"
            explicacao="Em quais dias da semana a empresa recebeu contatos, no período"
          />
          {maxSemana === 0 ? (
            <Vazio texto="Nenhum contato no período." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={dadosSemana} barSize={28} margin={{ top: 12, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: 'var(--surface-raised)', color: 'var(--text)', borderRadius: 10, border: '1px solid var(--border)', fontSize: 13, fontFamily: "var(--font-body)" }}
                  cursor={{ fill: 'var(--page)' }}
                />
                <Bar isAnimationActive={!reduzirMovimento} dataKey="Contatos" radius={[6, 6, 0, 0]}>
                  {dadosSemana.map((entry, i) => (
                    <Cell key={i} fill={entry.isMax ? 'var(--chart-teal)' : 'var(--chart-soft)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Consultas por profissional — NO LUGAR DA ROSCA DE HORÁRIO COMERCIAL.

            Barras deitadas, e não em pé: nome de profissional com sobrenome não cabe
            embaixo de uma barra de meia largura de tela sem virar de lado ou ser
            cortado.

            Cada barra usa a COR DO PRÓPRIO PROFISSIONAL — a mesma da Agenda.
            Assim o gráfico e o calendário falam a mesma língua, e a cor deixa de
            ser enfeite: ela identifica. */}
        <div className="fade-in-6" style={CARTAO}
          onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 20px rgba(0,0,0,0.06)')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.boxShadow = 'none')}
        >
          <TituloGrafico
            titulo="Reuniões por Profissional"
            explicacao="Reuniões marcadas ou realizadas no período, pela data da reunião"
          />
          {profissionais.length === 0 ? (
            <Vazio texto="Nenhum profissional ativo cadastrado." />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(180, profissionais.length * 46)}>
              <BarChart
                data={profissionais}
                layout="vertical"
                barSize={22}
                margin={{ top: 12, right: 20, bottom: 0, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis
                  type="category" dataKey="nome" width={124}
                  tick={{ fontSize: 11.5, fill: 'var(--text)' }} axisLine={false} tickLine={false}
                />
                <Tooltip
                  contentStyle={{ background: 'var(--surface-raised)', color: 'var(--text)', borderRadius: 10, border: '1px solid var(--border)', fontSize: 13, fontFamily: "var(--font-body)" }}
                  cursor={{ fill: 'var(--page)' }}
                />
                <Bar isAnimationActive={!reduzirMovimento} dataKey="reunioes" name="Reuniões" radius={[0, 6, 6, 0]}>
                  {profissionais.map((p) => (
                    <Cell key={p.profissional_id ?? 'sem'} fill={p.cor ?? COR_SEM_PROFISSIONAL.hex} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* PROCEDIMENTOS: PROCURADO x REALIZADO.

          Duas barras, e a distância entre elas é a informação. "120 procuraram
          lentes, 14 fizeram" é uma conversa sobre preço, agenda ou argumento de
          venda que nenhum dos dois números sozinho começa.

          ⚠️ As duas barras respondem a recortes DIFERENTES do mesmo período, e
          têm que responder: "procurado" conta por quando a PESSOA chegou (o
          mesmo campo do KPI "Novos Contatos"); "realizado", por quando a
          CONSULTA aconteceu. Quem chegou em agosto pode ter feito em setembro. */}
      <div className="fade-in-6" style={{ ...CARTAO, marginBottom: 24 }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 20px rgba(0,0,0,0.06)')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.boxShadow = 'none')}
      >
        <TituloGrafico
          titulo="Serviços: interesse e vendas"
          explicacao="Interesses dos leads que chegaram no período e serviços das vendas ganhas pela data de fechamento"
        />
        {dadosProcedimentos.length === 0 ? (
          <Vazio texto="Nenhum serviço procurado ou vendido no período." />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={Math.max(200, dadosProcedimentos.length * 46)}>
              <BarChart
                data={dadosProcedimentos}
                layout="vertical"
                barSize={13}
                barGap={3}
                margin={{ top: 12, right: 24, bottom: 0, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis
                  type="category" dataKey="servico" width={140}
                  tick={{ fontSize: 11.5, fill: 'var(--text)' }} axisLine={false} tickLine={false}
                />
                <Tooltip
                  contentStyle={{ background: 'var(--surface-raised)', color: 'var(--text)', borderRadius: 10, border: '1px solid var(--border)', fontSize: 13, fontFamily: "var(--font-body)" }}
                  cursor={{ fill: 'var(--page)' }}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} iconType="circle" iconSize={8} />
                <Bar isAnimationActive={!reduzirMovimento} dataKey="Procurado" fill="var(--chart-blue)" radius={[0, 5, 5, 0]} />
                <Bar isAnimationActive={!reduzirMovimento} dataKey="Vendido" fill="var(--success)" radius={[0, 5, 5, 0]} />
              </BarChart>
            </ResponsiveContainer>

            {/* Teto dito em voz alta: lista cortada sem aviso lê-se como
                "é isso que existe". */}
            {procedimentos.length > TETO_PROCEDIMENTOS && (
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
                Mostrando os {TETO_PROCEDIMENTOS} mais procurados, de{' '}
                {procedimentos.length} com movimento no período.
              </div>
            )}
          </>
        )}
      </div>

      {/* Próximas Consultas */}
      <div className="fade-in-6" style={{ ...CARTAO, marginBottom: 32 }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 20px rgba(0,0,0,0.06)')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.boxShadow = 'none')}
      >
        <div style={{ marginBottom: 16 }}>
          <TituloGrafico
            titulo="Próximas Reuniões"
            explicacao="As 10 primeiras que ainda vão acontecer — independente do filtro de período acima"
          />
        </div>

        {proximas.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--muted)', fontSize: 13.5 }}>
            Nenhuma reunião futura agendada.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Cliente', 'Serviço', 'Profissional', 'Data da Reunião'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 12, fontWeight: 600, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {proximas.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => c.lead && navigate(`/leads/${c.lead.id}`)}
                    style={{ borderBottom: '1px solid var(--border-subtle)', transition: 'background 0.15s', cursor: c.lead ? 'pointer' : 'default' }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = 'var(--surface-subtle)')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = 'transparent')}
                  >
                    <td style={{ padding: '12px 12px' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text)' }}>{c.lead?.nome ?? '—'}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{formatarParaExibicao(c.lead?.whatsapp ?? null)}</div>
                    </td>
                    <td style={{ padding: '12px 12px', color: 'var(--muted)' }}>
                      {c.assunto}
                      <span style={{ color: 'var(--muted)' }}> · {c.duracao_minutos} min</span>
                    </td>
                    <td style={{ padding: '12px 12px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {c.profissional ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.profissional.cor, display: 'inline-block', flexShrink: 0 }} />
                          {`${c.profissional.nome} ${c.profissional.sobrenome}`.trim()}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ padding: '12px 12px', color: 'var(--text)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {fmtDataHora(c.data_reuniao)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
