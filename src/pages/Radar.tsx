import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ListPlus } from 'lucide-react'
import { Card, EmptyState, LoadingState, Notice, PageHeader } from '../components/ui'
import { FormNovaTarefa } from '../components/Tarefas'
import { useFunil } from '../lib/funil'
import { useRadar } from '../lib/radar'
import { agruparRadar, EXPLICA_FAIXA, FAIXAS, filtrarRadar, ROTULO_FAIXA, ROTULO_PROTECAO, rotuloParado, valorPorFaixa, type FiltroDoRadar, type NegocioDoRadar } from '../lib/radarRegras'
import { useSessao } from '../lib/sessao'
import { useNomesDaEquipe } from '../lib/useEquipeAtiva'

const ROTULO_FILTRO: Record<FiltroDoRadar, string> = { meus: 'Meus', todos: 'Todos', sem_responsavel: 'Sem responsável' }
const dinheiro = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

export default function Radar() {
  const { usuario } = useSessao()
  const funil = useFunil()
  const nomes = useNomesDaEquipe()
  const { negocios, carregando, erro, recarregar } = useRadar()
  const [filtro, setFiltro] = useState<FiltroDoRadar>('meus')
  const [combinando, setCombinando] = useState<string | null>(null)

  const visiveis = useMemo(() => filtrarRadar(negocios, filtro, usuario?.id), [negocios, filtro, usuario?.id])
  const grupos = useMemo(() => agruparRadar(visiveis), [visiveis])
  const valores = useMemo(() => valorPorFaixa(visiveis), [visiveis])

  const linha = (n: NegocioDoRadar) => <li key={n.oportunidade_id} className="radar-linha">
    <div className="radar-corpo">
      <strong><Link to={`/leads/${n.contato_id}`}>{n.contato_nome?.trim() || 'Sem nome'}</Link></strong>
      <small>
        {n.nome} · {funil.rotulo(n.etapa)}{n.valor_proposta ? ` · ${dinheiro(n.valor_proposta)}` : ''}
        {' · '}{n.responsavel_id ? nomes.get(n.responsavel_id) ?? 'Sem nome' : 'sem responsável'}
      </small>
      <small className={`radar-parado radar-${n.faixa}`}>
        sem atividade há {rotuloParado(n.horas_parado)}{n.protegido_por ? ` · ${ROTULO_PROTECAO[n.protegido_por]}` : ''}
      </small>
    </div>
    {n.faixa !== 'em_voo' && <button type="button" className="arc-button arc-button-secondary" aria-expanded={combinando === n.oportunidade_id} onClick={() => setCombinando(combinando === n.oportunidade_id ? null : n.oportunidade_id)}>
      <ListPlus size={15} />Combinar próximo passo
    </button>}
    {combinando === n.oportunidade_id && <div className="radar-form"><FormNovaTarefa contatoId={n.contato_id} oportunidadeId={n.oportunidade_id} aoCriar={() => { setCombinando(null); recarregar() }} /></div>}
  </li>

  return <div className="page-content">
    <PageHeader eyebrow="Negócios" title="Radar" description="Os negócios abertos que esfriaram. Um negócio sem próximo passo morre sem ninguém ver; crie uma tarefa e ele sai do risco." />
    <div role="tablist" aria-label="Quais negócios mostrar" style={{ display: 'flex', gap: 8, margin: '0 0 16px', flexWrap: 'wrap' }}>
      {(Object.keys(ROTULO_FILTRO) as FiltroDoRadar[]).map((f) =>
        <button key={f} type="button" role="tab" aria-selected={filtro === f} className={`arc-button ${filtro === f ? 'arc-button-primary' : 'arc-button-secondary'}`} onClick={() => setFiltro(f)}>{ROTULO_FILTRO[f]}</button>)}
    </div>
    {erro && <Notice tone="danger">Não foi possível carregar o radar.</Notice>}
    {carregando ? <LoadingState label="Carregando o radar…" /> : visiveis.length === 0
      ? <Card><EmptyState title="Nada esfriando">{filtro === 'meus' ? 'Nenhum negócio seu passou da janela sem próximo passo.' : 'Nenhum negócio aberto passou da janela de esfriamento.'}</EmptyState></Card>
      : FAIXAS.map((f) => grupos[f].length > 0 && <section key={f} aria-label={ROTULO_FAIXA[f]} className="radar-grupo">
        <h2>{ROTULO_FAIXA[f]} <span>{grupos[f].length}{valores[f] > 0 ? ` · ${dinheiro(valores[f])} em propostas` : ''}</span></h2>
        <p>{EXPLICA_FAIXA[f]}</p>
        <Card><ul>{grupos[f].map(linha)}</ul></Card>
      </section>)}
  </div>
}
