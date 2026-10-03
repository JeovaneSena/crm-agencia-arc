import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Button, Card, EmptyState, LoadingState, Notice, PageHeader } from '../components/ui'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'
import { chamarCampanhas, COR_STATUS_MODELO, postarCampanhas, ROTULO_STATUS_MODELO, type ModeloDeGestao, type NovoModelo } from '../lib/campanhas'

/**
 * Modelos da Meta: o que dá para fazer sem sair do CRM. Listar todos (com o motivo da reprovação), criar
 * (texto, variáveis com exemplo, rodapé e respostas rápidas) e apagar. A aprovação é da Meta e leva de
 * minutos a horas; mídia, botão de link e modelos de autenticação continuam no WhatsApp Manager.
 */
const VAZIO: NovoModelo = { nome: '', idioma: 'pt_BR', categoria: 'MARKETING', corpo: '', exemplos: [], rodape: '', botoes: [] }

/** Quantas variáveis {{n}} o texto tem (a maior). */
const quantasVariaveis = (corpo: string) => Math.min(10, Math.max(0, ...[...corpo.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]))))

export default function ModelosMeta() {
  const [modelos, setModelos] = useState<ModeloDeGestao[] | null>(null)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [form, setForm] = useState<NovoModelo | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [apagando, setApagando] = useState<ModeloDeGestao | null>(null)

  const carregar = useCallback(() => chamarCampanhas<{ modelos: ModeloDeGestao[] }>('/modelos/todos')
    .then((r) => { setModelos(r.modelos); setErro('') })
    .catch((e: Error) => { setErro(e.message); setModelos([]) }), [])
  useEffect(() => { void carregar() }, [carregar])

  const n = form ? quantasVariaveis(form.corpo) : 0
  function mudar(campos: Partial<NovoModelo>) {
    if (!form) return
    const novo = { ...form, ...campos }
    // Mantém um campo de exemplo para cada variável do texto.
    const total = quantasVariaveis(novo.corpo)
    novo.exemplos = Array.from({ length: total }, (_, i) => novo.exemplos[i] ?? '')
    setForm(novo)
  }

  async function criar() {
    if (!form) return
    setSalvando(true); setErro(''); setAviso('')
    try {
      await postarCampanhas('/modelos', { ...form, botoes: form.botoes.filter((b) => b.trim()) })
      setAviso('Modelo enviado para análise da Meta. Costuma levar de minutos a algumas horas; atualize a lista para ver o resultado.')
      setForm(null); await carregar()
    } catch (e) { setErro((e as Error).message) }
    setSalvando(false)
  }

  async function apagar() {
    if (!apagando) return
    setSalvando(true); setErro('')
    try { await postarCampanhas('/modelos/apagar', { nome: apagando.nome }); setApagando(null); setAviso('Modelo apagado.'); await carregar() }
    catch (e) { setErro((e as Error).message); setApagando(null) }
    setSalvando(false)
  }

  return <div className="page-content">
    <PageHeader eyebrow="Campanhas" title="Modelos da Meta" description="Os textos que a Meta precisa aprovar antes de você disparar uma campanha. Crie aqui e acompanhe a aprovação."
      actions={<><Link className="arc-button arc-button-secondary" to="/campanhas"><ArrowLeft size={15} /> Campanhas</Link><Button onClick={() => void carregar()}><RefreshCw size={15} /> Atualizar</Button><Button variant="primary" onClick={() => setForm({ ...VAZIO })}><Plus size={15} /> Novo modelo</Button></>} />
    {erro && <Notice tone="danger">{erro}</Notice>}
    {aviso && <Notice tone="success">{aviso}</Notice>}

    {form && <Card aria-label="Novo modelo" style={{ marginBottom: 16 }}>
      <form onSubmit={(e) => { e.preventDefault(); void criar() }} style={{ display: 'grid', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>Novo modelo</h2>
        <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Nome (minúsculas, números e _)<input className="arc-field" required value={form.nome} onChange={(e) => mudar({ nome: e.target.value })} placeholder="promo_outubro" /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Tipo<select className="arc-field" value={form.categoria} onChange={(e) => mudar({ categoria: e.target.value as NovoModelo['categoria'] })}><option value="MARKETING">Marketing (ofertas, novidades)</option><option value="UTILITY">Utilidade (avisos sobre algo já combinado)</option></select></label>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Idioma<select className="arc-field" value={form.idioma} onChange={(e) => mudar({ idioma: e.target.value })}><option value="pt_BR">Português (Brasil)</option><option value="en_US">Inglês</option><option value="es">Espanhol</option><option value="es_AR">Espanhol (Argentina)</option></select></label>
        </div>
        <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Texto da mensagem<textarea className="arc-field" required rows={5} maxLength={1024} value={form.corpo} onChange={(e) => mudar({ corpo: e.target.value })} placeholder="Olá {{1}}, temos novidades em {{2}}. Quer ver?" /></label>
        <small style={{ color: 'var(--muted)' }}>Use {'{{1}}'}, {'{{2}}'}… para o que muda em cada envio (nome, empresa). O texto não pode começar nem terminar com uma variável.</small>
        {Array.from({ length: n }, (_, i) => <label key={i} style={{ display: 'grid', gap: 4, fontSize: 13 }}>Exemplo para {`{{${i + 1}}}`}<input className="arc-field" required value={form.exemplos[i] ?? ''} onChange={(e) => mudar({ exemplos: form.exemplos.map((x, k) => (k === i ? e.target.value : x)) })} placeholder="ex.: Maria" /></label>)}
        <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Rodapé (opcional)<input className="arc-field" maxLength={60} value={form.rodape} onChange={(e) => mudar({ rodape: e.target.value })} placeholder="ex.: Responda SAIR para parar de receber" /></label>
        <fieldset style={{ border: '1px solid var(--border)', borderRadius: 8, display: 'grid', gap: 8 }}><legend style={{ fontSize: 13 }}>Botões de resposta (até 3, opcional)</legend>
          {[0, 1, 2].map((i) => <input key={i} className="arc-field" aria-label={`Botão ${i + 1}`} maxLength={25} placeholder={`Botão ${i + 1}`} value={form.botoes[i] ?? ''} onChange={(e) => { const b = [0, 1, 2].map((k) => form.botoes[k] ?? ''); b[i] = e.target.value; mudar({ botoes: b }) }} />)}
        </fieldset>
        <div style={{ display: 'flex', gap: 8 }}><Button variant="primary" type="submit" disabled={salvando}>{salvando ? 'Enviando…' : 'Enviar para a Meta'}</Button><Button type="button" onClick={() => setForm(null)} disabled={salvando}>Cancelar</Button></div>
      </form>
    </Card>}

    {modelos === null ? <LoadingState label="Consultando a Meta…" /> : modelos.length === 0 && !erro ? <Card><EmptyState title="Nenhum modelo ainda">Crie o primeiro em “Novo modelo”.</EmptyState></Card> : (
      <div style={{ display: 'grid', gap: 12 }}>
        {modelos.map((m) => <Card key={`${m.id}-${m.idioma}`} aria-label={m.nome}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: `var(--${COR_STATUS_MODELO[m.status] ?? 'muted'}-soft, var(--surface-subtle))`, color: `var(--${COR_STATUS_MODELO[m.status] ?? 'muted'}, var(--muted))` }}>{ROTULO_STATUS_MODELO[m.status] ?? m.status}</span>
              <h2 style={{ fontSize: 16, margin: '8px 0 2px' }}>{m.nome}</h2>
              <small style={{ color: 'var(--muted)' }}>{m.categoria === 'MARKETING' ? 'Marketing' : m.categoria === 'UTILITY' ? 'Utilidade' : m.categoria} · {m.idioma}{m.qualidade ? ` · qualidade ${m.qualidade}` : ''}</small>
            </div>
            <Button variant="danger" aria-label={`Apagar ${m.nome}`} onClick={() => setApagando(m)}><Trash2 size={14} /></Button>
          </div>
          <p style={{ whiteSpace: 'pre-wrap', margin: '10px 0 4px' }}>{m.corpo}</p>
          {m.rodape && <small style={{ color: 'var(--muted)', display: 'block' }}>{m.rodape}</small>}
          {m.botoes.length > 0 && <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>{m.botoes.map((b) => <span key={b} className="arc-tag arc-tag-muted">{b}</span>)}</div>}
          {m.motivo && <Notice tone="danger">Motivo informado pela Meta: {m.motivo}</Notice>}
        </Card>)}
      </div>
    )}

    {apagando && <ConfirmDeleteModal itemName={apagando.nome} loading={salvando} title="Apagar modelo" confirmLabel="Apagar" loadingLabel="Apagando…"
      message={<>Apagar o modelo <strong>{apagando.nome}</strong> na Meta, em todos os idiomas? Não dá para desfazer, e o nome pode ficar indisponível por um tempo.</>}
      onClose={() => setApagando(null)} onConfirm={() => void apagar()} />}
  </div>
}
