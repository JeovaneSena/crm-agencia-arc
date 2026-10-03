import ModalPortal from '../components/ModalPortal'
import { useMediaQuery } from '../lib/useMediaQuery'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import ListaConversas from '../components/ListaConversas'
import JanelaConversa from '../components/JanelaConversa'
import PainelLead from '../components/PainelLead'
import {
  listarConversas, carregarMensagens, enviarMensagem, enviarAnexo,
  adiarConversa, assumirConversa, concluirEncaminhamento, definirIAConversa, devolverConversa, marcarComoLidas, transferirConversa,
} from '../lib/conversas'
import { encaminhamentos } from '../lib/encaminhamento'
import { useEtiquetas } from '../lib/etiquetas'
import { apagarNota, carregarNotas, criarNota, type NotaConversa } from '../lib/notas'
import { useSessao } from '../lib/sessao'
import type { ConversaResumo, MensagemWhatsapp } from '../types'

/**
 * A tela Conversas — o WhatsApp da empresa dentro do sistema.
 *
 * ⚠️ REALTIME ASSINA A TABELA, NUNCA A VIEW. A lista vem de `conversas_lista`,
 * mas a assinatura é em `mensagens_whatsapp` e `contatos_dados`: o Postgres
 * só replica tabela. Assinar a view não dá erro — simplesmente nunca dispara.
 *
 * Chega evento, a lista é RELIDA em vez de remendada com o payload. O payload
 * traz a linha da tabela; a lista precisa da última mensagem, do contador de
 * não lidas e do nome de quem assumiu, que são calculados na view.
 */
