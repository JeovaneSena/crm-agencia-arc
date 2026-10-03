import { useState } from 'react'
import { ArrowDown, ArrowUp, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { CORES_ETAPA, estiloDaEtapa, recarregarFunil, useFunil, type CorEtapa, type Etapa } from '../lib/funil'
import { Button, Notice } from './ui'

/**
 * Aba "Funil" de Configurações: rótulo, cor e ordem das etapas.
 *
 * As chaves técnicas (novo_lead … perdido) são fixas — o banco tem gatilhos que
 * dependem delas, e o histórico guarda a chave. O que a equipe muda aqui é o
 * que aparece na tela. Ganho e Perdido ficam sempre no fim: são o resultado da
 * venda, não etapas de andamento.
 */

const NOMES_COR: Record<CorEtapa, string> = {
  accent: 'Turquesa', info: 'Azul', success: 'Verde', warning: 'Âmbar', purple: 'Roxo', danger: 'Vermelho',
}

export default function TabFunil() {
  const funil = useFunil()
  const [rascunho, setRascunho] = useState<Record<string, { rotulo: string; cor: CorEtapa; esfria: string }>>({})
  const [salvando, setSalvando] = useState<string | null>(null)
  const [erro, setErro] = useState('')
  const [salvo, setSalvo] = useState<string | null>(null)

  const valor = (e: Etapa) => rascunho[e.chave] ?? { rotulo: e.rotulo, cor: e.cor, esfria: e.esfria_apos_horas == null ? '' : String(e.esfria_apos_horas) }
  const alterou = (e: Etapa) => valor(e).rotulo.trim() !== e.rotulo || valor(e).cor !== e.cor || valor(e).esfria.trim() !== (e.esfria_apos_horas == null ? '' : String(e.esfria_apos_horas))

  async function guardar(e: Etapa) {
    const v = valor(e)
    const rotulo = v.rotulo.trim()
    if (!rotulo || rotulo.length > 40) { setErro('O nome da etapa precisa ter de 1 a 40 caracteres.'); return }
    const esfria = v.esfria.trim()
    if (e.tipo === 'aberta' && esfria && !(/^\d+$/.test(esfria) && Number(esfria) >= 1 && Number(esfria) <= 2160)) { setErro('O tempo para esfriar vai de 1 a 2160 horas (90 dias). Deixe vazio para usar 48 horas.'); return }
    setSalvando(e.chave); setErro(''); setSalvo(null)
    const campos = e.tipo === 'aberta' ? { rotulo, cor: v.cor, esfria_apos_horas: esfria ? Number(esfria) : null } : { rotulo, cor: v.cor }
    const { error } = await supabase.from('etapas_funil').update(campos).eq('chave', e.chave)
    setSalvando(null)
    if (error) { setErro('Não foi possível salvar. Confirme que você é gestor e tente de novo.'); return }
    setRascunho(r => Object.fromEntries(Object.entries(r).filter(([chave]) => chave !== e.chave)))
    await recarregarFunil()
    setSalvo(e.chave); setTimeout(() => setSalvo(s => (s === e.chave ? null : s)), 2000)
  }

  /** Troca a ordem de duas etapas em andamento. A ordem é única no banco, então
   *  passa por um valor temporário no meio. */
  async function mover(e: Etapa, sentido: -1 | 1) {
    const abertas = funil.abertas
    const i = abertas.findIndex(x => x.chave === e.chave)
    const outra = abertas[i + sentido]
    if (!outra) return
    setSalvando(e.chave); setErro('')
    const temp = 1000 + e.ordem
    const passos = [
      supabase.from('etapas_funil').update({ ordem: temp }).eq('chave', e.chave),
      supabase.from('etapas_funil').update({ ordem: e.ordem }).eq('chave', outra.chave),
      supabase.from('etapas_funil').update({ ordem: outra.ordem }).eq('chave', e.chave),
    ]
    for (const passo of passos) {
      const { error } = await passo
      if (error) { setErro('Não foi possível reordenar. Atualize a página e confira a ordem.'); break }
    }
    setSalvando(null)
    await recarregarFunil()
  }

  const abertas = funil.abertas
  const encerradas = funil.etapas.filter(x => x.tipo !== 'aberta')

  const linha = (e: Etapa, mostrarOrdem: boolean) => {
    const v = valor(e)
    const estilo = estiloDaEtapa({ cor: v.cor, tipo: e.tipo })
    const i = abertas.findIndex(x => x.chave === e.chave)
    return (
      <div key={e.chave} className="funil-linha" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
        {mostrarOrdem && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button type="button" aria-label={`Subir ${e.rotulo}`} disabled={i <= 0 || salvando !== null} onClick={() => void mover(e, -1)} style={{ background: 'none', border: 'none', cursor: i <= 0 ? 'default' : 'pointer', color: 'var(--muted)', padding: 0, opacity: i <= 0 ? 0.3 : 1 }}><ArrowUp size={14} /></button>
            <button type="button" aria-label={`Descer ${e.rotulo}`} disabled={i >= abertas.length - 1 || salvando !== null} onClick={() => void mover(e, 1)} style={{ background: 'none', border: 'none', cursor: i >= abertas.length - 1 ? 'default' : 'pointer', color: 'var(--muted)', padding: 0, opacity: i >= abertas.length - 1 ? 0.3 : 1 }}><ArrowDown size={14} /></button>
          </div>
        )}
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: estilo.color, flexShrink: 0 }} aria-hidden="true" />
        <input
          aria-label={`Nome da etapa ${e.chave}`}
          className="arc-field"
          value={v.rotulo}
          maxLength={40}
          onChange={ev => setRascunho(r => ({ ...r, [e.chave]: { ...valor(e), rotulo: ev.target.value } }))}
          style={{ flex: '1 1 200px', minWidth: 160 }}
        />
        {e.tipo === 'aberta' ? (
          <select aria-label={`Cor da etapa ${e.rotulo}`} className="arc-field" value={v.cor} onChange={ev => setRascunho(r => ({ ...r, [e.chave]: { ...valor(e), cor: ev.target.value as CorEtapa } }))} style={{ width: 130 }}>
            {CORES_ETAPA.map(c => <option key={c} value={c}>{NOMES_COR[c]}</option>)}
          </select>
        ) : <span style={{ width: 130, fontSize: 12, color: 'var(--muted)' }}>{e.tipo === 'ganho' ? 'Verde (fixo)' : 'Vermelho (fixo)'}</span>}
        {e.tipo === 'aberta' && <input aria-label={`Esfria após, em horas, na etapa ${e.rotulo}`} className="arc-field" type="number" min={1} max={2160} inputMode="numeric" placeholder="48" title="Horas sem atividade até o radar marcar o negócio como esfriado (crítico em 3 vezes isso). Vazio = 48." value={v.esfria} onChange={ev => setRascunho(r => ({ ...r, [e.chave]: { ...valor(e), esfria: ev.target.value } }))} style={{ width: 84 }} />}
        <Button variant="primary" disabled={!alterou(e) || salvando !== null} onClick={() => void guardar(e)}>
          {salvo === e.chave ? <><Check size={14} /> Salvo</> : salvando === e.chave ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    )
  }

  return (
    <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '22px 26px' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Etapas do funil</div>
      <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 14px', lineHeight: 1.6 }}>
        Renomeie, troque a cor e reordene as etapas em andamento. O histórico das oportunidades não muda:
        só o nome que aparece na tela. <strong>Diagnóstico realizado</strong> é alcançada sozinha quando uma reunião
        marcada acontece; você pode renomeá-la, mas ela continua existindo. A coluna numérica é o <strong>radar</strong>: quantas
        horas sem atividade esfriam um negócio naquela etapa (vazio = 48; crítico em 3 vezes isso).
      </p>
      {erro && <div style={{ marginBottom: 12 }}><Notice tone="danger">{erro}</Notice></div>}
      <div role="group" aria-label="Etapas em andamento">{abertas.map(e => linha(e, true))}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', margin: '18px 0 2px' }}>Resultado da venda (sempre no fim)</div>
      <div role="group" aria-label="Resultado da venda">{encerradas.map(e => linha(e, false))}</div>
    </div>
  )
}
