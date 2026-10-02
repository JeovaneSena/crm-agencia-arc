import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trash2, TriangleAlert } from 'lucide-react'
import { useSessao } from '../lib/sessao'
import ConfirmDeleteModal from './ConfirmDeleteModal'
import { apagarPessoa, preverExclusaoDe, resumoDoEstrago, type Previsao } from '../lib/apagarPessoa'
import { formatarParaExibicao } from '../lib/telefones'
import { isCliente } from '../lib/pessoas'
import type { Contato } from '../types'

/**
 * "Apagar esta pessoa" — a zona de perigo da ficha do lead.
 *
 * ── POR QUE EXISTE, SE JÁ HÁ UMA EM SECRETÁRIA DE IA ───────────────────────
 *
 * São dois gestos diferentes. Lá é uma **busca**: digite um número, descubra
 * quem é, apague — serve para o número errado que ninguém abriu. Aqui a pessoa
 * já está aberta na tela, e quem chegou até esta página é quem sabe que ela
 * precisa sair. Mandar essa pessoa copiar o telefone, abrir outra página e
 * colar seria um desvio que só existe porque o botão não estava aqui.
 *
 * A regra dos dois cartões é a mesma, e mora em
 * [`apagarPessoa.ts`](../lib/apagarPessoa.ts): a contagem antes, a Edge
 * Function apagando (mídia primeiro, ficha depois) e nenhuma lixeira.
 *
 * ── E POR QUE NO FIM DA PÁGINA ─────────────────────────────────────────────
 *
 * É a ação mais destrutiva que a ficha oferece. Ação destrutiva não fica no
 * caminho do olho de quem só veio conferir um telefone — a mesma razão do
 * interruptor do assistente ter descido para o fim da página dela.
 */

const FONTE = "var(--font-body)"

export default function ApagarEstaPessoa({ pessoa }: { pessoa: Contato }) {
  // A trava real está na rota `/apagar-pessoa`, que roda com service_role e
  // confere `exigir_gestor` — a policy de delete da 0034 nem a alcança. Isto
  // aqui só evita oferecer um botão que terminaria em 403.
  const { gestor } = useSessao()
  const navigate = useNavigate()
  const [previsao, setPrevisao] = useState<Previsao | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [apagando, setApagando] = useState(false)
  const [erro, setErro] = useState('')

  /* A contagem é buscada na montagem: ela é o texto do botão, não um detalhe
     do modal. Botão irreversível sem número vira clique automático. */
  useEffect(() => {
    let vivo = true
    preverExclusaoDe({
      id: pessoa.id,
      nome: pessoa.nome,
      whatsapp: pessoa.whatsapp,
      status: pessoa.status,
    })
      .then((p) => { if (vivo) setPrevisao(p) })
      .catch(() => { if (vivo) { setPrevisao(null); setErro('Não foi possível contar os registros. Atualize a página antes de excluir.') } })
    return () => { vivo = false }
  }, [pessoa.id, pessoa.nome, pessoa.whatsapp, pessoa.status])

  const nome = pessoa.nome?.trim() || 'Sem nome'

  async function confirmar() {
    setApagando(true)
    setErro('')
    try {
      await apagarPessoa(pessoa.id)
      /* `replace` de propósito: sem ele, o botão "voltar" do navegador traz a
         pessoa de volta para a ficha de alguém que não existe mais. */
      navigate(isCliente(pessoa.status) ? '/clientes' : '/leads', { replace: true })
    } catch (e) {
      setErro(e instanceof Error && e.message === 'falha_na_midia'
        ? 'Não consegui apagar os arquivos, então não apaguei nada. Tente de novo.'
        : 'Não consegui apagar. Tente de novo.')
      setApagando(false)
    }
  }

  // Para consultor a zona de perigo não some: some o gatilho. Esconder a
  // seção inteira deixaria quem precisa apagar alguém sem saber a quem pedir.
  if (!gestor) return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14,
      padding: '16px 22px', marginBottom: 16, fontFamily: FONTE,
      fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6,
    }}>
      Apagar {nome} do sistema — ficha, conversa, reuniões, oportunidades e arquivos — é ação de gestor. Peça a um, se for o caso.
    </div>
  )

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--danger-border)', borderRadius: 14,
      padding: '20px 22px', marginBottom: 16, fontFamily: FONTE,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <TriangleAlert size={16} color="var(--danger)" />
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--danger)' }}>Apagar esta pessoa</div>
      </div>

      <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, margin: '6px 0 16px' }}>
        Apaga <strong style={{ color: 'var(--muted)' }}>tudo</strong> de {nome}: a ficha, as reuniões — inclusive as já
        realizadas — e as oportunidades, mais o que os módulos ligados guardam (conversas, campanhas, projetos e arquivos).
        Não tem lixeira, e não pode ser desfeito.
      </p>

      <div style={{
        background: 'var(--danger-soft)', border: '1px solid var(--danger-border)', borderRadius: 11,
        padding: '13px 15px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{nome}</div>
          <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 3 }}>
            {previsao ? resumoDoEstrago(previsao) : 'Aguardando contagem dos registros. Se não carregar, atualize a página.'}
          </div>
        </div>
        {/* Trancado enquanto a contagem não chega: o número é a parte que faz
            alguém parar a tempo, e sem ele o botão não deveria estar clicável. */}
        <button
          onClick={() => setConfirmando(true)}
          disabled={!previsao}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 13px', borderRadius: 9, border: 'none',
            background: previsao ? 'var(--danger-solid)' : 'var(--danger-border)', color: 'var(--on-solid)',
            fontSize: 12.5, fontWeight: 700, fontFamily: FONTE,
            cursor: previsao ? 'pointer' : 'not-allowed',
          }}>
          <Trash2 size={13} /> Apagar tudo
        </button>
      </div>

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
              Tudo de <strong>{nome}</strong>
              {pessoa.whatsapp && <> ({formatarParaExibicao(pessoa.whatsapp)})</>} será
              destruído: <strong>{resumoDoEstrago(previsao)}</strong>, além dos arquivos que ela enviou.
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