export default function Conversas() {
  const [params, setParams] = useSearchParams()
  const larga = useMediaQuery('(min-width: 1280px)')
  const [contextoMovel, setContextoMovel] = useState(false)

  const { usuario } = useSessao()
  const { etiquetas, porContato } = useEtiquetas()
  const [conversas, setConversas] = useState<ConversaResumo[]>([])
  const [selecionada, setSelecionada] = useState<string | null>(params.get('lead'))
  const [mensagens, setMensagens] = useState<MensagemWhatsapp[]>([])
  const [notas, setNotas] = useState<NotaConversa[]>([])

  const [carregandoLista, setCarregandoLista] = useState(true)
  const [carregandoConversa, setCarregandoConversa] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  // Aberto ou fechado é preferência de quem usa, e sobrevive ao F5. Se falhar
  // (navegador anônimo, site data bloqueado), abre — que é o padrão útil.
  const [painelAberto, setPainelAberto] = useState(() => {
    try { return localStorage.getItem('conversas.painel') !== 'fechado' } catch { return true }
  })

  function alternarPainel() {
    if (!larga) { setContextoMovel(v => !v); return }
    setPainelAberto((antes) => {
      const agora = !antes
      try { localStorage.setItem('conversas.painel', agora ? 'aberto' : 'fechado') } catch { /* segue */ }
      return agora
    })
  }

  // O callback do Realtime é criado uma vez e enxergaria para sempre o valor
  // inicial de `selecionada`. O ref é o que o mantém em dia.
  const abertaRef = useRef<string | null>(selecionada)
  useEffect(() => { abertaRef.current = selecionada }, [selecionada])

  // Escritas em `.then()`, e não com `await`, porque estas duas rodam dentro de
  // efeito: o React avisa que `setState` no corpo do efeito encadeia render em
  // cima de render. Dentro do callback não encadeia — é o mesmo padrão do CRM.
  const recarregarLista = useCallback(() =>
    listarConversas()
      .then((c) => { setConversas(c); setCarregandoLista(false) })
      .catch(() => { setErro('Não consegui carregar as conversas.'); setCarregandoLista(false) }),
  [])

  const recarregarMensagens = useCallback((leadId: string) =>
    carregarMensagens(leadId)
      .then((m) => { setMensagens(m); setCarregandoConversa(false) })
      .catch(() => { setErro('Não consegui carregar esta conversa.'); setCarregandoConversa(false) }),
  [])

  const recarregarNotas = useCallback((leadId: string) =>
    carregarNotas(leadId).then(setNotas).catch(() => setErro('Não consegui carregar as notas desta conversa.')),
  [])

  useEffect(() => { recarregarLista() }, [recarregarLista])

  // Abrir uma conversa: carrega e zera as não lidas.
  useEffect(() => {
    if (!selecionada) return
    recarregarMensagens(selecionada)
    void recarregarNotas(selecionada)
    marcarComoLidas(selecionada).then(recarregarLista)
  }, [selecionada, recarregarMensagens, recarregarNotas, recarregarLista])

  // Realtime.
  useEffect(() => {
    const canal = supabase
      .channel('conversas')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mensagens_whatsapp' },
        (payload) => {
          const linha = (payload.new ?? payload.old) as { contato_id?: string } | null
          recarregarLista()
          if (linha?.contato_id && linha.contato_id === abertaRef.current) {
            recarregarMensagens(linha.contato_id)
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'contatos_dados' },
        () => recarregarLista(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notas_conversa' },
        () => { if (abertaRef.current) void recarregarNotas(abertaRef.current) },
      )
      .subscribe()

    return () => { supabase.removeChannel(canal) }
  }, [recarregarLista, recarregarMensagens, recarregarNotas])

  const aberta = conversas.find((c) => c.contato_id === selecionada) ?? null
  const encaminhadas = useMemo(() => encaminhamentos(conversas), [conversas])
  const atendimento = selecionada ? encaminhadas.get(selecionada) ?? null : null

  // Quem o assistente passou para a equipe vai para o topo, na ordem em que pediu. O
  // resto da lista mantém a ordem da última mensagem, que é a da view.
  const ordenadas = [...conversas].sort((a, b) => {
    const ea = encaminhadas.get(a.contato_id), eb = encaminhadas.get(b.contato_id)
    if (!ea !== !eb) return ea ? -1 : 1
    if (ea && eb) return ea.desde.localeCompare(eb.desde)
    return 0
  })

  function selecionar(leadId: string) {
    if (leadId === selecionada) return
    // Limpar aqui, e não no efeito: trocar de conversa mostraria por um
    // instante as mensagens da anterior debaixo do nome da nova.
    setMensagens([])
    setNotas([])
    setCarregandoConversa(true)
    setErro('')
    setSelecionada(leadId)
    setParams({ lead: leadId }, { replace: true })
  }

  async function aoEnviar(texto: string) {
    if (!selecionada) return
    setEnviando(true)
    setErro('')
    try {
      await enviarMensagem(selecionada, texto)
      await recarregarMensagens(selecionada)
      await recarregarLista()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'O envio não foi confirmado. Confira a conexão e o histórico.')
    }
    setEnviando(false)
  }

  async function aoEnviarAnexo(arquivo: File, legenda: string) {
    if (!selecionada) return
    setEnviando(true)
    setErro('')
    try {
      await enviarAnexo(selecionada, arquivo, legenda)
      await recarregarMensagens(selecionada)
      await recarregarLista()
    } catch (e) {
      setErro(e instanceof Error && e.message.includes(' ') ? e.message : 'O anexo não foi enviado. Confira a conexão e o histórico antes de tentar de novo.')
    }
    setEnviando(false)
  }

  async function aoNota(texto: string) {
    if (!selecionada || !usuario) return
    setErro('')
    try {
      await criarNota(selecionada, texto, usuario.id)
      await recarregarNotas(selecionada)
    } catch {
      setErro('Não consegui salvar a nota. Ela não foi enviada a ninguém.')
    }
  }

  async function aoApagarNota(id: string) {
    if (!selecionada) return
    setErro('')
    try {
      await apagarNota(id)
      await recarregarNotas(selecionada)
    } catch {
      setErro('Não consegui apagar a nota.')
    }
  }

  async function aoAssumir(forcar = false) {
    if (!selecionada) return
    setErro('')
    try {
      if (!usuario) throw new Error('Sessão expirada. Entre de novo.')
      const consegui = await assumirConversa(selecionada, forcar)
      if (!consegui) setErro('Outra pessoa assumiu esta conversa antes de você. Ela já aparece como responsável.')
      await recarregarLista()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui assumir a conversa.')
    }
  }

  async function aoAdiar(ate: Date | null) {
    if (!selecionada) return
    setErro('')
    try {
      await adiarConversa(selecionada, ate)
      await recarregarLista()
    } catch {
      setErro('Não consegui adiar a conversa. Escolha um horário no futuro, em até 30 dias.')
    }
  }

  async function aoTransferir(paraId: string) {
    if (!selecionada) return
    setErro('')
    try {
      await transferirConversa(selecionada, paraId)
      await recarregarLista()
    } catch {
      setErro('Não consegui transferir a conversa. Só quem está com ela, ou o gestor, pode passá-la adiante.')
    }
  }

  async function aoDevolver() {
    if (!selecionada) return
    setErro('')
    try {
      // Com encaminhamento aberto, devolver é concluir: o aviso do assistente sai da lista.
      await (atendimento ? concluirEncaminhamento(selecionada) : devolverConversa(selecionada))
      await recarregarLista()
    } catch {
      setErro('Não consegui devolver a conversa.')
    }
  }

  async function aoAlternarIA(ligada: boolean) {
    if (!selecionada) return
    setErro('')
    try {
      await definirIAConversa(selecionada, ligada)
      await recarregarLista()
    } catch {
      setErro('Não consegui mudar o assistente nesta conversa.')
    }
  }

  function voltarParaLista() {
    setSelecionada(null)
    setParams({}, { replace: true })
    setContextoMovel(false)
  }

  return <div className={`conversations${selecionada ? ' has-selection' : ''}`}>
    <ListaConversas conversas={ordenadas} encaminhadas={encaminhadas} etiquetas={etiquetas} porContato={porContato} selecionada={selecionada} onSelecionar={selecionar} carregando={carregandoLista} />
    <div className="conversation-main">
      <JanelaConversa
        conversa={aberta}
        atendimento={atendimento}
        mensagens={mensagens}
        notas={notas}
        onNota={aoNota}
        onApagarNota={aoApagarNota}
        carregando={carregandoConversa}
        enviando={enviando}
        erro={erro}
        onEnviar={aoEnviar}
        onEnviarAnexo={aoEnviarAnexo}
        onAtualizar={() => { if (selecionada) void recarregarMensagens(selecionada); void recarregarLista() }}
        onAssumir={() => aoAssumir(false)}
        onForcarAssumir={() => aoAssumir(true)}
        onTransferir={aoTransferir}
        onAdiar={aoAdiar}
        onDevolver={aoDevolver}
        onAlternarIA={aoAlternarIA}
        painelAberto={larga ? painelAberto : contextoMovel}
        onAlternarPainel={alternarPainel}
        onVoltar={voltarParaLista}
      />
    </div>
    {larga && painelAberto && aberta && <div className="conversation-context"><PainelLead key={aberta.contato_id} leadId={aberta.contato_id} onFechar={alternarPainel} /></div>}
    {!larga && contextoMovel && aberta && <ModalPortal label="Dados do contato" onClose={() => setContextoMovel(false)}>
      <div style={{ position: 'fixed', inset: 0, display: 'flex', justifyContent: 'flex-end' }} onClick={e => { if (e.target === e.currentTarget) setContextoMovel(false) }}>
        <div className="context-dialog" style={{ width: 360, maxWidth: '100%', background: 'var(--surface)', borderRadius: 14 }}>
          <div className="conversation-context"><PainelLead key={aberta.contato_id} leadId={aberta.contato_id} onFechar={() => setContextoMovel(false)} /></div>
        </div>
      </div>
    </ModalPortal>}
    {erro && !aberta && <div role="alert" className="arc-notice arc-notice-danger">{erro}</div>}
  </div>
}
