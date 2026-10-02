import { useEffect, useState } from 'react'
import { listarOportunidades, type Oportunidade } from '../lib/oportunidades'

export default function OportunidadeReuniao({ leadId, valor, onChange }: { leadId: string; valor: string; onChange: (id: string) => void }) {
  const [lista, setLista] = useState<Oportunidade[]>([])
  const [erro, setErro] = useState('')
  useEffect(() => {
    let vivo = true
    listarOportunidades(leadId).then(data => { if (vivo) setLista(data.filter(o => !['ganho','perdido'].includes(o.status))) }).catch(() => { if (vivo) setErro('Não foi possível consultar as oportunidades. Atualize antes de escolher o vínculo.') })
    return () => { vivo = false }
  }, [leadId])
  return <label style={{ display: 'grid', gap: 8, fontSize: 13 }}>Oportunidade da reunião
    <select aria-label="Oportunidade da reunião" value={valor} onChange={e => onChange(e.target.value)} style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 8, width: '100%' }}><option value="">{lista.length === 1 ? 'Vincular à única oportunidade aberta' : 'Sem vínculo — reunião geral'}</option>{lista.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}</select>
    {lista.length > 1 && <small>Há várias negociações abertas. Escolha a relacionada a esta reunião; sem escolha, nenhuma etapa será alterada.</small>}
    {erro && <small role="alert">{erro}</small>}
  </label>
}
