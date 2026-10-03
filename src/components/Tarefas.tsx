import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { apagarTarefa, concluirTarefa, criarTarefa, mudarPrazo, useTarefas, type TarefaComContato } from '../lib/tarefas'
import { agruparTarefas, doCampoDeData, paraCampoDeData, prazosRapidos, ROTULO_GRUPO, rotuloDoPrazo, TITULO_MAXIMO, validarNovaTarefa, type GrupoDeTarefa } from '../lib/tarefasRegras'
import { useEquipeAtiva, useNomesDaEquipe } from '../lib/useEquipeAtiva'
import { useSessao } from '../lib/sessao'
import ConfirmDeleteModal from './ConfirmDeleteModal'
import { EmptyState, LoadingState } from './ui'

/** Nova tarefa: o que, até quando e quem. Dentro de uma ficha (`contatoId`) ela já nasce ligada à pessoa. */
export function FormNovaTarefa({ contatoId, oportunidadeId, aoCriar }: { contatoId?: string; oportunidadeId?: string | null; aoCriar: () => void }) {
  const { usuario } = useSessao()
  const equipe = useEquipeAtiva()
  const [titulo, setTitulo] = useState('')
  const [prazo, setPrazo] = useState('')
  const [responsavel, setResponsavel] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const rapidos = useMemo(() => prazosRapidos(new Date()), [])

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault()
    const invalido = validarNovaTarefa(titulo, prazo)
    if (invalido) { setErro(invalido); return }
    setEnviando(true); setErro('')
    try {
      await criarTarefa({ titulo, vence_em: doCampoDeData(prazo)!, contato_id: contatoId ?? null, oportunidade_id: contatoId ? oportunidadeId ?? null : null, responsavel_id: responsavel || null })
      setTitulo(''); setPrazo(''); setResponsavel(''); aoCriar()
    } catch (e) {
      setErro((e as { code?: string }).code === '22023' ? 'O responsável precisa ser uma pessoa ativa da equipe.' : 'Não foi possível criar a tarefa.')
    } finally { setEnviando(false) }
  }

  return <form className="tarefa-form" onSubmit={(ev) => void enviar(ev)} aria-label="Nova tarefa">
    <input className="arc-field" aria-label="O que precisa ser feito" maxLength={TITULO_MAXIMO} placeholder="O que precisa ser feito? Ex.: ligar para confirmar a proposta" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
    <div className="tarefa-form-linha">
      <input className="arc-field" type="datetime-local" aria-label="Prazo" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
      <select className="arc-field" aria-label="Responsável" value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
        <option value="">{usuario ? 'Eu' : 'Responsável'}</option>
        {equipe.filter((m) => m.id !== usuario?.id).map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
      </select>
      <button type="submit" className="arc-button arc-button-primary" disabled={enviando}><Plus size={15} />Criar tarefa</button>
    </div>
    <div className="tarefa-atalhos" aria-label="Prazos rápidos">
      {rapidos.map((p) => <button key={p.chave} type="button" className="tarefa-atalho" onClick={() => setPrazo(paraCampoDeData(p.data))}>{p.rotulo}</button>)}
    </div>
    {erro && <p role="alert" style={{ color: 'var(--danger)', fontSize: 12.5, margin: '6px 0 0' }}>{erro}</p>}
  </form>
}

