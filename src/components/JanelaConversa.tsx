import { supabase } from '../lib/supabase'
import CompositorMensagem from './CompositorMensagem'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  UserCheck, Undo2, Bot, ExternalLink, MessagesSquare, FileText,
  PanelRightOpen, PanelRightClose, ArrowLeft, LifeBuoy, CheckCheck, Power,
} from 'lucide-react'
import { formatarParaExibicao } from '../lib/telefones'
import { espera, type Encaminhamento } from '../lib/encaminhamento'
import { urlDaMidia, hora, diaPorExtenso, nomeDoAutor } from '../lib/conversas'
import { useAgente } from '../lib/agente'
import { moduloAtivo } from '../lib/modulos'
import type { ConversaResumo, MensagemWhatsapp } from '../types'

const FONTE = 'var(--font-body)'
const ICONE_AUTOR = { cliente: null, agente: Bot, atendente: UserCheck }

/* ──────────────────────────────────────────────
   A mídia — o bucket é privado, então tudo aqui
   passa por URL assinada, buscada na montagem.
────────────────────────────────────────────── */
function Midia({ mensagem }: { mensagem: MensagemWhatsapp }) {
  const [url, setUrl] = useState<string | null>(null)
  const [falhou, setFalhou] = useState(false)

  useEffect(() => {
    let vivo = true
    if (!mensagem.midia_url) return
    urlDaMidia(mensagem.midia_url)
      .then((u) => { if (vivo) { setUrl(u); setFalhou(!u) } })
      .catch(() => { if (vivo) setFalhou(true) })
    return () => { vivo = false }
  }, [mensagem.midia_url])

  if (falhou) {
    return <div style={{ fontSize: 11.5, opacity: 0.75 }}>Não consegui abrir o arquivo.</div>
  }
  if (!url) {
    return <div style={{ fontSize: 11.5, opacity: 0.75 }}>Carregando…</div>
  }

  if (mensagem.tipo === 'imagem') {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        <img src={url} alt="Foto enviada pelo cliente"
          style={{ maxWidth: 260, maxHeight: 300, borderRadius: 9, display: 'block' }} />
      </a>
    )
  }

  if (mensagem.tipo === 'audio') {
    return <audio controls src={url} style={{ maxWidth: 260, display: 'block' }} />
  }

  return (
    <a href={url} target="_blank" rel="noreferrer"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'inherit' }}>
      <FileText size={14} /> Abrir arquivo
    </a>
  )
}

/* ──────────────────────────────────────────────
   Um balão
────────────────────────────────────────────── */
function Balao({ mensagem, mostrarAutor }: { mensagem: MensagemWhatsapp; mostrarAutor: boolean }) {
  const doCliente = mensagem.autor === 'cliente'
  const temMidia = !!mensagem.midia_url && mensagem.tipo !== 'texto'
  const Icone = ICONE_AUTOR[mensagem.autor]

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: doCliente ? 'flex-start' : 'flex-end', marginBottom: 8,
    }}>
      {mostrarAutor && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          fontSize: 12, fontWeight: 600, color: 'var(--muted)', margin: '4px 4px 3px',
        }}>
          {Icone && <Icone size={10} />}
          {nomeDoAutor(mensagem.autor)}
        </div>
      )}

      <div className={`message-bubble message-${mensagem.autor}`}>
        {mensagem.origem_envio === 'campanha' && (
          mensagem.campanha_id
            ? <Link className="message-campaign-origin" to={`/campanhas/${encodeURIComponent(mensagem.campanha_id)}`}>Campanha · {mensagem.campanha_nome || 'Campanha'}</Link>
            : <span className="message-campaign-origin">Campanha · {mensagem.campanha_nome || 'Campanha'}</span>
        )}
        {temMidia && (
          <div style={{ marginBottom: mensagem.conteudo ? 7 : 2 }}>
            <Midia mensagem={mensagem} />
          </div>
        )}

        {mensagem.erro_envio && <p role="status" style={{color:'var(--danger)',fontSize:12}}>{mensagem.erro_envio}</p>}
        {mensagem.conteudo && (
          <div style={{ whiteSpace: 'pre-wrap' }}>
            {mensagem.tipo === 'audio' && (
              <span style={{ fontSize: 10.5, opacity: 0.7, display: 'block', marginBottom: 2 }}>
                transcrição
              </span>
            )}
            {mensagem.conteudo}
          </div>
        )}

        <div style={{
          // No balão cheio o texto é branco, e 0.6 já some no azul.
          fontSize: 11, color: 'var(--muted)', marginTop: 4,
          textAlign: doCliente ? 'left' : 'right',
        }}>
          {hora(mensagem.criada_em)}
          {mensagem.provedor === 'meta' && mensagem.estado_envio && <span title={mensagem.erro_envio ?? undefined} style={{marginLeft:6,color:mensagem.estado_envio==='falhou' || mensagem.estado_envio==='incerto' ? 'var(--danger)':undefined}}>{({pendente:'Pendente',enviado:'Enviado',entregue:'Entregue',lido:'Lido',falhou:'Falhou',incerto:'Sem confirmação'})[mensagem.estado_envio]}</span>}
        </div>
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────
   A janela
