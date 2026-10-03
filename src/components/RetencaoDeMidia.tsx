import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Button, Card, Notice } from './ui'

/**
 * Por quanto tempo guardar as fotos, os áudios e os documentos que os clientes mandam.
 *
 * Os arquivos ficam no Storage, e o plano gratuito tem 1 GB. Sem prazo o bucket enche e a
 * instalação para de receber mídia. Mas apagar arquivo de cliente não tem volta, então vem
 * DESLIGADO ("para sempre") e ligar exige confirmar que se entende isso.
 *
 * ⚠️ Interface, não segurança: quem aceita ou recusa o prazo é o banco (só o gestor escreve, mínimo
 * de 30 dias). Quem apaga é o vigia (`/vigiar`), em lotes, a cada rodada.
 */
const OPCOES: { dias: number | null; rotulo: string }[] = [
  { dias: null, rotulo: 'Para sempre (padrão)' },
  { dias: 90, rotulo: '3 meses' },
  { dias: 180, rotulo: '6 meses' },
  { dias: 365, rotulo: '1 ano' },
  { dias: 730, rotulo: '2 anos' },
]

export default function RetencaoDeMidia() {
  const [atual, setAtual] = useState<number | null | undefined>(undefined)
  const [escolhido, setEscolhido] = useState<number | null>(null)
  const [ciente, setCiente] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [salvo, setSalvo] = useState(false)

  useEffect(() => {
    let vivo = true
    void Promise.resolve(supabase.from('conversas_config').select('retencao_midia_dias').limit(1).maybeSingle()).then(({ data, error }) => {
      if (!vivo) return
      if (error) { setErro('Não foi possível ler a configuração.'); return }
      const dias = (data?.retencao_midia_dias as number | null | undefined) ?? null
      setAtual(dias); setEscolhido(dias)
    })
    return () => { vivo = false }
  }, [])

  if (atual === undefined && !erro) return null
  const alterou = escolhido !== atual
  // Encurtar ou ligar o prazo apaga arquivos: exige o "estou ciente". Voltar para "para sempre" não apaga nada.
  const apaga = escolhido !== null && (atual === null || atual === undefined || escolhido < atual)

  async function salvar() {
    setSalvando(true); setErro(''); setSalvo(false)
    const { data, error } = await supabase.from('conversas_config').update({ retencao_midia_dias: escolhido }).eq('id', true).select('retencao_midia_dias')
    setSalvando(false)
    // Sem erro e sem linha: a policy do banco filtrou (quem não é gestor).
    if (error || !data?.length) { setErro('Não foi possível salvar. Confirme que você é gestor e tente de novo.'); return }
    setAtual(escolhido); setCiente(false); setSalvo(true)
  }

  return <Card aria-label="Retenção de arquivos" style={{ marginTop: 16 }}>
    <h2 style={{ fontSize: 16, margin: '0 0 6px' }}>Arquivos das conversas</h2>
    <p style={{ margin: '0 0 14px', color: 'var(--muted)', fontSize: 13.5 }}>
      Fotos, áudios e documentos enviados pelos clientes ocupam espaço. Defina por quanto tempo guardá-los: depois do prazo o arquivo é apagado, e a mensagem e a transcrição continuam na conversa.
    </p>
    {erro && <Notice tone="danger">{erro}</Notice>}
    <label style={{ display: 'grid', gap: 6, maxWidth: 320, fontSize: 13.5 }}>
      Guardar por
      <select className="arc-field" value={escolhido === null ? '' : String(escolhido)} onChange={e => { setEscolhido(e.target.value === '' ? null : Number(e.target.value)); setSalvo(false); setCiente(false) }}>
        {OPCOES.map(o => <option key={o.rotulo} value={o.dias === null ? '' : String(o.dias)}>{o.rotulo}</option>)}
      </select>
    </label>
    {alterou && apaga && <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '14px 0 0', fontSize: 13.5 }}>
      <input type="checkbox" checked={ciente} onChange={e => setCiente(e.target.checked)} style={{ marginTop: 3 }} />
      <span>Entendo que os arquivos mais velhos que esse prazo serão apagados em poucos minutos e <strong>não podem ser recuperados</strong>.</span>
    </label>}
    <div style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
      <Button variant="primary" disabled={!alterou || salvando || (apaga && !ciente)} onClick={() => void salvar()}>{salvando ? 'Salvando…' : 'Salvar prazo'}</Button>
      {salvo && <span role="status" style={{ color: 'var(--success)', fontSize: 13 }}>Prazo salvo.</span>}
    </div>
  </Card>
}
