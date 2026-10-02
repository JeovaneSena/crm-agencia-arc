import React, { useEffect, useState } from 'react'
import { Save, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { ConfiguracoesNegocio } from '../types'

/**
 * Aba "Empresa" de Configurações: endereço, bairro, cidade, UF, CEP e os links
 * públicos da empresa.
 *
 * O que se preenche aqui vai para `configuracoes_negocio`, campo a campo. Quem
 * monta as frases é a view `view de informações do agente` (migração 0006), lida
 * pelo Agente de IA através do n8n.
 *
 * O bloco do fim da tela **lê a view de verdade**, não uma imitação: é a mesma
 * consulta que o agente faz. Se ele fosse montar a prévia por conta própria,
 * haveria duas implementações da mesma regra — e um dia a tela mostraria uma
 * coisa e o cliente ouviria outra.
 */

const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]

const FONTE = "var(--font-body)"

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)',
  fontSize: 13.5, fontFamily: FONTE, color: 'var(--text)',
  outline: 'none', background: 'var(--surface)', boxSizing: 'border-box',
}

const rotuloStyle: React.CSSProperties = {
  fontSize: 12.5, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 6,
}

const opcionalStyle: React.CSSProperties = { color: 'var(--muted)', fontWeight: 400 }

/** '88040600' → '88040-600'. Só na tela; o banco guarda os dígitos. */
function formatarCep(digitos: string): string {
  const d = digitos.replace(/\D/g, '').slice(0, 8)
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d
}

/** Campo em branco vira NULL, não string vazia — senão a view produz linha pelada. */
function ouNulo(texto: string): string | null {
  const limpo = texto.trim()
  return limpo === '' ? null : limpo
}

interface Formulario {
  nome_negocio: string
  endereco: string
  bairro: string
  cidade: string
  estado: string
  cep: string
  google_maps_url: string
  instagram_url: string
  site_url: string
}

const VAZIO: Formulario = {
  nome_negocio: '',
  endereco: '', bairro: '', cidade: '', estado: '', cep: '',
  google_maps_url: '', instagram_url: '', site_url: '',
}

