import { useState } from 'react'
import { Search, UserCheck, MessageSquareDashed, CalendarCheck, CalendarX, LifeBuoy } from 'lucide-react'
import { formatarParaExibicao } from '../lib/telefones'
import { previaDaMensagem, quandoCurto, temConsultaMarcada, quandoAgendada } from '../lib/conversas'
import { AGENTE_TITULO, useAgente } from '../lib/agente'
import { espera, type Encaminhamento } from '../lib/encaminhamento'
import type { ConversaResumo } from '../types'
import { moduloAtivo } from '../lib/modulos'

/**
 * A coluna da esquerda: quem falou com a empresa, em ordem de quem falou por
 * último.
 *
 * A lista vem pronta da view `conversas_lista` (migrações 0013 e 0014) —
 * última mensagem, não lidas, quem assumiu e a consulta marcada já resolvidos
 * no banco. Aqui só se desenha e se filtra.
 */

const FONTE = "var(--font-body)"

/**
 * Os filtros da lista. São três, e não um por status do funil, porque a
 * pergunta de quem está na tela Conversas não é "em que etapa este lead está?"
 * — isso é o CRM. Aqui a pergunta é **"de quem eu preciso cuidar agora?"**:
 * quem esperou resposta (não lidas) e quem já converteu (agendadas).
 */
type Filtro = 'todas' | 'equipe' | 'agendadas' | 'nao_lidas'

const ROTULO_FILTRO: Record<Filtro, string> = {
  todas: 'Todas',
  equipe: 'Equipe',
  agendadas: 'Agendadas',
  nao_lidas: 'Não lidas',
}

interface Props {
  conversas: ConversaResumo[]
  /** Quem o assistente passou para a equipe, por contato (migração 0009). */
  encaminhadas: Map<string, Encaminhamento>
  selecionada: string | null
  onSelecionar: (leadId: string) => void
  carregando: boolean
}

