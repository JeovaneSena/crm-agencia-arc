import { useEffect, useState } from 'react'
import { Trash2, TriangleAlert, Check } from 'lucide-react'
import CampoTelefone from './CampoTelefone'
import ConfirmDeleteModal from './ConfirmDeleteModal'
import { preverExclusao, apagarPessoa, resumoDoEstrago, type Previsao } from '../lib/apagarPessoa'
import { formatarParaExibicao } from '../lib/telefones'

/**
 * "Apagar uma pessoa" — a zona de perigo da página Secretária de IA.
 *
 * Digite o número, o sistema mostra **quem é e o que exatamente será
 * destruído**, e só então libera o botão.
 *
 * ── A CONTAGEM É A PARTE IMPORTANTE ────────────────────────────────────────
 *
 * Botão irreversível que só pergunta "tem certeza?" vira clique automático na
 * terceira vez. Com "68 mensagens · 3 consultas (1 já realizada)" escrito na
 * frente, a pessoa lê antes de clicar — e é o "1 já realizada" que faz alguém
 * parar a tempo.
 *
 * ── POR QUE AQUI, E NÃO EM CONTATOS ────────────────────────────────────────
 *
 * Isto não é manutenção de cadastro: é destruição de histórico clínico. Mora na
 * área de sistema, no menu do usuário, longe de quem passa o dia na Agenda —
 * mesma divisão de navegação do resto do projeto.
 */

const FONTE = "var(--font-body)"

export default function ApagarPessoa() {
  const [numero, setNumero] = useState('')
  const [valido, setValido] = useState(false)
  const [previsao, setPrevisao] = useState<Previsao | null>(null)
  const [procurou, setProcurou] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [apagando, setApagando] = useState(false)
  const [feito, setFeito] = useState('')
  const [erro, setErro] = useState('')

  // Número válido digitado, busca na hora. Toda escrita de estado acontece
  // dentro do `.then` de propósito: escrever durante o efeito é o que o
  // `react-hooks/set-state-in-effect` (com razão) reclama.
  useEffect(() => {
    let vivo = true
    const consulta = valido ? preverExclusao(numero) : Promise.resolve(null)
    consulta
      .then((p) => { if (vivo) { setPrevisao(p); setProcurou(valido) } })
      .catch(() => { if (vivo) { setPrevisao(null); setProcurou(false); setErro('Não foi possível contar os registros. Tente novamente antes de excluir.') } })
    return () => { vivo = false }
  }, [numero, valido])

  async function confirmar() {
    if (!previsao) return
    setApagando(true)
    setErro('')
    try {
      const midias = await apagarPessoa(previsao.pessoa.id)
      const nome = previsao.pessoa.nome?.trim() || formatarParaExibicao(numero)
      setFeito(`${nome} foi apagada. ${resumoDoEstrago(previsao, midias)}.`)
      setConfirmando(false)
      setPrevisao(null)
      setProcurou(false)
      setNumero('')
      setValido(false)
    } catch (e) {
      setErro(e instanceof Error && e.message === 'falha_na_midia'
        ? 'Não consegui apagar os arquivos, então não apaguei nada. Tente de novo.'
        : 'Não consegui apagar. Tente de novo.')
      setConfirmando(false)
    }
    setApagando(false)
  }

  const nome = previsao?.pessoa.nome?.trim() || 'Sem nome'

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--danger-border)', borderRadius: 14,
      padding: '20px 22px', marginBottom: 18, fontFamily: FONTE,
    }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <TriangleAlert size={16} color="var(--danger)" />
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--danger)' }}>Apagar uma pessoa</div>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, fontWeight: 500, margin: '6px 0 6px' }}>
        Apague permanentemente uma pessoa e todo o seu histórico da empresa.
      </p>
      <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 16px' }}>
        Ao continuar, serão apagados os dados da pessoa, conversas, campanhas,
        reuniões e arquivos enviados. Essa ação não pode ser desfeita.
      </p>

      <div style={{ maxWidth: 380 }}>
        <CampoTelefone
          valor={numero}
          onChange={(canonico, ok) => {
            setNumero(canonico); setValido(ok); setFeito(''); setErro('')
          }}
          rotulo="WhatsApp da pessoa"
          obrigatorio={false}
          marcador={false}
        />
      </div>

      {/* ---- Quem é, e o que some com ela ---- */}
      {procurou && previsao && (
        <div style={{
          marginTop: 14, background: 'var(--danger-soft)', border: '1px solid var(--danger-border)',
          borderRadius: 11, padding: '13px 15px',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{nome}</div>
            <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 3 }}>
              {resumoDoEstrago(previsao)}
            </div>
          </div>
          <button
            onClick={() => setConfirmando(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 13px', borderRadius: 9, border: 'none',
              background: 'var(--danger-solid)', color: 'var(--on-solid)',
              fontSize: 12.5, fontWeight: 700, fontFamily: FONTE, cursor: 'pointer',
            }}>
            <Trash2 size={13} /> Apagar tudo
          </button>
        </div>
      )}

      {procurou && !previsao && (
        <div style={{
          marginTop: 14, fontSize: 12.5, color: 'var(--muted)',
          background: 'var(--surface-subtle)', border: '1px solid var(--border)',
          borderRadius: 9, padding: '10px 13px',
        }}>
          Nenhuma pessoa com este número. Nada a apagar.
        </div>
      )}

      {feito && (
        <div style={{
          marginTop: 14, display: 'flex', alignItems: 'flex-start', gap: 8,
          background: 'var(--success-soft)', border: '1px solid var(--success-border)',
          borderRadius: 9, padding: '10px 13px', fontSize: 12.5, color: 'var(--success)',
        }}>
          <Check size={14} style={{ flexShrink: 0, marginTop: 1 }} /> {feito}
        </div>
      )}

      {erro && (
        <div style={{
          marginTop: 14, background: 'var(--danger-soft)', border: '1px solid var(--danger-border)',
          borderRadius: 9, padding: '10px 13px', fontSize: 12.5, color: 'var(--danger)',
        }}>{erro}</div>
      )}

      {confirmando && previsao && (
        <ConfirmDeleteModal
          itemName={nome}
          title="Apagar esta pessoa?"
          message={
            <>
              Tudo de <strong>{nome}</strong> ({formatarParaExibicao(numero)}) será destruído:{' '}
              <strong>{resumoDoEstrago(previsao)}</strong>, além dos arquivos que ela enviou.
              {previsao.realizadas > 0 && (
                <><br /><br />⚠️ Há <strong>reunião já realizada</strong> no histórico dela.
                Isso é registro de atendimento, e some junto.</>
              )}
              <br /><br />Não tem lixeira. Isso não pode ser desfeito.
            </>
          }
          confirmLabel="Apagar tudo"
          loadingLabel="Apagando..."
          loading={apagando}
          error={erro}
          onConfirm={confirmar}
          onClose={() => setConfirmando(false)}
        />
      )}
    </div>
  )
}
