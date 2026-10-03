import { useState } from 'react'
import { FileSpreadsheet, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { criarEtiqueta, useEtiquetas } from '../lib/etiquetas'
import { acharPorNome, nomeValido } from '../lib/etiquetasRegras'
import { detectarColunas, lerCSV, LIMITE_DE_LINHAS, prepararLinhas, type Campo, type MapaDeColunas } from '../lib/importacao'
import ModalPortal from './ModalPortal'
import { Button, Notice } from './ui'

/**
 * Importar contatos de uma planilha CSV. Lê no navegador, mostra o que vai entrar e o que ficou de fora (e por quê)
 * antes de gravar qualquer coisa; a gravação é uma função única do banco (`contatos_importar`), tudo ou nada.
 *
 * Telefone que já existe NÃO é alterado. Importar NÃO registra consentimento de marketing.
 */
const ROTULO: Record<Campo, string> = { nome: 'Nome', whatsapp: 'Telefone / WhatsApp (obrigatório)', empresa: 'Empresa', email: 'E-mail' }
const TAMANHO_MAXIMO = 2 * 1024 * 1024

export default function ImportarContatos({ onFechar, onImportado }: { onFechar: () => void; onImportado: () => void }) {
  const { etiquetas } = useEtiquetas()
  const [arquivo, setArquivo] = useState('')
  const [tabela, setTabela] = useState<string[][]>([])
  const [mapa, setMapa] = useState<MapaDeColunas>({ nome: null, whatsapp: null, empresa: null, email: null })
  const [etiqueta, setEtiqueta] = useState('')
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [resultado, setResultado] = useState<{ criados: number; ja_existiam: number; ignoradas: number } | null>(null)

  const cabecalho = tabela[0] ?? []
  const preparado = tabela.length > 1 ? prepararLinhas(tabela.slice(1), mapa) : null

  async function aoEscolher(f: File | undefined) {
    setErro(''); setResultado(null)
    if (!f) return
    if (f.size > TAMANHO_MAXIMO) { setErro('O arquivo passa de 2 MB. Divida a planilha em partes.'); return }
    if (!/\.csv$/i.test(f.name) && !/csv|text\/plain/.test(f.type)) { setErro('Use um arquivo CSV. No Excel ou no Google Planilhas: Arquivo → Baixar/Salvar como → CSV.'); return }
    const linhas = lerCSV(await f.text())
    if (linhas.length < 2) { setErro('A planilha precisa de uma linha de títulos e ao menos um contato.'); return }
    setArquivo(f.name); setTabela(linhas); setMapa(detectarColunas(linhas[0]))
  }

  async function importar() {
    if (!preparado?.prontas.length) return
    setSalvando(true); setErro('')
    try {
      let idEtiqueta: string | null = null
      if (etiqueta.trim()) {
        if (!nomeValido(etiqueta)) throw new Error('A etiqueta precisa ter de 1 a 30 caracteres.')
        idEtiqueta = (acharPorNome(etiquetas, etiqueta) ?? await criarEtiqueta(etiqueta)).id
      }
      const { data, error } = await supabase.rpc('contatos_importar', { p_linhas: preparado.prontas, p_etiqueta: idEtiqueta })
      if (error) throw error
      setResultado(data as { criados: number; ja_existiam: number; ignoradas: number })
      onImportado()
    } catch (e) {
      setErro(e instanceof Error && e.message.startsWith('A etiqueta') ? e.message : 'Não foi possível importar. Nada foi gravado; confira o arquivo e tente de novo.')
    }
    setSalvando(false)
  }

  return <ModalPortal label="Importar contatos" onClose={onFechar} busy={salvando}>
    <div onClick={(e) => { if (e.target === e.currentTarget) onFechar() }}>
      <div className="arc-card" style={{ maxWidth: 680, margin: '0 auto', display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 17, display: 'flex', alignItems: 'center', gap: 8 }}><FileSpreadsheet size={18} /> Importar contatos</h2>
          <button type="button" aria-label="Fechar" onClick={onFechar} style={{ background: 'none', border: 0, cursor: 'pointer' }}><X size={18} /></button>
        </div>
        {erro && <Notice tone="danger">{erro}</Notice>}

        {resultado ? <>
          <Notice tone="success">
            <strong>{resultado.criados} {resultado.criados === 1 ? 'contato importado' : 'contatos importados'}.</strong>
            {resultado.ja_existiam > 0 && <> {resultado.ja_existiam} já existiam (não foram alterados).</>}
            {resultado.ignoradas > 0 && <> {resultado.ignoradas} foram recusados pelo banco.</>}
          </Notice>
          <Button variant="primary" onClick={onFechar}>Concluir</Button>
        </> : <>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>Escolha um arquivo <strong>CSV</strong> com uma linha de títulos (nome, telefone, empresa, e-mail). Até {LIMITE_DE_LINHAS} contatos por vez. Telefones que já estão no sistema não são alterados. Importar não registra autorização de marketing.</p>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Arquivo CSV<input type="file" accept=".csv,text/csv" onChange={(e) => void aoEscolher(e.target.files?.[0])} /></label>

          {tabela.length > 1 && <>
            <fieldset style={{ border: '1px solid var(--border)', borderRadius: 8, display: 'grid', gap: 8 }}>
              <legend style={{ fontSize: 13 }}>Qual coluna é qual — {arquivo}</legend>
              {(Object.keys(ROTULO) as Campo[]).map((campo) => <label key={campo} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'center', fontSize: 13 }}>
                {ROTULO[campo]}
                <select className="arc-field" aria-label={`Coluna de ${ROTULO[campo]}`} value={mapa[campo] === null ? '' : String(mapa[campo])} onChange={(e) => setMapa({ ...mapa, [campo]: e.target.value === '' ? null : Number(e.target.value) })}>
                  <option value="">(não importar)</option>
                  {cabecalho.map((h, i) => <option key={i} value={i}>{h || `Coluna ${i + 1}`}</option>)}
                </select>
              </label>)}
            </fieldset>

            {mapa.whatsapp === null ? <Notice tone="warning">Escolha qual coluna tem o telefone: sem ele não dá para importar.</Notice> : preparado && <>
              <Notice tone={preparado.prontas.length ? 'info' : 'warning'}>
                <strong>{preparado.prontas.length} {preparado.prontas.length === 1 ? 'contato pronto' : 'contatos prontos'} para importar.</strong>
                {preparado.repetidasNoArquivo > 0 && <> {preparado.repetidasNoArquivo} repetidos no arquivo (entram uma vez).</>}
                {preparado.problemas.length > 0 && <> {preparado.problemas.length} ficam de fora.</>}
                {preparado.excedeLimite && <> O arquivo passa de {LIMITE_DE_LINHAS}: só os primeiros entram agora; importe o restante em outro arquivo.</>}
              </Notice>
              {preparado.problemas.length > 0 && <details><summary style={{ cursor: 'pointer', fontSize: 13 }}>Ver o que ficou de fora</summary>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, maxHeight: 140, overflowY: 'auto' }}>
                  {preparado.problemas.slice(0, 50).map((p) => <li key={p.linha}>Linha {p.linha}: {p.motivo}</li>)}
                  {preparado.problemas.length > 50 && <li>…e mais {preparado.problemas.length - 50}.</li>}
                </ul></details>}
              <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Etiquetar o lote (opcional)
                <input className="arc-field" aria-label="Etiqueta do lote" maxLength={40} list="etiquetas-do-lote" placeholder="ex.: Lista outubro" value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} />
                <datalist id="etiquetas-do-lote">{etiquetas.map((e) => <option key={e.id} value={e.nome} />)}</datalist>
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="primary" disabled={!preparado.prontas.length || salvando} onClick={() => void importar()}>{salvando ? 'Importando…' : `Importar ${preparado.prontas.length}`}</Button>
                <Button onClick={onFechar} disabled={salvando}>Cancelar</Button>
              </div>
            </>}
          </>}
        </>}
      </div>
    </div>
  </ModalPortal>
}
