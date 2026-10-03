/**
 * Gancho do módulo ASSISTENTE: a mensagem do cliente chega, e a IA decide se responde.
 * Entra no lugar de `gancho.ts` nas instalações que ligam `assistente` (ver `gancho.ts`).
 * Aqui só a cola com o banco, o modelo e o WhatsApp; a lógica e as travas estão em `assistente.ts`.
 */
import { atualizar, inserir, rpc, selecionar } from './db.ts'
import { conversar } from './llm.ts'
import { UAZAPI } from './uazapi.ts'
import { abrirAviso } from './avisos.ts'
import { gerarRascunho, responderComIA, type ConfigIA, type DepsIA } from './assistente.ts'

export interface MensagemGravada {
  contatoId: string
  mensagemId: string
  whatsapp: string
  tipo: string
  texto: string | null
}

interface LinhaConfig {
  modo: ConfigIA['modo']; nome: string; modelo: string; instrucoes: string | null
  numeros_teste: string[]; max_respostas: number; espera_segundos: number
}

async function lerConfig(): Promise<ConfigIA | null> {
  const c = (await selecionar<LinhaConfig>('assistente_config?select=modo,nome,modelo,instrucoes,numeros_teste,max_respostas,espera_segundos&limit=1'))[0]
  return c ? { modo: c.modo, nome: c.nome, modelo: c.modelo, instrucoes: c.instrucoes, numerosTeste: c.numeros_teste, maxRespostas: c.max_respostas, esperaSegundos: c.espera_segundos } : null
}

/** Contato novo nasce com a IA ligada só no modo ao vivo (histórico e quem já falava com a equipe seguem desligados). */
export async function camposDoContatoNovo(): Promise<Record<string, unknown>> {
  const c = await lerConfig().catch(() => null)
  return c?.modo === 'ao_vivo' ? { ia_ligada: true } : {}
}

const agoraIso = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()

