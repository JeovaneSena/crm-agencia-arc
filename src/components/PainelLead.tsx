import React, { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  X, Phone, CalendarDays, Clock, Stethoscope, FileText,
  ExternalLink, MessageCircleQuestion, CircleUser,
} from 'lucide-react'
import { formatarParaExibicao } from '../lib/telefones'
import { STATUS_CONSULTA, ROTULO_CONSULTA } from '../lib/statusLead'
import { useFunil } from '../lib/funil'
import { carregarLead, carregarConsultas, fotoDoPerfil, type ConsultaComProfissional } from '../lib/conversas'
import { AGENTE_TITULO, useAgente } from '../lib/agente'
import type { Contato } from '../types'
import AvisoBaixaConsulta from './AvisoBaixaConsulta'

/**
 * O painel da direita: quem é a pessoa do outro lado da conversa.
 *
 * ⚠️ **O NOME PODE NÃO EXISTIR, E ISSO É O NORMAL NO COMEÇO.** Ninguém digita
 * esta ficha: ela se preenche sozinha conforme o assistente descobre as coisas na
 * conversa. Enquanto a pessoa não disser como se chama, o que existe é o
 * número — e o painel diz isso com todas as letras, em vez de mostrar um campo
 * vazio que parece defeito.
 *
 * A FOTO VEM DA INTEGRAÇÃO ANTERIOR, NÃO DO BANCO. Não guardamos retrato de cliente. Ela
 * falta na maioria dos casos (privacidade do WhatsApp), e aí fica a inicial.
 */

const FONTE = "var(--font-body)"

const rotulo: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, color: 'var(--muted)',
  textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5,
}

const valor: React.CSSProperties = {
  fontSize: 13, color: 'var(--text)', lineHeight: 1.6,
}

const bloco: React.CSSProperties = {
  padding: '15px 18px', borderBottom: '1px solid var(--border-subtle)',
}

