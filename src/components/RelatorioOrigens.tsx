import { useEffect, useState } from 'react'
import { Button, Card, EmptyState, Notice } from './ui'
import { supabase } from '../lib/supabase'

interface Linha { canal: string; fonte: string; origem: string; campanha: string; conteudo: string; leads: number; ganhos: number; valor_ganho: number }
const dataLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
export default function RelatorioOrigens() {
  const [inicio, setInicio] = useState(() => { const d = new Date(); d.setDate(1); return dataLocal(d) })
  const [fim, setFim] = useState(() => dataLocal(new Date()))
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [consulta, setConsulta] = useState<{ inicio: string; fim: string; versao: number } | null>(null)
  useEffect(() => {
    if (!consulta) return
    let atual = true
    const de = new Date(`${consulta.inicio}T00:00:00`)
    const ate = new Date(`${consulta.fim}T00:00:00`); ate.setDate(ate.getDate()+1)
    void supabase.rpc('captacao_relatorio', { p_inicio: de.toISOString(), p_fim: ate.toISOString() }).then(r => {
      if (!atual) return
      setLinhas(r.error ? [] : r.data ?? []); setErro(r.error ? 'Não foi possível carregar o relatório. Escolha um período de até 366 dias.' : ''); setCarregando(false)
    })
    return () => { atual = false }
  }, [consulta])
  return <Card aria-label="Relatório por origem">
    <h2>Relatório por origem</h2>
    <p>Contatos criados no período. Negócios ganhos e valores mostram a situação atual desses contatos; o valor é o da proposta, não um pagamento recebido.</p>
    <form className="captacao-filtros" onSubmit={e => { e.preventDefault(); setErro(''); setLinhas([]); setCarregando(true); setConsulta({ inicio, fim, versao: Date.now() }) }}>
      <label>Desde<input type="date" required value={inicio} max={fim} onChange={e => setInicio(e.target.value)} /></label>
      <label>Até<input type="date" required value={fim} min={inicio} onChange={e => setFim(e.target.value)} /></label>
      <Button type="submit" disabled={carregando}>{carregando ? 'Carregando…' : 'Consultar origens'}</Button>
    </form>
    {erro && <Notice tone="danger">{erro}</Notice>}
    {consulta && !carregando && !erro && (linhas.length ? <div className="captacao-tabela"><table>
      <thead><tr>{['Canal / fonte','Origem','Campanha','Conteúdo / anúncio','Leads','Negócios ganhos','Valor das propostas ganhas'].map(c => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>{linhas.map((r,i) => <tr key={i}><td>{({ formulario: 'Formulário', referencia: 'Referência', meta: 'Meta', sem_origem: 'Sem origem' } as Record<string,string>)[r.canal]} · {r.fonte}</td><td>{r.origem}</td><td>{r.campanha}</td><td>{r.conteudo}</td><td>{r.leads}</td><td>{r.ganhos}</td><td>{Number(r.valor_ganho).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr>)}</tbody>
    </table></div> : <EmptyState title="Nenhum contato no período">Escolha outro intervalo para consultar.</EmptyState>)}
  </Card>
}