function Linha({ t, agora, nomes, mostrarContato, aoMudar, aoErro }: { t: TarefaComContato; agora: Date; nomes: Map<string, string>; mostrarContato: boolean; aoMudar: () => void; aoErro: (m: string) => void }) {
  const [ocupada, setOcupada] = useState(false)
  const [apagando, setApagando] = useState(false)
  const feita = !!t.concluida_em
  const vencida = !feita && new Date(t.vence_em).getTime() < agora.getTime()
  const rapidos = useMemo(() => prazosRapidos(agora).filter((p) => p.chave !== 'hoje'), [agora])

  async function rodar(f: () => Promise<void>, falha: string) {
    setOcupada(true)
    try { await f(); aoMudar() } catch (e) { aoErro(e instanceof Error && !(e as { code?: string }).code ? e.message : falha) } finally { setOcupada(false) }
  }

  return <li className={`tarefa-linha${feita ? ' tarefa-feita' : ''}`}>
    <button type="button" className="tarefa-check" aria-label={feita ? `Reabrir: ${t.titulo}` : `Concluir: ${t.titulo}`} title={feita ? 'Reabrir' : 'Concluir'} disabled={ocupada}
      onClick={() => void rodar(() => concluirTarefa(t.id, !feita), 'Não foi possível atualizar a tarefa.')}>
      {feita ? <RotateCcw size={14} /> : <Check size={14} />}
    </button>
    <div className="tarefa-corpo">
      <strong>{t.titulo}</strong>
      <small>
        <span className={vencida ? 'tarefa-vencida' : undefined}>{feita ? `concluída por ${t.concluida_por ? nomes.get(t.concluida_por) ?? 'alguém da equipe' : 'o sistema'}` : rotuloDoPrazo(t.vence_em, agora)}</span>
        {' · '}{t.responsavel_id ? nomes.get(t.responsavel_id) ?? 'Sem nome' : 'sem responsável'}
        {t.origem === 'sistema' && ' · criada pelo sistema'}
        {mostrarContato && t.contato && <> · <Link to={`/leads/${t.contato.id}`}>{t.contato.nome?.trim() || 'Sem nome'}</Link></>}
      </small>
    </div>
    {!feita && <select className="snooze-select" aria-label={`Mudar o prazo de ${t.titulo}`} value="" disabled={ocupada}
      onChange={(e) => { const p = rapidos.find((x) => x.chave === e.target.value); if (p) void rodar(() => mudarPrazo(t.id, p.data.toISOString()), 'Não foi possível mudar o prazo.') }}>
      <option value="">Adiar…</option>
      {rapidos.map((p) => <option key={p.chave} value={p.chave}>{p.rotulo}</option>)}
    </select>}
    <button type="button" className="tarefa-apagar" aria-label={`Apagar: ${t.titulo}`} title="Apagar" disabled={ocupada} onClick={() => setApagando(true)}><Trash2 size={14} /></button>
    {apagando && <ConfirmDeleteModal itemName={t.titulo} title="Apagar tarefa" confirmLabel="Apagar" loading={ocupada} onClose={() => setApagando(false)}
      onConfirm={() => void rodar(async () => { await apagarTarefa(t.id); setApagando(false) }, 'Não foi possível apagar a tarefa.')} />}
  </li>
}

/** As tarefas em grupos (vencidas, hoje, próximas) e, no fim, as concluídas da última semana. */
export function ListaDeTarefas({ tarefas, mostrarContato = true, aoMudar, vazio }: { tarefas: TarefaComContato[]; mostrarContato?: boolean; aoMudar: () => void; vazio?: string }) {
  const nomes = useNomesDaEquipe()
  const [erro, setErro] = useState('')
  // O relógio da lista, renovado a cada minuto: uma tarefa vira "vencida" sem recarregar a tela.
  const [agora, setAgora] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  const grupos = useMemo(() => agruparTarefas(tarefas, agora), [tarefas, agora])
  const concluidas = useMemo(() => tarefas.filter((t) => t.concluida_em).sort((a, b) => Date.parse(b.concluida_em!) - Date.parse(a.concluida_em!)), [tarefas])
  const abertas = grupos.vencidas.length + grupos.hoje.length + grupos.proximas.length

  const mudou = () => { setErro(''); aoMudar() }
  const secao = (g: GrupoDeTarefa) => grupos[g].length > 0 && <section key={g} aria-label={ROTULO_GRUPO[g]} className="tarefa-grupo">
    <h3 className={g === 'vencidas' ? 'tarefa-vencida' : undefined}>{ROTULO_GRUPO[g]} <span>{grupos[g].length}</span></h3>
    <ul>{grupos[g].map((t) => <Linha key={t.id} t={t} agora={agora} nomes={nomes} mostrarContato={mostrarContato} aoMudar={mudou} aoErro={setErro} />)}</ul>
  </section>

  return <div>
    {erro && <p role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{erro}</p>}
    {abertas === 0 && <EmptyState title="Nenhuma tarefa em aberto">{vazio ?? 'Crie uma tarefa para não deixar um próximo passo morrer.'}</EmptyState>}
    {(['vencidas', 'hoje', 'proximas'] as GrupoDeTarefa[]).map(secao)}
    {concluidas.length > 0 && <section aria-label="Concluídas" className="tarefa-grupo">
      <h3>Concluídas na última semana <span>{concluidas.length}</span></h3>
      <ul>{concluidas.map((t) => <Linha key={t.id} t={t} agora={agora} nomes={nomes} mostrarContato={mostrarContato} aoMudar={mudou} aoErro={setErro} />)}</ul>
    </section>}
  </div>
}

/** As tarefas de UM contato, na ficha: formulário já ligado à pessoa e a lista dela. */
export function TarefasDoContato({ contatoId }: { contatoId: string }) {
  const { tarefas, carregando, erro, recarregar } = useTarefas(contatoId)
  return <div>
    <FormNovaTarefa contatoId={contatoId} aoCriar={recarregar} />
    <div style={{ marginTop: 16 }}>
      {erro && <p role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>Não foi possível carregar as tarefas.</p>}
      {carregando ? <LoadingState label="Carregando tarefas…" /> : <ListaDeTarefas tarefas={tarefas} mostrarContato={false} aoMudar={recarregar} vazio="Combine um próximo passo com prazo para esta pessoa." />}
    </div>
  </div>
}
