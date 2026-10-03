import { supabase } from './supabase'
import { rotuloDoAgente } from './agente'
import type {
  ConversaResumo, MensagemWhatsapp, TipoMensagem, AutorMensagem,
  Contato, Consulta, Profissional,
} from '../types'

/** Consulta com o profissional já resolvido pelo join. */
export interface ConsultaComProfissional extends Consulta {
  profissional: Pick<Profissional, 'nome' | 'sobrenome' | 'cor'> | null
}

/**
 * Tudo que a tela Conversas faz com o banco e com a Edge Function.
 *
 * Fica fora dos componentes pelo mesmo motivo de `agenda.ts`: são regras que
 * três telas diferentes vão querer (a lista, a janela e a ficha do lead), e
 * regra copiada é regra que envelhece em um lugar só.
 */

/** Quantas mensagens a janela carrega de uma vez. */
const HISTORICO = 200

export async function listarConversas(): Promise<ConversaResumo[]> {
  const { data, error } = await supabase
    .from('conversas_lista')
    .select('*')
    .order('ultima_em', { ascending: false })
    .limit(200)

  if (error) throw error
  const lista = (data ?? []) as ConversaResumo[]

  // `adiada_ate` vem de uma consulta à parte, e não da view: a view muda de forma conforme os módulos
  // ligados (o assistente a redefine), e esta coluna é do módulo conversas inteiro.
  const { data: adiadas, error: erroAdiadas } = await supabase
    .from('contatos_dados').select('id,adiada_ate').not('adiada_ate', 'is', null)
  if (!erroAdiadas && adiadas?.length) {
    const ate = new Map((adiadas as { id: string; adiada_ate: string }[]).map((a) => [a.id, a.adiada_ate]))
    for (const c of lista) c.adiada_ate = ate.get(c.contato_id) ?? null
  }
  return lista
}

/** Tira a conversa da fila até `ate` (nulo = volta agora). O banco confere: futuro e até 30 dias. */
export async function adiarConversa(leadId: string, ate: Date | null): Promise<void> {
  const { error } = await supabase.rpc('conversa_adiar', { p_contato: leadId, p_ate: ate ? ate.toISOString() : null })
  if (error) throw error
}

export async function carregarMensagens(leadId: string): Promise<MensagemWhatsapp[]> {
  const { data, error } = await supabase
    .from('mensagens_whatsapp')
    .select('*')
    .eq('contato_id', leadId)
    .order('criada_em', { ascending: false })
    .limit(HISTORICO)

  if (error) throw error
  // Vem do banco em ordem decrescente (para o `limit` pegar as recentes) e é
  // exibida em ordem crescente.
  return ((data ?? []) as MensagemWhatsapp[]).reverse()
}

/**
 * Manda a mensagem do atendente pelo WhatsApp.
 *
 * **Não grava direto na tabela**, de propósito: quem fala com o provedor é a
 * Edge Function, e é ela que grava a linha depois de o WhatsApp aceitar. Um
 * `insert` daqui criaria balão na tela para uma mensagem que talvez não tenha
 * saído — o pior tipo de mentira numa tela de atendimento.
 */
export async function enviarMensagem(leadId: string, texto: string): Promise<void> {
  const { data: sessao } = await supabase.auth.getSession()
  const token = sessao.session?.access_token
  if (!token) throw new Error('sessão expirada')

  const r = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp/enviar`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contato_id: leadId, texto, pedido_id:crypto.randomUUID() }),
    },
  )

  const dados = await r.json().catch(() => null)
  if (!r.ok || !dados?.ok) throw new Error(dados?.motivo ?? 'falha_no_envio')
}

/**
 * Envia um anexo (foto, vídeo, áudio ou documento) com legenda opcional. Mesma regra do texto: um `pedido_id` por
 * clique impede o envio em dobro, e só se vê "enviado" quando a função confirma.
 */
export async function enviarAnexo(leadId: string, arquivo: File, legenda: string): Promise<void> {
  const { data: sessao } = await supabase.auth.getSession()
  const token = sessao.session?.access_token
  if (!token) throw new Error('sessão expirada')
  const form = new FormData()
  form.set('contato_id', leadId); form.set('pedido_id', crypto.randomUUID()); form.set('legenda', legenda); form.set('arquivo', arquivo)
  const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp/enviar-midia`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
  const dados = await r.json().catch(() => null)
  if (!r.ok || !dados?.ok) throw new Error(dados?.erro ?? dados?.motivo ?? 'falha_no_envio')
}

/**
 * Pede à IA um RASCUNHO da próxima mensagem (só com o módulo assistente). Devolve texto; NÃO envia nada: a pessoa
 * lê, ajusta e envia como qualquer outra mensagem.
 */
