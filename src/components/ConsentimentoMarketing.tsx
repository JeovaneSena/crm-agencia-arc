import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useSessao } from '../lib/sessao'
import { mensagemDoBanco, quando } from '../lib/campanhas'

interface Consentimento { ativo: boolean; consentido_em: string | null; revogado_em: string | null; fonte: string }

/**
 * A autorização do contato para receber campanhas. Sem ela registrada a campanha NÃO envia. Quem concede é o
 * gestor, dizendo de onde veio a autorização; qualquer pessoa da equipe pode revogar. Revogar vale para sempre
 * até um gestor registrar uma autorização nova.
 */
export default function ConsentimentoMarketing({ contatoId }: { contatoId: string }) {
  const { usuario } = useSessao()
  const gestor = usuario?.papel === 'gestor'
  const [c, setC] = useState<Consentimento | null | undefined>(undefined)
  const [fonte, setFonte] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')

  const carregar = useCallback(() =>
    supabase.from('marketing_consentimentos').select('ativo,consentido_em,revogado_em,fonte').eq('contato_id', contatoId).maybeSingle()
      .then(({ data, error }) => { setC(error ? null : (data as Consentimento | null)) }), [contatoId])
  useEffect(() => { void carregar() }, [carregar])

  async function registrar(ativo: boolean) {
    setOcupado(true); setErro('')
    const { error } = await supabase.rpc('marketing_registrar_preferencia', { p_contato: contatoId, p_ativo: ativo, p_fonte: ativo ? fonte : (fonte.trim().length >= 5 ? fonte : 'Revogado pela equipe no CRM') })
    setOcupado(false)
    if (error) { setErro(mensagemDoBanco(error, 'Não foi possível salvar. Tente novamente.')); return }
    setFonte(''); await carregar()
  }

  if (c === undefined) return null
  return <div role="group" aria-label="Autorização para campanhas" style={{ marginTop: 18, padding: 14, border: '1px solid var(--border)', borderRadius: 10, fontSize: 13, lineHeight: 1.6 }}>
    <strong>Autorização para campanhas de WhatsApp</strong>
    <p style={{ margin: '4px 0 8px', color: c?.ativo ? 'var(--success)' : c ? 'var(--danger)' : 'var(--muted)' }}>
      {c?.ativo ? `Autorizada em ${quando(c.consentido_em)} · ${c.fonte}` : c ? `Pediu para parar em ${quando(c.revogado_em)} · ${c.fonte}` : 'Nenhuma autorização registrada: este contato não recebe campanhas.'}
    </p>
    {(gestor || c?.ativo) && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <input aria-label="De onde veio a autorização" placeholder={c?.ativo ? 'Motivo (opcional)' : 'De onde veio? Ex.: pediu pelo WhatsApp em 10/10'} value={fonte} onChange={e => setFonte(e.target.value)}
        style={{ flex: 1, minWidth: 220, padding: 8, border: '1px solid var(--border)', borderRadius: 8, font: 'inherit' }} />
      {gestor && !c?.ativo && <button disabled={ocupado || fonte.trim().length < 5} onClick={() => void registrar(true)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', font: 'inherit' }}>Registrar autorização</button>}
      {c?.ativo && <button disabled={ocupado} onClick={() => void registrar(false)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--danger)', color: 'var(--danger)', background: 'transparent', cursor: 'pointer', font: 'inherit' }}>Revogar</button>}
    </div>}
    {erro && <p role="alert" style={{ color: 'var(--danger)', margin: '6px 0 0' }}>{erro}</p>}
  </div>
}