export default function ListaConversas({ conversas, encaminhadas, selecionada, onSelecionar, carregando }: Props) {
  const { nome: nomeAgente, porExtenso: agentePorExtenso } = useAgente()
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todas')

  const passaNoFiltro = (c: ConversaResumo) =>
    filtro === 'todas' ? true
      : filtro === 'equipe' ? encaminhadas.has(c.contato_id)
      : filtro === 'agendadas' ? temConsultaMarcada(c)
      : c.nao_lidas > 0

  const termo = busca.trim().toLowerCase()
  const passaNaBusca = (c: ConversaResumo) =>
    !termo ||
    (c.nome ?? '').toLowerCase().includes(termo) ||
    (!!termo.replace(/\D/g, '') && (c.whatsapp ?? '').includes(termo.replace(/\D/g, ''))) ||
    (c.ultimo_conteudo ?? '').toLowerCase().includes(termo)

  const filtradas = conversas.filter((c) => passaNoFiltro(c) && passaNaBusca(c))

  // Os números das abas contam a lista INTEIRA, não o resultado da busca: eles
  // dizem quanto existe, e um contador que muda ao digitar não serve para isso.
  const totais: Record<Filtro, number> = {
    todas: conversas.length,
    equipe: conversas.filter((c) => encaminhadas.has(c.contato_id)).length,
    agendadas: conversas.filter(temConsultaMarcada).length,
    nao_lidas: conversas.filter((c) => c.nao_lidas > 0).length,
  }

  const vazioTexto = termo
    ? 'Tente outro nome ou número.'
    : filtro === 'equipe'
      ? `Nenhuma conversa esperando a equipe. Quando a ${nomeAgente} encaminhar alguma, ela aparece aqui no topo.`
    : filtro === 'agendadas'
      ? `Ninguém com reunião marcada por aqui ainda. Quando a ${nomeAgente} marcar, a etiqueta verde aparece na conversa.`
      : filtro === 'nao_lidas'
        ? 'Nada esperando resposta. Tudo lido.'
        : 'Assim que alguém mandar mensagem no WhatsApp da empresa, a conversa aparece aqui.'

  return (
    <div className="conversation-list">

      {/* Cabeçalho, busca e filtros */}
      <div style={{ padding: '18px 18px 12px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', margin: '0 0 3px' }}>
          Conversas
        </h1>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 13px' }}>
          {moduloAtivo('assistente') ? `O WhatsApp da empresa, com o que a ${agentePorExtenso} respondeu.` : 'O WhatsApp da empresa.'}
        </p>

        <div style={{ position: 'relative' }}>
          <Search size={14} color="var(--muted)"
            style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            aria-label="Buscar conversas"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, número ou mensagem"
            style={{
              width: '100%', padding: '8px 12px 8px 32px', borderRadius: 9,
              border: '1px solid var(--border)', fontSize: 12.5, fontFamily: FONTE,
              color: 'var(--text)', outline: 'none', boxSizing: 'border-box', background: 'var(--surface-subtle)',
            }}
            onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')}
            onBlur={(e) => (e.target.style.borderColor = 'var(--border)')}
          />
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          {(Object.keys(ROTULO_FILTRO) as Filtro[]).filter((f) => f !== 'equipe' || moduloAtivo('assistente')).map((f) => {
            const ativo = filtro === f
            return (
              <button
                key={f}
                aria-pressed={ativo}
                onClick={() => setFiltro(f)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  minHeight: 36, padding: '6px 9px', borderRadius: 20, cursor: 'pointer',
                  fontSize: 11.5, fontWeight: 600, fontFamily: FONTE,
                  border: `1px solid ${ativo ? 'var(--accent)' : 'var(--border)'}`,
                  background: ativo ? 'var(--action)' : 'var(--surface)',
                  color: ativo ? 'var(--on-action)' : 'var(--muted)',
                  transition: 'background 0.15s, border-color 0.15s',
                }}
                onMouseEnter={(e) => { if (!ativo) e.currentTarget.style.background = 'var(--surface-subtle)' }}
                onMouseLeave={(e) => { if (!ativo) e.currentTarget.style.background = 'var(--surface)' }}
              >
                {ROTULO_FILTRO[f]}
                <span style={{
                  fontSize: 10.5, fontWeight: 700,
                  color: ativo ? 'var(--on-action)' : 'var(--muted)',
                }}>
                  {totais[f]}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* A lista */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {carregando && conversas.length === 0 && (
          <div style={{ padding: '28px 20px', textAlign: 'center', fontSize: 12.5, color: 'var(--muted)' }}>
            Carregando…
          </div>
        )}

        {!carregando && filtradas.length === 0 && (
          <div style={{ padding: '40px 26px', textAlign: 'center' }}>
            <MessageSquareDashed size={26} color="var(--border-strong)" style={{ marginBottom: 10 }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
              {termo ? 'Nada encontrado' : filtro === 'todas' ? 'Nenhuma conversa ainda' : 'Nada por aqui'}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.55 }}>
              {vazioTexto}
            </div>
          </div>
        )}

        {filtradas.map((c) => {
          const ativa = c.contato_id === selecionada
          const nome = c.nome?.trim() || formatarParaExibicao(c.whatsapp) || 'Sem nome'
          const naoLidas = ativa ? 0 : c.nao_lidas
          const agendada = temConsultaMarcada(c)
          // Só é "cancelada" quando NÃO sobrou consulta ativa — o trigger
          // mantém o lead em agendada enquanto restar alguma sessão do
          // tratamento. Por isso as duas etiquetas nunca aparecem juntas.
          const cancelada = !agendada && c.status === 'perdido'
          const chamado = encaminhadas.get(c.contato_id)

          return (
            <button
              key={c.contato_id}
              aria-pressed={ativa}
              aria-label={`${nome}${naoLidas ? `, ${naoLidas} mensagens não lidas` : ''}`}
              onClick={() => onSelecionar(c.contato_id)}
              style={{
                width: '100%', display: 'flex', gap: 11, alignItems: 'flex-start',
                padding: '12px 16px', border: 'none', borderBottom: '1px solid var(--border-subtle)',
                background: ativa ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer',
                textAlign: 'left', fontFamily: FONTE,
                borderLeft: ativa ? '3px solid var(--accent)' : '3px solid transparent',
              }}
              onMouseEnter={(e) => { if (!ativa) e.currentTarget.style.background = 'var(--surface-subtle)' }}
              onMouseLeave={(e) => { if (!ativa) e.currentTarget.style.background = 'transparent' }}
            >
              {/* Inicial */}
              <div style={{
                width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                background: ativa ? 'var(--action)' : 'var(--accent-soft)',
                color: ativa ? 'var(--on-action)' : 'var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 700,
              }}>
                {nome.charAt(0).toUpperCase()}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{
                    fontSize: 13, fontWeight: naoLidas > 0 ? 800 : 700, color: 'var(--text)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                  }}>
                    {nome}
                  </span>
                  <span style={{ fontSize: 10.5, color: 'var(--muted)', flexShrink: 0 }}>
                    {quandoCurto(c.ultima_em)}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 3 }}>
                  <span style={{
                    fontSize: 11.5, color: naoLidas > 0 ? 'var(--text)' : 'var(--muted)',
                    fontWeight: naoLidas > 0 ? 600 : 400,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                  }}>
                    {c.ultimo_autor !== 'cliente' && (
                      <span style={{ color: 'var(--muted)' }}>
                        {c.ultimo_autor === 'agente' ? `${AGENTE_TITULO}: ` : 'Você: '}
                      </span>
                    )}
                    {previaDaMensagem(c.ultimo_tipo, c.ultimo_conteudo)}
                  </span>

                  {naoLidas > 0 && (
                    <span style={{
                      background: 'var(--action)', color: 'var(--on-action)', fontSize: 10, fontWeight: 700,
                      minWidth: 18, height: 18, borderRadius: 9, padding: '0 5px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      {naoLidas > 99 ? '99+' : naoLidas}
                    </span>
                  )}
                </div>

                {/* As etiquetas. Numa linha só, que quebra se precisar. */}
                {(agendada || cancelada || c.assumida || chamado) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>

                    {/* O chamado vem primeiro: é o que muda o que fazer agora.
                        Aguardando é vermelho porque ninguém pegou ainda. */}
                    {chamado && (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        background: 'var(--danger-soft)',
                        border: '1px solid var(--danger-border)',
                        borderRadius: 6, padding: '2px 6px', fontSize: 10, fontWeight: 700,
                        color: 'var(--danger)',
                      }}>
                        <LifeBuoy size={10} />
                        Pediu a equipe · {espera(chamado.desde)}
                      </span>
                    )}

                    {agendada && (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        background: 'var(--success-soft)', border: '1px solid var(--success-border)', borderRadius: 6,
                        padding: '2px 6px', fontSize: 10, fontWeight: 700, color: 'var(--success)',
                      }}>
                        <CalendarCheck size={10} />
                        Agendada · {quandoAgendada(c.proxima_reuniao!)}
                      </span>
                    )}

                    {cancelada && (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        background: 'var(--danger-soft)', border: '1px solid var(--danger-border)', borderRadius: 6,
                        padding: '2px 6px', fontSize: 10, fontWeight: 700, color: 'var(--danger)',
                      }}>
                        <CalendarX size={10} />
                        Oportunidade perdida
                      </span>
                    )}

                    {c.assumida && (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        background: 'var(--warning-soft)', border: '1px solid var(--warning-border)', borderRadius: 6,
                        padding: '2px 6px', fontSize: 10, fontWeight: 600, color: 'var(--warning)',
                      }}>
                        <UserCheck size={10} />
                        {c.assumido_por_nome ? `Com ${c.assumido_por_nome.split(' ')[0]}` : 'Assumida'}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
