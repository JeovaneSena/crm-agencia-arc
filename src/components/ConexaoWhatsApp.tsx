import React, { useEffect, useRef, useState } from 'react'
import { Smartphone, RefreshCw, LogOut, ServerCrash, Check, Unplug } from 'lucide-react'
import CampoTelefone from './CampoTelefone'
import ConfirmDeleteModal from './ConfirmDeleteModal'
import {
  conectar, desconectar, nomeDoProvedor, cadenciaEmPalavras, type Conexao,
} from '../lib/whatsappConexao'
import { formatarParaExibicao } from '../lib/telefones'
import { useAgente } from '../lib/agente'

/**
 * A seção "Conexão do WhatsApp", na página Secretária de IA.
 *
 * **Seção, e não aba.** A página é uma pilha de cards — Modo teste, Modelo de
 * IA, prompt — e tudo ali é sobre um assunto só: a secretária. Aba serve para
 * separar temas diferentes, que é o caso de Configurações (Perfil, Empresa,
 * Horários). Aqui, aba esconderia justamente o que não pode ficar escondido.
 *
 * **O nome do fornecedor é dado, não é título.** A seção se chama "Conexão do
 * WhatsApp" porque é isso que ela é para quem usa, e o rótulo continua certo no
 * dia em que o fornecedor mudar. Mas o provedor aparece dentro dela, e precisa
 * aparecer: quando cai, é ele que diz em qual painel ir olhar.
 */

const FONTE = "var(--font-body)"
const MONO = "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace"

/** Cada estado com sua cor, sua frase e — o que mais importa — sua saída. */
const VISUAL: Record<string, { cor: string; fundo: string; borda: string; rotulo: string }> = {
  verificando: { cor: 'var(--muted)', fundo: 'var(--page)', borda: 'var(--border)', rotulo: 'Verificando...' },
  conectado: { cor: 'var(--success)', fundo: 'var(--success-soft)', borda: 'var(--success-border)', rotulo: 'Conectado' },
  conectando: { cor: 'var(--warning)', fundo: 'var(--warning-soft)', borda: 'var(--warning-border)', rotulo: 'Conectando...' },
  desconectado: { cor: 'var(--danger)', fundo: 'var(--danger-soft)', borda: 'var(--danger-border)', rotulo: 'Desconectado' },
  indisponivel: { cor: 'var(--danger)', fundo: 'var(--danger-soft)', borda: 'var(--danger-border)', rotulo: 'Servidor fora do ar' },
  nao_configurado: { cor: 'var(--warning)', fundo: 'var(--warning-soft)', borda: 'var(--warning-border)', rotulo: 'Sem chave configurada' },
}

/**
 * As duas pontes, as duas selecionáveis.
 *
 * Houve um `pronto: false` aqui, que deixava a uazapi visível e desabilitada
 * enquanto ela não existia — some da lista seria esconder para onde o sistema
 * ia; selecionável seria prometer o que não existia. As duas foram
 * implementadas, e a flag saiu junto: bandeira que só tem um valor possível é
 * a próxima a ser esquecida ligada.
 *
 * ⚠️ Acrescentar um provedor aqui é acrescentar em TRÊS lugares: o `CHECK` de
 * `provedor_whatsapp` no banco, o `PONTES` de `_shared/pontes.ts`, e esta
 * lista. Nada sincroniza os três.
 */
const PROVEDORES = ['meta', 'uazapi']

const botaoBase: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, borderRadius: 9,
  fontSize: 12.5, fontWeight: 700, fontFamily: FONTE, padding: '8px 13px',
}

interface Props {
  conexao: Conexao | null
  /** Resolve quando a consulta terminou — inclusive se pegou carona numa em voo. */
  recarregar: () => Promise<void>
  /** Há consulta acontecendo agora. Gira o ícone e tranca o botão. */
  verificando: boolean
  /** Quando foi a última — de sucesso ou não. Nulo antes da primeira. */
  verificadoEm: Date | null
  /** De quanto em quanto tempo a tela pergunta sozinha. Vira frase, não fica solto. */
  intervaloMs: number
  provedor: string
  /** Troca o provedor ativo. Grava na hora — não passa por "Salvar". */
  onTrocarProvedor: (novo: string) => Promise<void>
}

