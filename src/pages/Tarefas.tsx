import { useMemo, useState } from 'react'
import { Card, LoadingState, Notice, PageHeader } from '../components/ui'
import { FormNovaTarefa, ListaDeTarefas } from '../components/Tarefas'
import { useSessao } from '../lib/sessao'
import { useTarefas } from '../lib/tarefas'
import { contarVencidas } from '../lib/tarefasRegras'

type Filtro = 'minhas' | 'todas' | 'sem_responsavel'
const ROTULO: Record<Filtro, string> = { minhas: 'Minhas', todas: 'Todas', sem_responsavel: 'Sem responsável' }

export default function Tarefas() {
  const { usuario } = useSessao()
  const { tarefas, carregando, erro, recarregar } = useTarefas()
  const [filtro, setFiltro] = useState<Filtro>('minhas')

  const visiveis = useMemo(() => tarefas.filter((t) =>
    filtro === 'todas' ? true : filtro === 'minhas' ? t.responsavel_id === usuario?.id : t.responsavel_id === null), [tarefas, filtro, usuario?.id])
  const vencidasMinhas = useMemo(() => contarVencidas(tarefas, new Date(), usuario?.id ?? null), [tarefas, usuario?.id])

  return <div className="page-content">
    <PageHeader eyebrow="Negócios" title="Tarefas" description="O próximo passo de cada contato, com prazo e responsável. Uma tarefa vencida vira aviso para a equipe." />
    {vencidasMinhas > 0 && <Notice tone="warning">Você tem {vencidasMinhas} {vencidasMinhas === 1 ? 'tarefa vencida' : 'tarefas vencidas'}.</Notice>}
    <Card style={{ margin: '16px 0' }}><FormNovaTarefa aoCriar={recarregar} /></Card>
    <div role="tablist" aria-label="Quais tarefas mostrar" style={{ display: 'flex', gap: 8, margin: '0 0 16px', flexWrap: 'wrap' }}>
      {(Object.keys(ROTULO) as Filtro[]).map((f) =>
        <button key={f} type="button" role="tab" aria-selected={filtro === f} className={`arc-button ${filtro === f ? 'arc-button-primary' : 'arc-button-secondary'}`} onClick={() => setFiltro(f)}>{ROTULO[f]}</button>)}
    </div>
    {erro && <Notice tone="danger">Não foi possível carregar as tarefas.</Notice>}
    {carregando ? <LoadingState label="Carregando tarefas…" /> : <Card><ListaDeTarefas tarefas={visiveis} aoMudar={recarregar}
      vazio={filtro === 'minhas' ? 'Nada em aberto para você.' : undefined} /></Card>}
  </div>
}