function depsDoBanco(): DepsIA {
  return {
    agora: () => new Date(),
    esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
    lerConfig,
    async lerConversa(contatoId) {
      const c = (await selecionar<{ id: string; ia_ligada: boolean; assumido_por: string | null }>(`contatos_dados?select=id,ia_ligada,assumido_por&id=eq.${contatoId}&limit=1`))[0]
      if (!c) return null
      const respostas = await selecionar<{ mensagem_id: string }>(`assistente_respostas?select=mensagem_id&contato_id=eq.${contatoId}&estado=in.(respondida,encaminhada)`)
      return { id: c.id, iaLigada: c.ia_ligada, assumida: c.assumido_por !== null, respostasDaIA: respostas.length }
    },
    async equipeAtendendo(contatoId, horas) {
      const m = await selecionar<{ id: string }>(`mensagens_whatsapp?select=id&contato_id=eq.${contatoId}&autor=eq.atendente&criada_em=gte.${agoraIso(horas)}&limit=1`)
      return m.length > 0
    },
    async reservar(mensagemId, contatoId) {
      const linhas = await inserir<{ mensagem_id: string }>('assistente_respostas', { mensagem_id: mensagemId, contato_id: contatoId }, true, 'mensagem_id')
      return linhas.length > 0
    },
    async finalizar(mensagemId, estado, motivo) {
      await atualizar('assistente_respostas', `mensagem_id=eq.${mensagemId}`, { estado, motivo, updated_at: new Date().toISOString() })
    },
    async temMensagemMaisNova(contatoId, mensagemId) {
      const atual = (await selecionar<{ criada_em: string }>(`mensagens_whatsapp?select=criada_em&id=eq.${mensagemId}&limit=1`))[0]
      if (!atual) return false
      const nova = await selecionar<{ id: string }>(`mensagens_whatsapp?select=id&contato_id=eq.${contatoId}&autor=eq.cliente&criada_em=gt.${encodeURIComponent(atual.criada_em)}&limit=1`)
      return nova.length > 0
    },
    async historico(contatoId, limite) {
      const m = await selecionar<{ autor: string; conteudo: string | null; tipo: string }>(`mensagens_whatsapp?select=autor,conteudo,tipo&contato_id=eq.${contatoId}&order=criada_em.desc&limit=${limite}`)
      return m.reverse().map((x) => ({ deCliente: x.autor === 'cliente', texto: x.conteudo, tipo: x.tipo }))
    },
    async contexto() {
      const c = (await selecionar<{ nome_negocio: string | null; fuso_horario: string | null }>('configuracoes_negocio?select=nome_negocio,fuso_horario&limit=1'))[0]
      return { negocio: c?.nome_negocio ?? '', fuso: c?.fuso_horario || 'America/Sao_Paulo' }
    },
    conversar,
    servicos: () => selecionar(`catalogo_servicos?select=nome,descricao,preco_a_partir_de,duracao_minutos,exige_reuniao_previa&ativo=eq.true&arquivado=eq.false&e_reuniao_previa=eq.false&order=nome`),
    async horarios(dia, duracao) {
      const h = await rpc<string[] | { horario: string }[]>('agenda_horarios_disponiveis', { p_data: dia, p_duracao: duracao })
      const fuso = (await selecionar<{ fuso_horario: string | null }>('configuracoes_negocio?select=fuso_horario&limit=1'))[0]?.fuso_horario || 'America/Sao_Paulo'
      const hora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: fuso })
      return h.map((x) => hora.format(new Date(typeof x === 'string' ? x : x.horario)))
    },
    async encaminhar(contatoId, resumo) {
      await atualizar('contatos_dados', `id=eq.${contatoId}`, { ia_ligada: false, ia_encaminhada_em: new Date().toISOString(), ia_resumo: resumo.slice(0, 500) })
    },
    async pararDeFalar(contatoId, nivel) {
      const claro = nivel === 'pedido'
      await atualizar('contatos_dados', `id=eq.${contatoId}`, {
        ia_ligada: false, ia_encaminhada_em: new Date().toISOString(),
        ia_resumo: claro ? 'Pediu para parar de receber mensagens.' : 'Pode ter pedido para parar de receber mensagens.',
      })
      // Revoga o marketing só no pedido claro. Sem o módulo campanhas a função não existe: não é erro.
      if (claro) await rpc('marketing_registrar_preferencia', { p_contato: contatoId, p_ativo: false, p_fonte: 'Pediu para parar de receber mensagens (resposta ao WhatsApp).' }).catch(() => {})
      await abrirAviso(rpc, {
        tipo: 'pediu_para_parar', chave: contatoId, gravidade: 'atencao', contatoId, rota: '/conversas',
        titulo: claro ? 'Um contato pediu para parar de receber mensagens' : 'Um contato pode ter pedido para parar',
        detalhe: claro ? 'A IA se calou nesta conversa e o marketing foi bloqueado. Confira antes de qualquer contato.' : 'A IA se calou nesta conversa. Leia a mensagem e decida: se foi um pedido, registre o bloqueio.',
      })
    },
    async enviar(contatoId, telefone, texto) {
      // Reserva primeiro, envia depois, como na rota de envio da equipe.
      const gravada = await inserir<{ id: string }>('mensagens_whatsapp', {
        contato_id: contatoId, autor: 'agente', tipo: 'texto', conteudo: texto, provedor: 'uazapi',
        estado_envio: 'pendente', origem_envio: 'agente', lida: true,
      })
      const id = gravada[0].id
      try {
        const idExterno = await UAZAPI.enviarTexto(telefone, texto)
        await atualizar('mensagens_whatsapp', `id=eq.${id}`, { id_externo: idExterno, estado_envio: 'enviado' })
      } catch (e) {
        await atualizar('mensagens_whatsapp', `id=eq.${id}`, { estado_envio: 'incerto', erro_envio: 'Não foi possível confirmar o envio.' }).catch(() => {})
        throw e
      }
    },
  }
}

/** O mesmo contrato de `gancho.ts` (a função `whatsapp` é uma só nas duas instalações): o motivo é texto livre. */
export type ResultadoRascunho = { ok: true; texto: string } | { ok: false; motivo: string }

/** Rascunho para a equipe revisar e enviar: não passa pelas travas do atendimento automático. */
export function rascunhoDaIA(contatoId: string): Promise<ResultadoRascunho> {
  return gerarRascunho(depsDoBanco(), contatoId)
}

export async function aposReceber(m: MensagemGravada): Promise<void> {
  try {
    const r = await responderComIA(depsDoBanco(), { mensagemId: m.mensagemId, contatoId: m.contatoId, telefone: m.whatsapp, tipo: m.tipo, texto: m.texto })
    console.log(`assistente: ${r.estado}${'motivo' in r ? ` (${r.motivo})` : ''}`)
  } catch (e) {
    console.error('assistente: erro', e instanceof Error ? e.message.slice(0, 120) : 'erro')
  }
}