export default function ConexaoWhatsApp({
  conexao, recarregar, verificando, verificadoEm, intervaloMs,
  provedor, onTrocarProvedor,
}: Props) {
  const { nome: nomeAgente } = useAgente()
  const [numero, setNumero] = useState('')
  const [valido, setValido] = useState(false)
  const [pareando, setPareando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [codigo, setCodigo] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [erro, setErro] = useState('')

  // O "deu certo" de sempre da base: estado curto, limpo por setTimeout.
  const [conferido, setConferido] = useState(false)
  const relogio = useRef<number | null>(null)
  useEffect(() => () => { if (relogio.current) clearTimeout(relogio.current) }, [])

  const estado = conexao?.estado ?? 'verificando'
  const v = VISUAL[estado] ?? VISUAL.verificando
  const foraDoAr = estado === 'indisponivel'
  const cadencia = cadenciaEmPalavras(intervaloMs)

  /**
   * O clique no "Verificar".
   *
   * O botão sempre funcionou; o que faltava era **dizer isso**. Como o estado
   * quase nunca muda entre uma consulta e a seguinte, a tela ficava idêntica —
   * e tela idêntica é indistinguível de botão morto. Daí o "Verificado agora"
   * por dois segundos e meio: é a única prova que a pessoa tem.
   */
  async function verificarAgora() {
    setErro('')
    await recarregar()
    setConferido(true)
    if (relogio.current) clearTimeout(relogio.current)
    relogio.current = window.setTimeout(() => { setConferido(false) }, 2500)
  }

  async function gerarPareamento() {
    setOcupado(true)
    setErro('')
    setCodigo(null)
    setQr(null)
    try {
      const r = await conectar(valido ? numero : undefined)
      setCodigo(r.codigo)
      setQr(r.qr)
      if (!r.codigo && !r.qr) setErro('A ponte respondeu, mas não devolveu código nem QR.')
    } catch {
      setErro('Não consegui abrir o pareamento. O servidor pode estar fora do ar.')
    }
    setOcupado(false)
    recarregar()
  }

  async function confirmarDesconexao() {
    setOcupado(true)
    setErro('')
    try {
      await desconectar()
      setConfirmando(false)
      setPareando(false)
      setCodigo(null)
      setQr(null)
    } catch {
      setErro('Não consegui desconectar.')
      setConfirmando(false)
    }
    setOcupado(false)
    recarregar()
  }

  /** A frase embaixo do estado. Cada uma aponta para uma saída diferente. */
  function explicacao(): string {
    if (provedor === 'meta') {
      if (estado === 'nao_configurado') return 'Configure a conta Meta e as credenciais no servidor para habilitar este número.'
      if (estado === 'conectado') return 'Número registrado na Meta. Confira também o recebimento do webhook antes de ativar a IA.'
      if (estado === 'desconectado') return 'Confira o registro e a situação do número no WhatsApp Manager.'
      if (estado === 'indisponivel') return 'Não foi possível consultar a Meta. Confira token, permissões e disponibilidade da API.'
    }
    if (estado === 'conectado' && conexao) {
      // Só o perfil: o número mora na ficha acima, onde fica visível mesmo
      // quando a sessão cai. Repetir a mesma linha a oitenta pixels de
      // distância é ruído, não reforço.
      return conexao.perfil || 'Sessão ativa'
    }
    if (foraDoAr) {
      return `O servidor da ${nomeDoProvedor(provedor)} não respondeu. Botão daqui não resolve — quem precisa subir é ele.`
    }
    if (estado === 'desconectado') {
      return 'A ponte está de pé, mas a sessão do WhatsApp caiu. Dá para religar aqui mesmo.'
    }
    if (estado === 'nao_configurado') {
      // Não é o servidor que caiu: é chave que falta. Mandar procurar defeito
      // numa máquina quando o que faltou foi preencher um campo é o tipo de
      // conselho errado que custa uma tarde.
      return `A ${nomeDoProvedor(provedor)} está selecionada, mas as chaves dela não `
        + `foram configuradas no servidor. Nada entra nem sai enquanto isso.`
    }
    return 'Consultando o servidor...'
  }

  /** A linha do rodapé: quando foi a última vez, e de quanto em quanto tempo. */
  function fraseDaVerificacao(): string {
    if (conferido) return 'Verificado agora.'
    if (verificando && !verificadoEm) return 'Verificando...'
    if (!verificadoEm) return `Verificado automaticamente ${cadencia}.`
    const hora = verificadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    return `Verificado às ${hora} · automaticamente ${cadencia}.`
  }

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14,
      padding: '20px 22px', marginBottom: 18, fontFamily: FONTE,
    }}>

      {/* O ícone gira enquanto a consulta acontece. Bloco local, como as media
          queries do resto da base: o `index.css` guarda o que é da aplicação
          inteira, e girar um botão não é. */}
      <style>{`
        @keyframes girarIcone { to { transform: rotate(360deg) } }
        .girando { animation: girarIcone 0.9s linear infinite }
        @media (prefers-reduced-motion: reduce) { .girando { animation: none } }
      `}</style>

      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Conexão do WhatsApp</div>
      <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, margin: '4px 0 16px' }}>
        A ponte entre o WhatsApp da empresa e o sistema. Sem ela, nada chega na {nomeAgente} —
        nem para ela responder, nem para a equipe ver.
      </p>

      {/* ---------------- Provedor ---------------- */}
      <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
        Provedor
      </label>
      <select
        value={provedor}
        onChange={(e) => { void onTrocarProvedor(e.target.value) }}
        style={{
          padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)',
          fontSize: 13.5, fontFamily: FONTE, color: 'var(--text)',
          background: 'var(--surface)', outline: 'none', minWidth: 220,
        }}>
        {PROVEDORES.map((p) => (
          <option key={p} value={p}>{nomeDoProvedor(p)}</option>
        ))}
      </select>
      <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '6px 0 14px' }}>
        Um provedor por vez. As chaves de acesso ficam no servidor, nunca nesta tela.
      </p>

      {/* ---------------- Como está configurado ----------------
          Referência para quando dá problema, não coisa de olhar todo dia — por
          isso cinza e miúdo. Cada linha responde uma pergunta: em qual painel
          entrar, qual instância é a nossa, e se a chave é a que se pensa. */}
      {(conexao?.servidor || conexao?.instancia || conexao?.chaveFinal || conexao?.numero) && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 14px',
          fontSize: 11.5, color: 'var(--muted)', marginBottom: 16,
          paddingBottom: 14, borderBottom: '1px solid var(--border-subtle)',
        }}>
          {conexao.servidor && (<>
            <span>Servidor</span>
            <span style={{ fontFamily: MONO, color: 'var(--text)', wordBreak: 'break-all' }}>
              {conexao.servidor}
            </span>
          </>)}
          {conexao.instancia && (<>
            <span>Instância</span>
            <span style={{ fontFamily: MONO, color: 'var(--text)' }}>{conexao.instancia}</span>
          </>)}
          {conexao.chaveFinal && (<>
            <span>Chave</span>
            <span style={{ fontFamily: MONO, color: 'var(--text)' }} title="Os quatro últimos caracteres. Serve para conferir qual chave está configurada.">
              ····{conexao.chaveFinal}
            </span>
          </>)}
          {/* O número vem INTEIRO, ao contrário da chave logo acima — e a
              diferença é o que cada um faz na mão errada. A chave manda
              mensagem por aquele WhatsApp; o número é o que a empresa
              distribui em cartão e no Instagram. Esconder o que está impresso
              na fachada não protege nada, e tira justamente a conferência que
              importa: é ESTE o número que está atendendo? */}
          {conexao.numero && (<>
            <span>WhatsApp</span>
            <span style={{ fontFamily: MONO, color: 'var(--text)' }}>
              {formatarParaExibicao(conexao.numero)}
            </span>
          </>)}
        </div>
      )}

      {/* ---------------- Estado ---------------- */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        background: v.fundo, border: `1px solid ${v.borda}`, borderRadius: 11,
        padding: '12px 14px',
      }}>
        {foraDoAr
          ? <ServerCrash size={18} color={v.cor} style={{ flexShrink: 0 }} />
          : <Smartphone size={18} color={v.cor} style={{ flexShrink: 0 }} />}

        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: v.cor }}>{v.rotulo}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, lineHeight: 1.5 }}>
            {explicacao()}
          </div>
        </div>

        <button
          onClick={() => { void verificarAgora() }}
          disabled={verificando}
          title="Verificar agora"
          style={{
            ...botaoBase, padding: '7px 12px', border: '1px solid var(--border)',
            background: 'var(--surface)', color: 'var(--muted)', fontWeight: 600, fontSize: 12,
            cursor: verificando ? 'wait' : 'pointer', flexShrink: 0,
          }}>
          <RefreshCw size={13} className={verificando ? 'girando' : undefined} /> Verificar
        </button>
      </div>

      {/* ---------------- O webhook: a terceira condição ----------------

          Só aparece quando há problema — mesmo princípio da faixa vermelha de
          Conversas. `desconhecido` não mostra nada: não deu para perguntar, e
          acusar o que não se sabe é o erro que estamos evitando, ao contrário.

          E nunca dizemos PARA ONDE ele aponta, só SE aponta: a URL carrega o
          `WEBHOOK_SEGREDO` dentro dela.                                     */}
      {(conexao?.webhook === 'ausente' || conexao?.webhook === 'outro') && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 12,
          background: 'var(--warning-soft)', border: '1px solid var(--warning-border)', borderRadius: 11,
          padding: '12px 14px',
        }}>
          <Unplug size={17} color="var(--warning)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--warning)' }}>
              Conectado, mas nada chega aqui
            </div>
            <div style={{ fontSize: 12, color: 'var(--warning)', lineHeight: 1.6, marginTop: 3 }}>
              {conexao.webhook === 'outro'
                ? <>A {nomeDoProvedor(provedor)} está avisando <strong>outro endereço</strong>, e não este sistema.</>
                : <>A {nomeDoProvedor(provedor)} <strong>não está configurada para avisar</strong> este sistema quando chega mensagem.</>}
              {' '}Mensagem que o cliente mandar fica no WhatsApp e não aparece em
              Conversas — a {nomeAgente} nem fica sabendo. Resolve no painel da{' '}
              {nomeDoProvedor(provedor)}, apontando o webhook para cá.
            </div>
          </div>
        </div>
      )}

      {provedor === 'meta' && <div style={{marginTop:14,fontSize:13,lineHeight:1.6}}>
        <p>A conexão é gerenciada pelo WhatsApp Manager. O token fica protegido no servidor.</p>
        {conexao?.callback_url && <p>Endereço do webhook: <code style={{overflowWrap:'anywhere'}}>{conexao.callback_url}</code></p>}
        <p>{conexao?.ultimo_evento ? `Último evento recebido: ${new Date(conexao.ultimo_evento).toLocaleString('pt-BR')}` : 'Ainda não há confirmação de evento recebido neste número.'}</p>
        {!!conexao?.pendencias?.length && <details><summary>{conexao.pendencias.length} evento(s) pendente(s) ou aguardando revisão</summary>
          {conexao.pendencias.map(e=><p key={e.id}>{e.estado === 'revisar' ? 'Revisão necessária': 'Processamento pendente'} · {e.erro ?? 'Aguardando processamento.'} {e.contato_id && <a href={`/conversas?lead=${e.contato_id}`}>Abrir conversa</a>}</p>)}
          <p>Eventos em revisão não são reenviados automaticamente. Confira a conversa e assuma o atendimento quando necessário.</p>
        </details>}
        <a href="https://business.facebook.com/wa/manage" target="_blank" rel="noreferrer">Abrir WhatsApp Manager</a>
      </div>}
      <p style={{fontSize:12,color:'var(--muted)'}}>Um provedor por vez. Ao trocar, a IA é pausada e as próximas mensagens usam o número da opção selecionada.</p>
      {/* ---------------- Ações ---------------- */}
      {provedor === 'uazapi' && estado === 'conectado' && (
        <button
          onClick={() => setConfirmando(true)}
          disabled={ocupado}
          style={{
            ...botaoBase, marginTop: 12, border: '1px solid var(--danger-border)',
            background: 'var(--danger-soft)', color: 'var(--danger)',
            cursor: ocupado ? 'wait' : 'pointer',
          }}>
          <LogOut size={13} /> Desconectar
        </button>
      )}

      {provedor === 'uazapi' && (estado === 'desconectado' || estado === 'conectando') && !pareando && (
        <button
          onClick={() => setPareando(true)}
          style={{
            ...botaoBase, marginTop: 12, border: 'none',
            background: 'var(--action)', color: 'var(--on-action)', cursor: 'pointer',
          }}>
          <Smartphone size={13} /> Conectar
        </button>
      )}

      {/* ---------------- Pareamento ---------------- */}
      {provedor === 'uazapi' && pareando && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-subtle)' }}>
          <p style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.6, margin: '0 0 12px' }}>
            Informe o número do WhatsApp da empresa para receber um <strong>código de 8
            dígitos</strong>, que você digita no celular. Sem o número, sai um QR para escanear.
          </p>

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <CampoTelefone
                valor={numero}
                onChange={(canonico, ok) => { setNumero(canonico); setValido(ok) }}
                rotulo="Número da empresa"
                obrigatorio={false}
              />
            </div>
            <button
              onClick={gerarPareamento}
              disabled={ocupado}
              style={{
                ...botaoBase, padding: '9px 14px', border: 'none',
                background: 'var(--action)', color: 'var(--on-action)',
                cursor: ocupado ? 'wait' : 'pointer',
              }}>
              {ocupado ? 'Gerando...' : 'Gerar'}
            </button>
          </div>

          {codigo && (
            <div style={{
              marginTop: 14, background: 'var(--accent-soft)', border: '1px solid var(--border)',
              borderRadius: 11, padding: '14px 16px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>
                No celular: WhatsApp → Aparelhos conectados → Conectar com número
              </div>
              <div style={{ fontFamily: MONO, fontSize: 26, fontWeight: 700, color: 'var(--text)', letterSpacing: 3 }}>
                {codigo}
              </div>
            </div>
          )}

          {!codigo && qr && (
            <div style={{ marginTop: 14, textAlign: 'center' }}>
              <img
                src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`}
                alt="QR code para conectar o WhatsApp"
                style={{ width: 220, height: 220, borderRadius: 11, border: '1px solid var(--border)' }}
              />
            </div>
          )}

          <button
            onClick={() => { setPareando(false); setCodigo(null); setQr(null); setErro('') }}
            style={{
              ...botaoBase, marginTop: 12, padding: '7px 12px',
              border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--muted)',
              fontWeight: 600, fontSize: 12, cursor: 'pointer',
            }}>
            Fechar
          </button>
        </div>
      )}

      {/* ---------------- A última verificação ----------------

          Antes esta linha só aparecia com a conexão de pé — e era justamente
          onde ela menos fazia falta. Quem clica em "Verificar" três vezes
          seguidas é quem está com o servidor fora do ar esperando ele voltar,
          e era ali que a tela não dizia nada.

          O horário sai do `verificadoEm`, e não da cadência: entre um clique e
          outro o estado quase nunca muda, então é ele que prova que a pergunta
          foi feita de novo.                                                  */}
      {!pareando && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 11.5, color: 'var(--muted)', marginTop: 10,
        }}>
          <Check size={12} color={conferido || estado === 'conectado' ? 'var(--success)' : 'var(--muted)'} />
          {fraseDaVerificacao()}
        </div>
      )}

      {erro && (
        <div style={{
          marginTop: 12, background: 'var(--danger-soft)', border: '1px solid var(--danger-border)',
          borderRadius: 9, padding: '9px 12px', fontSize: 12.5, color: 'var(--danger)',
        }}>{erro}</div>
      )}

      {confirmando && (
        <ConfirmDeleteModal
          itemName="a conexão do WhatsApp"
          title="Desconectar o WhatsApp?"
          message={
            <>A {nomeAgente} para de receber e de responder <strong>na hora</strong>, e a equipe
            deixa de ver mensagens novas. Para voltar, é preciso parear o celular de novo.</>
          }
          confirmLabel="Desconectar"
          loadingLabel="Desconectando..."
          loading={ocupado}
          onConfirm={confirmarDesconexao}
          onClose={() => setConfirmando(false)}
        />
      )}
    </div>
  )
}