export default function TabEmpresa() {
  const [empresa, setEmpresa] = useState<ConfiguracoesNegocio | null>(null)
  const [form, setForm] = useState<Formulario>(VAZIO)
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let vivo = true
    supabase.from('configuracoes_negocio').select('*').limit(1).single().then((resEmpresa) => {
      if (!vivo) return
      const c = resEmpresa.data as ConfiguracoesNegocio | null
      if (c) {
        setEmpresa(c)
        setForm({
          nome_negocio: c.nome_negocio ?? '',
          endereco: c.endereco ?? '',
          bairro: c.bairro ?? '',
          cidade: c.cidade ?? '',
          estado: c.estado ?? '',
          cep: c.cep ?? '',
          google_maps_url: c.google_maps_url ?? '',
          instagram_url: c.instagram_url ?? '',
          site_url: c.site_url ?? '',
        })
      }
      setLoading(false)
    })
    return () => { vivo = false }
  }, [])

  const set = (campo: keyof Formulario, valor: string) => {
    setForm((prev) => ({ ...prev, [campo]: valor }))
    setErro('')
    setSalvo(false)
  }

  const salvar = async () => {
    const cepDigitos = form.cep.replace(/\D/g, '')
    if (cepDigitos !== '' && cepDigitos.length !== 8) {
      setErro('O CEP precisa ter 8 dígitos.')
      return
    }
    for (const [campo, rotulo] of [
      ['google_maps_url', 'link do Google Maps'],
      ['instagram_url', 'Instagram'],
      ['site_url', 'site'],
    ] as [keyof Formulario, string][]) {
      const valor = form[campo].trim()
      if (valor !== '' && !/^https?:\/\//i.test(valor)) {
        setErro(`O ${rotulo} precisa começar com https://`)
        return
      }
    }

    setSalvando(true)
    setErro('')

    const dados = {
      nome_negocio: ouNulo(form.nome_negocio),
      endereco: ouNulo(form.endereco),
      bairro: ouNulo(form.bairro),
      cidade: ouNulo(form.cidade),
      estado: ouNulo(form.estado),
      cep: cepDigitos === '' ? null : cepDigitos,
      google_maps_url: ouNulo(form.google_maps_url),
      instagram_url: ouNulo(form.instagram_url),
      site_url: ouNulo(form.site_url),
    }

    const { data, error } = empresa
      ? await supabase.from('configuracoes_negocio').update(dados).eq('id', empresa.id).select().single()
      : await supabase.from('configuracoes_negocio').insert(dados).select().single()

    setSalvando(false)
    if (error) { setErro('Erro ao salvar. Tente novamente.'); return }

    setEmpresa(data as ConfiguracoesNegocio)
    // A Sidebar mostra o nome da empresa e recarrega a linha inteira ao ouvir
    // isto — senão o nome novo só apareceria no próximo F5.
    window.dispatchEvent(new Event('empresa-atualizada'))
    setSalvo(true)
    setTimeout(() => setSalvo(false), 2000)
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Carregando...</div>

  const foco = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => (e.target.style.borderColor = 'var(--accent)')
  const desfoco = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => (e.target.style.borderColor = 'var(--border)')

  return (
    <div>
      <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '22px 26px', marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Dados da Empresa</div>
        <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 18px', paddingBottom: 14, borderBottom: '1px solid var(--border-subtle)', lineHeight: 1.6 }}>
          Nome, endereço e links da empresa. O que você salvar aqui vale na hora —
          não há nada para publicar ou sincronizar.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={rotuloStyle}>Nome da empresa</label>
            <input value={form.nome_negocio} onChange={(e) => set('nome_negocio', e.target.value)}
              placeholder="Nome da sua empresa"
              style={inputStyle} onFocus={foco} onBlur={desfoco} />
          </div>

          <div>
            <label style={rotuloStyle}>Endereço <span style={opcionalStyle}>(rua, número e complemento)</span></label>
            <input value={form.endereco} onChange={(e) => set('endereco', e.target.value)}
              placeholder="Ex: Rua das Flores, 100 - sala 2"
              style={inputStyle} onFocus={foco} onBlur={desfoco} />
          </div>

          <div>
            <label style={rotuloStyle}>Bairro</label>
            <input value={form.bairro} onChange={(e) => set('bairro', e.target.value)}
              placeholder="Ex: Centro" style={inputStyle} onFocus={foco} onBlur={desfoco} />
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 2, minWidth: 180 }}>
              <label style={rotuloStyle}>Cidade</label>
              <input value={form.cidade} onChange={(e) => set('cidade', e.target.value)}
                placeholder="Ex: São Paulo" style={inputStyle} onFocus={foco} onBlur={desfoco} />
            </div>
            <div style={{ flex: 1, minWidth: 110 }}>
              <label style={rotuloStyle}>Estado</label>
              <select value={form.estado} onChange={(e) => set('estado', e.target.value)}
                style={{ ...inputStyle, cursor: 'pointer' }} onFocus={foco} onBlur={desfoco}>
                <option value="">—</option>
                {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 130 }}>
              <label style={rotuloStyle}>CEP</label>
              <input value={formatarCep(form.cep)} onChange={(e) => set('cep', e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="00000-000" inputMode="numeric"
                style={inputStyle} onFocus={foco} onBlur={desfoco} />
            </div>
          </div>

          <div>
            <label style={rotuloStyle}>Link do Google Maps</label>
            <input value={form.google_maps_url} onChange={(e) => set('google_maps_url', e.target.value)}
              placeholder="https://maps.app.goo.gl/..." style={inputStyle} onFocus={foco} onBlur={desfoco} />
          </div>

          <div>
            <label style={rotuloStyle}>Instagram</label>
            <input value={form.instagram_url} onChange={(e) => set('instagram_url', e.target.value)}
              placeholder="https://instagram.com/suaempresa" style={inputStyle} onFocus={foco} onBlur={desfoco} />
          </div>

          <div>
            <label style={rotuloStyle}>Site</label>
            <input value={form.site_url} onChange={(e) => set('site_url', e.target.value)}
              placeholder="https://suaempresa.com.br" style={inputStyle} onFocus={foco} onBlur={desfoco} />
          </div>
        </div>

        {erro && (
          <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger-border)', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, color: 'var(--danger)', marginTop: 14 }}>{erro}</div>
        )}

        <div style={{ marginTop: 18 }}>
          <button onClick={salvar} disabled={salvando}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 9, border: 'none', background: salvo ? 'var(--success-solid)' : 'var(--action)', color: salvo ? 'var(--on-solid)' : 'var(--on-action)', cursor: salvando ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, fontFamily: FONTE, transition: 'background 0.2s' }}>
            {salvo ? <Check size={14} /> : <Save size={14} />}
            {salvo ? 'Salvo!' : salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>

    </div>
  )
}
