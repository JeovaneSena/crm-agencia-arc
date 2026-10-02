import { supabase } from './supabase'
import { buscarPorWhatsapp, type PessoaResumo } from './contatos'
import { moduloAtivo } from './modulos'

/**
 * Apagar uma pessoa inteira do sistema.
 *
 * ── O QUE "TUDO" QUER DIZER ────────────────────────────────────────────────
 *
 * A ficha, a conversa inteira, as consultas (inclusive as já realizadas) e os
 * arquivos que ela mandou. **Não tem lixeira e não tem volta.**
 *
 * É o direito ao esquecimento da LGPD, e também a saída prática para número
 * errado e para lixo de teste.
 *
 * Depois disso o assistente não sabe mais nada dela: a ficha volta a ser "você
 * ainda não sabe nada sobre esta pessoa", e na próxima mensagem ela se
 * apresenta e pergunta o nome, como na primeira vez.
 *
 * ── POR QUE A CONTAGEM VEM ANTES ───────────────────────────────────────────
 *
 * Botão irreversível sem número vira clique automático. Com "68 mensagens · 3
 * consultas (1 já realizada)" na frente, a pessoa **lê** antes de clicar — e é
 * justamente o "1 já realizada" que faz alguém parar a tempo.
 *
 * ── E POR QUE A EXCLUSÃO NÃO ACONTECE AQUI ─────────────────────────────────
 *
 * A ficha o navegador até apagaria: o `ON DELETE CASCADE` levaria conversa e
 * consultas junto. **Os arquivos, não.** O Postgres recusa apagar do Storage
 * por SQL, e a Storage API exige a `service_role key`, que só existe dentro da
 * Edge Function. Então quem apaga é ela.
 */

export interface Previsao {
  pessoa: PessoaResumo
  projetos: number
  oportunidades: number
  /** Participações desta pessoa em públicos de campanha. */
  campanhas: number
  mensagens: number
  consultas: number
  /** Quantas dessas já aconteceram. É o número que faz alguém pensar duas vezes. */
  realizadas: number
}

/** Quem é, e o que exatamente será destruído. `null` quando o número não é de ninguém. */
export async function preverExclusao(canonico: string): Promise<Previsao | null> {
  const pessoa = await buscarPorWhatsapp(canonico)
  if (!pessoa) return null
  return contar(pessoa)
}

/**
 * A mesma previsão, para quem **já tem a pessoa na mão** — é o caso da ficha,
 * que está aberta nela.
 *
 * Procurar pelo telefone ali seria uma ida ao banco para descobrir o que o
 * componente já sabe, e quebraria justamente em quem não tem número gravado.
 */
export async function preverExclusaoDe(pessoa: PessoaResumo): Promise<Previsao> {
  return contar(pessoa)
}

async function contar(pessoa: PessoaResumo): Promise<Previsao> {
  // Tabelas de módulo só existem se a instalação as aplicou: perguntar por elas
  // num banco sem o módulo devolveria erro, e a contagem de tudo falharia.
  const contagem = (tabela: string) => supabase.from(tabela)
    .select('id', { count: 'exact', head: true }).eq('contato_id', pessoa.id)
  const vazio = Promise.resolve({ count: 0, error: null })
  const [msgs, todas, feitas, projetos, oportunidades, campanhas] = await Promise.all([
    moduloAtivo('conversas') ? contagem('mensagens_whatsapp') : vazio,
    contagem('reunioes'),
    contagem('reunioes').eq('status', 'realizada'),
    moduloAtivo('projetos') ? contagem('projetos') : vazio,
    contagem('oportunidades'),
    moduloAtivo('campanhas') ? contagem('whatsapp_campanha_destinatarios') : vazio,
  ])

  if ([msgs, todas, feitas, projetos, oportunidades, campanhas].some(r => r.error || r.count === null)) throw new Error('Não foi possível contar os registros. Atualize a página antes de excluir.')
  return {
    projetos: projetos.count!,
    oportunidades: oportunidades.count!,
    campanhas: campanhas.count!,
    pessoa,
    mensagens: msgs.count ?? 0,
    consultas: todas.count ?? 0,
    realizadas: feitas.count ?? 0,
  }
}

/**
 * Apaga de verdade. Devolve quantos arquivos saíram do Storage.
 *
 * A Edge Function apaga a mídia **primeiro** e a ficha depois: o caminho do
 * arquivo é `{contato_id}/...`, então apagar a ficha antes tiraria a única forma
 * de saber quais arquivos eram dela.
 */
export async function apagarPessoa(leadId: string): Promise<number> {
  // Sem o módulo de conversas não há arquivos no Storage: o `ON DELETE CASCADE`
  // leva ficha, reuniões e oportunidades. Só o gestor apaga (policy do banco).
  if (!moduloAtivo('conversas')) {
    const { error, count } = await supabase.from('contatos_dados').delete({ count: 'exact' }).eq('id', leadId)
    if (error || !count) throw new Error(error?.message ?? 'falhou')
    return 0
  }
  const { data: sessao } = await supabase.auth.getSession()
  const token = sessao.session?.access_token
  if (!token) throw new Error('sem_sessao')

  const r = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp/apagar-pessoa`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contato_id: leadId }),
    },
  )
  const d = await r.json().catch(() => null)
  if (!d?.ok) throw new Error(d?.motivo ?? 'falhou')
  return d.midias ?? 0
}

/** `68 mensagens · 3 consultas (1 já realizada) · 1 arquivo` */
export function resumoDoEstrago(p: Previsao, midias?: number): string {
  const partes: string[] = []

  if (p.mensagens > 0) partes.push(p.mensagens === 1 ? '1 mensagem' : `${p.mensagens} mensagens`)

  if (p.consultas > 0) {
    const c = p.consultas === 1 ? '1 reunião' : `${p.consultas} reuniões`
    partes.push(p.realizadas > 0
      ? `${c} (${p.realizadas} já realizada${p.realizadas > 1 ? 's' : ''})`
      : c)
  }

  partes.push(`${p.oportunidades} oportunidade${p.oportunidades === 1 ? '' : 's'}`)
  if (p.projetos > 0) partes.push(`${p.projetos} projeto${p.projetos === 1 ? '' : 's'}`)

  if (p.campanhas > 0) partes.push(`${p.campanhas} envio${p.campanhas === 1 ? '' : 's'} de campanha`)

  if (midias) partes.push(midias === 1 ? '1 arquivo' : `${midias} arquivos`)

  return partes.join(' · ')
}