function dataHora(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function dataCurta(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

interface Props {
  leadId: string
  onFechar: () => void
}

export default function PainelLead({ leadId, onFechar }: Props) {
  const funil = useFunil()
  const { nome: nomeAgente } = useAgente()
  const [lead, setLead] = useState<Contato | null>(null)
  const [consultas, setConsultas] = useState<ConsultaComProfissional[]>([])
  const [foto, setFoto] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    // Sem `setCarregando(true)` aqui: a página remonta o painel a cada troca de
    // conversa (pela `key`), então o estado já nasce carregando.
    let vivo = true
    Promise.all([carregarLead(leadId), carregarConsultas(leadId)])
      .then(([l, c]) => {
        if (!vivo) return
        setLead(l)
        setConsultas(c)
        setCarregando(false)
        if (l?.whatsapp) {
          fotoDoPerfil(l.whatsapp).then((u) => { if (vivo) setFoto(u) })
        }
      })
      .catch(() => { if (vivo) setCarregando(false) })

    return () => { vivo = false }
  }, [leadId])

  // Depois de uma baixa a ficha muda inteira: o status vira Cliente, a
  // consulta muda de cor e `data_agendamento` some. Reler é mais barato que
  // remendar cinco pedaços de estado na mão.
  const recarregarFicha = useCallback(() => {
    Promise.all([carregarLead(leadId), carregarConsultas(leadId)])
      .then(([l, c]) => { setLead(l); setConsultas(c) })
      .catch(() => { /* o próprio aviso mostra o erro dele */ })
  }, [leadId])

  const temNome = !!lead?.nome?.trim()
  const titulo = temNome ? lead!.nome!.trim() : formatarParaExibicao(lead?.whatsapp) || 'Sem nome'
  const estilo = lead ? funil.estilo(lead.status) : null

  return (
    <div style={{
      width: '100%', flexShrink: 0, borderLeft: '1px solid var(--border)', background: 'var(--surface)',
      display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto',
    }}>

      {/* Fechar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '13px 18px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0,
      }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>Sobre a pessoa</span>
        <button onClick={onFechar} title="Esconder o painel"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex', padding: 2 }}>
          <X size={16} />
        </button>
      </div>

      {carregando && (
        <div style={{ padding: '26px 18px', fontSize: 12.5, color: 'var(--muted)', textAlign: 'center' }}>
          Carregando…
        </div>
      )}

      {!carregando && lead && (
        <>
          {/* Identidade */}
          <div style={{ ...bloco, textAlign: 'center', paddingTop: 20, paddingBottom: 18 }}>
            {foto ? (
              <img src={foto} alt=""
                onError={() => setFoto(null)}
                style={{
                  width: 68, height: 68, borderRadius: '50%', objectFit: 'cover',
                  margin: '0 auto 11px', display: 'block', border: '1px solid var(--border)',
                }} />
            ) : (
              <div style={{
                width: 68, height: 68, borderRadius: '50%', background: 'var(--accent-soft)', color: 'var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 25, fontWeight: 700, margin: '0 auto 11px',
              }}>
                {temNome ? titulo.charAt(0).toUpperCase() : <CircleUser size={30} />}
              </div>
            )}

            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', wordBreak: 'break-word' }}>
              {titulo}
            </div>

            {!temNome && (
              <div style={{
                marginTop: 8, padding: '8px 10px', background: 'var(--surface-subtle)',
                border: '1px solid var(--border)', borderRadius: 8,
                fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, textAlign: 'left',
                display: 'flex', gap: 7, alignItems: 'flex-start',
              }}>
                <MessageCircleQuestion size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  Ainda sem nome. Ele aparece aqui <strong>quando a pessoa disser
                  como se chama</strong> na conversa — a {nomeAgente} grava sozinha.
                </span>
              </div>
            )}

            {estilo && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 11,
                padding: '4px 12px', borderRadius: 20, fontSize: 11.5, fontWeight: 600,
                background: estilo.bg, color: estilo.color,
              }}>
                {estilo.pulse && (
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', background: estilo.color,
                    display: 'inline-block',
                  }} />
                )}
                {funil.rotulo(lead.status)}
              </span>
            )}
          </div>

          {/* Consulta desta pessoa esperando confirmação. Some sozinho
              quando não há nenhuma. */}
          <div style={{ padding: '0 18px' }}>
            <AvisoBaixaConsulta leadId={leadId} compacto onBaixa={recarregarFicha} />
          </div>

          {/* Contato */}
          <div style={bloco}>
            <div style={rotulo}>Contato</div>
            <div style={{ ...valor, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Phone size={13} color="var(--muted)" />
              {formatarParaExibicao(lead.whatsapp) || '—'}
            </div>
          </div>

          {/* Interesse */}
          <div style={bloco}>
            <div style={rotulo}>Serviço de interesse</div>
            <div style={valor}>
              {lead.interesses_texto?.trim() || (
                <span style={{ color: 'var(--muted)' }}>Ainda não disse o que procura.</span>
              )}
            </div>
          </div>

          {/* O RESUMO DA CONVERSA NÃO ENTRA AQUI, E É DE PROPÓSITO.

              Ele existe para quem precisa entender o caso SEM abrir a conversa
              — e nesta tela a conversa está aberta, do lado esquerdo, inteira.
              Aqui ele era um parágrafo repetindo em pior qualidade o que está
              dois centímetros ao lado, e empurrava a linha do tempo e as
              consultas para fora da tela.

              O lugar dele é a ficha do lead (`LeadDetail.tsx`), que é onde a
              recepção chega sem ter lido nada. */}

          {/* Linha do tempo */}
          <div style={bloco}>
            <div style={rotulo}>Linha do tempo</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <div style={{ ...valor, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                <CalendarDays size={13} color="var(--muted)" />
                Chegou em {dataCurta(lead.created_at)}
              </div>
              <div style={{ ...valor, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                <Clock size={13} color="var(--muted)" />
                Última mensagem: {dataHora(lead.ultima_mensagem)}
              </div>
            </div>
          </div>

          {/* Consultas */}
          <div style={bloco}>
            <div style={{ ...rotulo, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Stethoscope size={11} /> Reuniões ({consultas.length})
            </div>

            {consultas.length === 0 ? (
              <div style={{ ...valor, color: 'var(--muted)' }}>Nenhuma reunião marcada.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 3 }}>
                {consultas.map((c) => {
                  const est = STATUS_CONSULTA[c.status]
                  return (
                    <div key={c.id} style={{
                      border: '1px solid var(--border)', borderRadius: 9, padding: '9px 11px',
                      borderLeft: `3px solid ${c.profissional?.cor ?? 'var(--border)'}`,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', lineHeight: 1.4 }}>
                          {c.assunto}
                        </span>
                        <span style={{
                          fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                          background: est.bg, color: est.color, whiteSpace: 'nowrap', flexShrink: 0,
                        }}>
                          {ROTULO_CONSULTA[c.status]}
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>
                        {dataHora(c.data_reuniao)}
                      </div>
                      {c.profissional && (
                        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                          {c.profissional.nome} {c.profissional.sobrenome}
                        </div>
                      )}
                      {c.origem === 'agente_ia' && (
                        <div style={{ fontSize: 10.5, color: 'var(--accent)', marginTop: 4, fontWeight: 600 }}>
                          marcada pela {AGENTE_TITULO}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Anotações */}
          {lead.anotacoes?.trim() && (
            <div style={bloco}>
              <div style={{ ...rotulo, display: 'flex', alignItems: 'center', gap: 5 }}>
                <FileText size={11} /> Anotações da equipe
              </div>
              <div style={{ ...valor, whiteSpace: 'pre-wrap' }}>{lead.anotacoes}</div>
            </div>
          )}

          {/* Ficha completa */}
          <div style={{ padding: '15px 18px' }}>
            <Link to={`/leads/${lead.id}`}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '9px 14px', borderRadius: 9, border: '1px solid var(--border)',
                background: 'var(--surface)', fontSize: 12.5, fontWeight: 600, color: 'var(--accent)',
                textDecoration: 'none', fontFamily: FONTE,
              }}>
              Abrir a ficha completa <ExternalLink size={12} />
            </Link>
            <div style={{ fontSize: 10.5, color: 'var(--muted)', textAlign: 'center', marginTop: 8, lineHeight: 1.5 }}>
              É lá que se edita o status, as anotações e as reuniões.
            </div>
          </div>
        </>
      )}
    </div>
  )
}