export async function pedirRascunho(leadId: string): Promise<string> {
  const { data: sessao } = await supabase.auth.getSession()
  const token = sessao.session?.access_token
  if (!token) throw new Error('sessão expirada')
  const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp/rascunho`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contato_id: leadId }),
  })
  const dados = await r.json().catch(() => null)
  if (!r.ok || !dados?.ok || typeof dados.texto !== 'string') throw new Error(dados?.motivo ?? 'falha_no_rascunho')
  return dados.texto
}

/**
 * Assume a conversa: o assistente para de responder ESTA conversa, e só ela. O agente continua atendendo
 * todo mundo.
 *
 * A troca de dono é UMA instrução atômica no banco (`conversa_assumir`, migração 0015): se outra pessoa
 * chegou antes, nada muda e a resposta é `false`. `forcar` é do gestor, para tomar de quem já está com ela.
 */
export async function assumirConversa(leadId: string, forcar = false): Promise<boolean> {
  const { data, error } = await supabase.rpc('conversa_assumir', { p_contato: leadId, p_forcar: forcar })
  if (error) throw error
  return data === true
}

/** Devolve a conversa a ninguém (e, com o assistente, a ele). Quem devolve fica registrado. */
export async function devolverConversa(leadId: string): Promise<void> {
  const { error } = await supabase.rpc('conversa_devolver', { p_contato: leadId })
  if (error) throw error
}

/** Passa a conversa para outra pessoa ativa da equipe. Só quem está com ela, ou o gestor. */
export async function transferirConversa(leadId: string, paraUsuarioId: string): Promise<void> {
  const { error } = await supabase.rpc('conversa_transferir', { p_contato: leadId, p_para: paraUsuarioId })
  if (error) throw error
}

/**
 * Conclui um encaminhamento do assistente: devolve a conversa e apaga o aviso. O assistente NÃO volta
 * sozinho (`ia_ligada` segue desligada): quem decide religar é a equipe, pelo botão da conversa.
 */
export async function concluirEncaminhamento(leadId: string): Promise<void> {
  await devolverConversa(leadId)
  const { error } = await supabase
    .from('contatos_dados')
    .update({ ia_encaminhada_em: null, ia_resumo: null })
    .eq('id', leadId)

  if (error) throw error
}

/** Liga ou desliga o assistente nesta conversa. Ligar também apaga um encaminhamento antigo. */
export async function definirIAConversa(leadId: string, ligada: boolean): Promise<void> {
  const { error } = await supabase
    .from('contatos_dados')
    .update(ligada ? { ia_ligada: true, ia_encaminhada_em: null, ia_resumo: null } : { ia_ligada: false })
    .eq('id', leadId)

  if (error) throw error
}

/**
 * Marca como lidas as mensagens do cliente.
 *
 * **A leitura é da equipe inteira, não de cada usuário.** Quem abriu a conversa
 * viu; não faz sentido a mesma mensagem seguir "não lida" para o colega ao
 * lado, que está olhando a mesma tela na mesma recepção.
 */
export async function marcarComoLidas(leadId: string): Promise<void> {
  await supabase
    .from('mensagens_whatsapp')
    .update({ lida: true })
    .eq('contato_id', leadId)
    .eq('autor', 'cliente')
    .eq('lida', false)
}

/**
 * URL temporária de um arquivo do bucket `midias-whatsapp`.
 *
 * O bucket é **privado**: ali ficam áudios e fotos que clientes mandaram,
 * inclusive foto enviada pelo cliente. `getPublicUrl()` não funciona, e é bom que não
 * funcione — a URL assinada expira.
 */
export async function urlDaMidia(caminho: string): Promise<string | null> {
  const { data } = await supabase.storage
    .from('midias-whatsapp')
    .createSignedUrl(caminho, 60 * 60)

  return data?.signedUrl ?? null
}

/** A frase que representa a mensagem na lista da esquerda. */
export function previaDaMensagem(tipo: TipoMensagem, conteudo: string | null): string {
  const texto = conteudo?.trim()
  if (tipo === 'texto') return texto || 'Mensagem'
  // No áudio, `conteudo` guarda a transcrição — mostrar ela é mais útil do que
  // dizer "Áudio", mas o ícone continua avisando que veio falado.
  if (tipo === 'audio') return texto ? `🎤 ${texto}` : '🎤 Áudio'
  if (tipo === 'imagem') return texto ? `📷 ${texto}` : '📷 Foto'
  if (tipo === 'video') return '🎬 Vídeo'
  return '📎 Arquivo'
}

const AUTORES: Record<AutorMensagem, string> = {
  cliente: 'Cliente',
  agente: rotuloDoAgente(),
  atendente: 'Atendente da empresa',
}

export function nomeDoAutor(autor: AutorMensagem): string {
  return AUTORES[autor] ?? autor
}

/** `14:32` — a hora que vai embaixo do balão. */
export function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

/**
 * `Hoje`, `Ontem` ou `12 de agosto` — a tarja que separa os dias na conversa.
 */
export function diaPorExtenso(iso: string): string {
  const d = new Date(iso)
  const hoje = new Date()
  const ontem = new Date()
  ontem.setDate(hoje.getDate() - 1)

  const mesmoDia = (a: Date, b: Date) =>
    a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()

  if (mesmoDia(d, hoje)) return 'Hoje'
  if (mesmoDia(d, ontem)) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })
}

/** `14:32`, `Ontem` ou `12/08` — o carimbo curto da lista da esquerda. */
export function quandoCurto(iso: string): string {
  const d = new Date(iso)
  const hoje = new Date()
  if (d.toDateString() === hoje.toDateString()) return hora(iso)

  const ontem = new Date()
  ontem.setDate(hoje.getDate() - 1)
  if (d.toDateString() === ontem.toDateString()) return 'Ontem'

  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

/* ──────────────────────────────────────────────────────────────────────────
   A etiqueta "Agendada"
   ────────────────────────────────────────────────────────────────────────── */

/**
 * Esta pessoa tem consulta marcada?
 *
 * ⚠️ NÃO PERGUNTE ISSO AO `status`. A resposta óbvia seria
 * `status === 'diagnostico'`, e ela erra **em silêncio**: o trigger
 * `consultas_sincroniza_lead` preserva de propósito `diagnostico` e
 * `ganho` quando o lead marca de novo — porque é por esses dois
 * status que `pessoas.ts` separa /leads de /clientes, e rebaixá-los jogaria um
 * cliente de volta na lista de contatos a cada retorno.
 *
 * Ou seja: **um cliente que volta e marca continua em `ganho`.**
 * Filtrar por status perderia exatamente quem mais volta numa empresa de
 * odontologia — tratamento de várias sessões, retorno, manutenção.
 *
 * `proxima_reuniao` vem da view `conversas_lista`: a próxima reunião agendada
 * no futuro, qualquer que seja o status da pessoa.
 */
export function temConsultaMarcada(c: ConversaResumo): boolean {
  return !!c.proxima_reuniao
}

/**
 * `hoje, 14h` · `amanhã, 9h30` · `3 set, 14h` — o quando da etiqueta.
 *
 * O dia vem antes da hora porque em uma lista o que se procura é o dia; e a
 * hora aparece sem os `:00` porque "14h" é como se fala ao telefone.
 */
export function quandoAgendada(iso: string): string {
  const d = new Date(iso)
  const hoje = new Date()
  const amanha = new Date()
  amanha.setDate(hoje.getDate() + 1)

  const mesmoDia = (a: Date, b: Date) =>
    a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()

  const min = d.getMinutes()
  const relogio = min === 0 ? `${d.getHours()}h` : `${d.getHours()}h${String(min).padStart(2, '0')}`

  if (mesmoDia(d, hoje)) return `hoje, ${relogio}`
  if (mesmoDia(d, amanha)) return `amanhã, ${relogio}`

  const dia = d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '')
  return `${dia}, ${relogio}`
}

/**
 * Os dados completos do lead, para o painel lateral.
 *
 * A view `conversas_lista` traz só o que a lista da esquerda precisa. O painel
 * quer mais: interesse, resumo, quando chegou, anotações.
 */
export async function carregarLead(leadId: string): Promise<Contato | null> {
  const { data } = await supabase
    .from('contatos')
    .select('*')
    .eq('id', leadId)
    .maybeSingle()

  return (data as Contato) ?? null
}

/** As consultas da pessoa, da mais recente para a mais antiga. */
export async function carregarConsultas(leadId: string): Promise<ConsultaComProfissional[]> {
  const { data } = await supabase
    .from('reunioes')
    .select('*, profissional:profissionais(nome, sobrenome, cor)')
    .eq('contato_id', leadId)
    .order('data_reuniao', { ascending: false })

  return (data ?? []) as ConsultaComProfissional[]
}

/**
 * A foto de perfil do WhatsApp.
 *
 * Passa pela Edge Function porque a chave da integração anterior é de servidor: pedir a
 * foto direto do navegador exigiria mandá-la para o bundle, e quem tem essa
 * chave manda mensagem por aquele WhatsApp.
 *
 * `null` é resposta comum e esperada — muita gente esconde a foto.
 */
export async function fotoDoPerfil(whatsapp: string): Promise<string | null> {
  try {
    const { data: sessao } = await supabase.auth.getSession()
    const token = sessao.session?.access_token
    if (!token) return null

    const r = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp/foto?whatsapp=${whatsapp}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const dados = await r.json()
    return dados?.url ?? null
  } catch {
    return null
  }
}
