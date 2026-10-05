import { useEffect, useState } from 'react'
import { Card, Notice } from './ui'
import { supabase } from '../lib/supabase'

interface Atribuicao { utm: Record<string,string>; recebida_em: string; fonte: { nome: string } | null; canal: string; referencia: string | null; meta: Record<string,string> }
export default function OrigemDoContato({ contatoId }: { contatoId: string }) {
  const [origem, setOrigem] = useState<Atribuicao | null>(null)
  const [erro, setErro] = useState(false)
  useEffect(() => {
    let atual = true
    void supabase.from('contato_atribuicoes').select('utm,recebida_em,canal,referencia,meta,fonte:captacao_fontes(nome)').eq('contato_id', contatoId).maybeSingle().then(r => {
      if (atual) { setErro(!!r.error); setOrigem(r.data as unknown as Atribuicao | null) }
    })
    return () => { atual = false }
  }, [contatoId])
  if (erro) return <Notice tone="danger">Não foi possível carregar a origem do contato.</Notice>
  if (!origem) return null
  return <Card style={{ padding: 22, marginBottom: 16 }} aria-label="Primeira origem do contato">
    <h2 style={{ fontSize: 16 }}>Primeira origem</h2>
    <p>{origem.fonte?.nome ?? (origem.canal === 'meta' ? 'Meta · clique para WhatsApp' : 'Origem registrada')} · {new Date(origem.recebida_em).toLocaleString('pt-BR')}</p>
    {origem.referencia && <p>Referência: {origem.referencia}</p>}
    {origem.meta?.source_id && <p>{origem.meta.source_type === 'ad' ? 'Anúncio' : 'Publicação'}: {origem.meta.source_id}</p>}
    <dl>{Object.entries(origem.utm).map(([k,v]) => <div key={k}><dt>{k.replace('utm_', '')}</dt><dd style={{ overflowWrap: 'anywhere' }}>{v}</dd></div>)}</dl>
  </Card>
}
