import { useState } from 'react'
import { Button, Notice } from './ui'
import { supabase } from '../lib/supabase'
interface Fonte { id: string; nome: string; codigo_ref?: string | null; utm_ref?: Record<string,string> }
const chaves = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term']
export default function ReferenciaCaptacao({ fonte }: { fonte: Fonte }) {
  const [codigo, setCodigo] = useState(fonte.codigo_ref ?? '')
  const [utm, setUtm] = useState(fonte.utm_ref ?? {})
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState('')
  const [erro, setErro] = useState(false)
  const [salvo, setSalvo] = useState(fonte.codigo_ref ?? '')
  return <details className="captacao-referencia"><summary>Origem da landing page · {fonte.nome}</summary>
    <p>Inclua o código na mensagem do botão WhatsApp. As UTMs abaixo serão a primeira origem de contatos novos. A fonte precisa estar ativa.</p>
    <form onSubmit={e => { e.preventDefault(); setSalvando(true); setAviso(''); void supabase.rpc('captacao_configurar_referencia',{p_fonte:fonte.id,p_codigo:codigo || null,p_utm:utm}).then(r => { setSalvando(false); setErro(!!r.error); setAviso(r.error ? 'Não foi possível salvar. Confira o código; ele deve ser único.' : 'Referência salva.'); if (!r.error) setSalvo(codigo) }) }}>
      <div className="captacao-filtros"><label>Código de {fonte.nome}<input pattern="[a-zA-Z0-9_-]{3,64}" maxLength={64} value={codigo} onChange={e => setCodigo(e.target.value)} placeholder="landing-outubro" /></label>
      {chaves.map(k => <label key={k}>{k.replace('utm_','')} de {fonte.nome}<input maxLength={200} value={utm[k] ?? ''} onChange={e => setUtm({...utm,[k]:e.target.value})} /></label>)}</div>
      <Button type="submit" disabled={salvando}>Salvar referência de {fonte.nome}</Button>
    </form>
    {aviso && <Notice tone={erro ? 'danger' : 'success'}>{aviso}</Notice>}
    {salvo && <p>Mensagem do botão: <code>Olá! Quero saber mais. [ref:{salvo}]</code></p>}
  </details>
}