────────────────────────────────────────────── */
interface Props {
  conversa: ConversaResumo | null
  /** O encaminhamento do assistente para a equipe, quando existe (migração 0009). */
  atendimento: Encaminhamento | null
  mensagens: MensagemWhatsapp[]
  carregando: boolean
  enviando: boolean
  erro: string
  onEnviar: (texto: string) => void
  onAtualizar: () => void
  onAssumir: () => void
  onDevolver: () => void
  onAlternarIA: (ligada: boolean) => void
  painelAberto: boolean
  onAlternarPainel: () => void
  onVoltar: () => void
}

export default function JanelaConversa({
  conversa, atendimento, mensagens, carregando, enviando, erro, onEnviar, onAssumir, onDevolver, onAlternarIA,
  painelAberto, onAlternarPainel, onVoltar,
}: Props) {
  const { nome: nomeAgente, porExtenso: agentePorExtenso } = useAgente()
  // Assumir/devolver só faz sentido com o assistente respondendo; sem ele, a equipe escreve direto.
  const comAssistente = moduloAtivo('assistente')
  const [texto, setTexto] = useState('')
  const [provedor,setProvedor] = useState<string | null>(null)
  useEffect(()=>{
    let vivo=true
    const carregar=()=>{void supabase.from('conversas_config').select('provedor').limit(1).then(({data,error})=>{if(vivo)setProvedor(error ? null:data?.[0]?.provedor ?? null)})}
    carregar()
    const canal=supabase.channel('conversa-provedor').on('postgres_changes',{event:'UPDATE',schema:'public',table:'conversas_config'},carregar).subscribe()
    return()=>{vivo=false;void supabase.removeChannel(canal)}
  },[])
  const fim = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' })
  }, [mensagens, conversa?.contato_id])

  if (!conversa) {
    return (
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 10, padding: 32, textAlign: 'center', height: '100%',
      }}>
        <button className="conversation-back" onClick={onVoltar}><ArrowLeft size={18} /> Voltar à lista</button>
        <MessagesSquare size={30} color="var(--border-strong)" />
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
          Escolha uma conversa
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', maxWidth: 320, lineHeight: 1.6 }}>
          {comAssistente
            ? `Aqui você lê o que a ${agentePorExtenso} respondeu e, quando precisar, assume a conversa para falar você mesmo.`
            : 'Aqui você lê e responde as conversas do WhatsApp.'}
        </div>
      </div>
    )
  }

  const nome = conversa.nome?.trim() || formatarParaExibicao(conversa.whatsapp) || 'Sem nome'
  const assumida = conversa.assumida
  const livre = assumida || !comAssistente

  function enviar() {
    const limpo = texto.trim()
    if (!limpo || enviando) return
    onEnviar(limpo)
    setTexto('')
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%' }}>

      {/* Cabeçalho */}
      <div className="conversation-header">
        <button className="conversation-back" aria-label="Voltar à lista de conversas" onClick={onVoltar}><ArrowLeft size={18} /></button>
        <div style={{
          width: 38, height: 38, borderRadius: '50%', background: 'var(--accent-soft)', color: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700, flexShrink: 0,
        }}>
          {nome.charAt(0).toUpperCase()}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: 14, fontWeight: 700, color: 'var(--text)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {nome}
            </span>
            <Link to={`/leads/${conversa.contato_id}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11,
                color: 'var(--accent)', textDecoration: 'none', fontWeight: 600, flexShrink: 0,
              }}>
              ficha <ExternalLink size={10} />
            </Link>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            {formatarParaExibicao(conversa.whatsapp)}
          </div>
        </div>

        {comAssistente && (assumida ? (
          <button className="conversation-takeover" onClick={onDevolver}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px',
              borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)',
              cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--text)',
              fontFamily: FONTE, flexShrink: 0,
            }}>
            {atendimento
              ? <><CheckCheck size={13} /> Concluir atendimento</>
              : <><Undo2 size={13} /> Devolver para a {nomeAgente}</>}
          </button>
        ) : (
          <button className="conversation-takeover" onClick={onAssumir}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px',
              borderRadius: 9, border: 'none', background: 'var(--action)', color: 'var(--on-action)',
              cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
              fontFamily: FONTE, flexShrink: 0,
            }}>
            <UserCheck size={13} /> Assumir conversa
          </button>
        ))}

        <button onClick={onAlternarPainel} aria-label="Dados do contato" aria-expanded={painelAberto}
          title={painelAberto ? 'Esconder os dados da pessoa' : 'Ver os dados da pessoa'}
          style={{
            display: 'flex', alignItems: 'center', padding: 8, borderRadius: 9,
            border: '1px solid var(--border)', background: painelAberto ? 'var(--accent-soft)' : 'var(--surface)',
            cursor: 'pointer', color: painelAberto ? 'var(--accent)' : 'var(--muted)', flexShrink: 0,
          }}>
          {painelAberto ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
        </button>
      </div>

      {/* Quem está atendendo */}
      {comAssistente && <div style={{
        display: 'flex', alignItems: 'center', gap: 7, padding: '7px 20px',
        background: assumida ? 'var(--warning-soft)' : 'var(--surface-subtle)',
        borderBottom: `1px solid ${assumida ? 'var(--warning-border)' : 'var(--border-subtle)'}`,
        fontSize: 11.5, color: assumida ? 'var(--warning)' : 'var(--muted)', flexShrink: 0,
      }}>
        {assumida ? <UserCheck size={12} /> : <Bot size={12} />}
        {assumida
          ? <span>
              <strong>Você está atendendo.</strong> A {nomeAgente} não responde nesta
              conversa{conversa.assumido_por_nome ? ` — assumida por ${conversa.assumido_por_nome}` : ''}.
            </span>
          : conversa.ia_ligada
            ? <span><strong>A {agentePorExtenso} está atendendo.</strong> Assuma a conversa para responder você mesmo.</span>
            : <span><strong>O assistente está desligado nesta conversa.</strong> Ninguém responde automaticamente.</span>}
        {!assumida && <button onClick={() => onAlternarIA(!conversa.ia_ligada)} style={{
          marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px',
          borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer',
          fontSize: 11, fontWeight: 600, color: 'var(--text)', fontFamily: FONTE,
        }}><Power size={11} /> {conversa.ia_ligada ? 'Desligar nesta conversa' : 'Ligar nesta conversa'}</button>}
      </div>}

      {/* O encaminhamento. Fica acima do histórico porque é o que explica por
          que esta conversa parou — e o que a equipe precisa responder. */}
      {atendimento && <div style={{
        padding: '10px 20px', background: 'var(--surface-subtle)',
        borderBottom: '1px solid var(--border-subtle)', fontSize: 12, color: 'var(--text)',
        lineHeight: 1.6, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700, marginBottom: 3 }}>
          <LifeBuoy size={13} color="var(--accent)" />
          Pediu a equipe
          <span style={{ fontWeight: 500, color: 'var(--muted)' }}>esperando há {espera(atendimento.desde)}</span>
        </div>
        <div>{atendimento.resumo}</div>
      </div>}

      {/* Mensagens */}
      <div className="conversation-messages" role="log" aria-label="Histórico da conversa" aria-live="polite" style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', background: 'var(--page)' }}>
        {carregando && mensagens.length === 0 && (
          <div style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--muted)', padding: 20 }}>
            Carregando a conversa…
          </div>
        )}

        {mensagens.map((m, i) => {
          const anterior = mensagens[i - 1]
          const dia = diaPorExtenso(m.criada_em)
          const novoDia = !anterior || diaPorExtenso(anterior.criada_em) !== dia

          return (
            <div key={m.id}>
              {novoDia && (
                <div style={{ textAlign: 'center', margin: '14px 0 12px' }}>
                  <span style={{
                    background: 'var(--border)', color: 'var(--text)', fontSize: 10.5, fontWeight: 600,
                    padding: '3px 11px', borderRadius: 20,
                  }}>
                    {dia}
                  </span>
                </div>
              )}
              <Balao mensagem={m} mostrarAutor={!anterior || anterior.autor !== m.autor} />
            </div>
          )
        })}
        <div ref={fim} />
      </div>

      {/* Caixa de resposta */}
      <div className="conversation-composer" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)', padding: '12px 20px', flexShrink: 0 }}>
        {erro && (
          <div style={{
            marginBottom: 9, padding: '8px 12px', background: 'var(--danger-soft)',
            border: '1px solid var(--danger-border)', borderRadius: 8, fontSize: 12, color: 'var(--danger)',
          }}>
            {erro}
          </div>
        )}

        {livre && provedor === 'meta' ? null : livre && provedor === 'uazapi' ? (
          <CompositorMensagem
            texto={texto}
            onTexto={setTexto}
            onEnviar={enviar}
            enviando={enviando}
            ariaLabel="Resposta ao contato"
          />
        ) : (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 14, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55 }}>
              Para escrever para esta pessoa, <strong>assuma a conversa</strong> — assim
              a {nomeAgente} para de responder e vocês dois não falam ao mesmo tempo.
            </span>
            <button className="conversation-takeover" onClick={onAssumir}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px',
                borderRadius: 10, border: 'none', background: 'var(--action)', color: 'var(--on-action)',
                cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: FONTE,
              }}>
              <UserCheck size={14} /> Assumir conversa
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
