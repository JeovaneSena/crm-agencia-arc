import { useState } from 'react'
import {
  apenasDigitos, descricaoTamanhos, maiorTamanho, PAIS_PADRAO, PAISES, paisPorIso,
  paraCanonico, separarCanonico, validarNacional,
} from '../lib/telefones'

/* ──────────────────────────────────────────────
   Campo de WhatsApp com país e contagem de dígitos.

   Usado nos três lugares onde se cria uma pessoa — modal da agenda, novo
   contato e novo cliente. Existe como componente único justamente para que
   a regra não se repita (e não divirja) em três telas.

   O que sai daqui pelo `onChange` já é o formato canônico do banco:
   só dígitos, com o código do país.
────────────────────────────────────────────── */

interface Props {
  /** Valor canônico atual ('' quando vazio). */
  valor: string
  onChange: (canonico: string, valido: boolean) => void
  /** Rótulo acima do campo. **Vazio some com ele** — para quem já tem um. */
  rotulo?: string
  obrigatorio?: boolean
  /**
   * Mostra o `*` ou o `(opcional)` ao lado do rótulo.
   *
   * Desligue onde o campo não faz parte de um formulário que aceita ou recusa.
   * Em "Apagar uma pessoa" ele é uma busca: "(opcional)" ali só informava que
   * nada acontece se você não digitar nada — o que já é óbvio, e soava como
   * permissão para pular um campo que é o assunto inteiro do cartão.
   */
  marcador?: boolean
  /** Mensagem vinda de fora — usada para avisar que o número já é de alguém. */
  aviso?: React.ReactNode
}

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)', fontSize: 13.5,
  fontFamily: "var(--font-body)", color: 'var(--text)', outline: 'none',
  background: 'var(--surface)', boxSizing: 'border-box',
}

export default function CampoTelefone({
  valor, onChange, rotulo = 'WhatsApp', obrigatorio = true, marcador = true, aviso,
}: Props) {
  const inicial = separarCanonico(valor)
  const [iso, setIso] = useState(inicial?.pais.iso ?? PAIS_PADRAO)
  const [nacional, setNacional] = useState(inicial?.nacional ?? '')
  const [tocado, setTocado] = useState(false)

  const pais = paisPorIso(iso)
  const erro = validarNacional(pais, nacional)
  const vazio = nacional.length === 0

  const emitir = (novoIso: string, novoNacional: string) => {
    const p = paisPorIso(novoIso)
    const valido = validarNacional(p, novoNacional) === null
    onChange(valido ? paraCanonico(p, novoNacional) : '', valido)
  }

  const handlePais = (novoIso: string) => {
    setIso(novoIso)
    // O número digitado é preservado de propósito: quem erra o país conserta o
    // seletor sem precisar redigitar o telefone inteiro.
    const cortado = apenasDigitos(nacional).slice(0, maiorTamanho(paisPorIso(novoIso)))
    setNacional(cortado)
    emitir(novoIso, cortado)
  }

  const handleNumero = (texto: string) => {
    const d = apenasDigitos(texto).slice(0, maiorTamanho(pais))
    setNacional(d)
    emitir(iso, d)
  }

  // Só reclama depois que a pessoa saiu do campo — reclamar a cada tecla
  // digitada é ruído, já que todo número passa por estados incompletos.
  const mostrarErro = tocado && erro !== null && (obrigatorio || !vazio)

  return (
    <div>
      {rotulo !== '' && (
        <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
          {rotulo}{marcador && ' '}
          {marcador && (obrigatorio
            ? '*'
            : <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(opcional)</span>)}
        </label>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <select
          value={iso}
          onChange={(e) => handlePais(e.target.value)}
          style={{ ...inputStyle, width: 118, cursor: 'pointer', flexShrink: 0, paddingRight: 6 }}
        >
          {PAISES.map((p) => (
            <option key={p.iso} value={p.iso}>{p.bandeira} +{p.ddi}</option>
          ))}
        </select>

        <input
          value={pais.formatar(nacional)}
          onChange={(e) => handleNumero(e.target.value)}
          onBlur={(e) => { setTocado(true); e.target.style.borderColor = mostrarErro ? 'var(--danger)' : 'var(--border)' }}
          onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')}
          inputMode="numeric"
          placeholder={pais.exemplo}
          style={{
            ...inputStyle,
            flex: 1,
            minWidth: 0,
            borderColor: mostrarErro ? 'var(--danger)' : 'var(--border)',
          }}
        />
      </div>

      {/* Contador: mostra o quanto falta enquanto se digita. */}
      {!vazio && !mostrarErro && (
        <div style={{ fontSize: 11.5, color: erro ? 'var(--muted)' : 'var(--success)', marginTop: 5 }}>
          {erro
            ? `${nacional.length} de ${descricaoTamanhos(pais)}`
            : `✓ +${pais.ddi} ${pais.formatar(nacional)}`}
        </div>
      )}

      {mostrarErro && (
        <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 5 }}>{erro}</div>
      )}

      {vazio && pais.dica && (
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 5 }}>{pais.dica}</div>
      )}

      {aviso && <div style={{ marginTop: 8 }}>{aviso}</div>}
    </div>
  )
}
