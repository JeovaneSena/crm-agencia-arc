import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

/**
 * A conexão com o WhatsApp: está de pé, quem está conectado, e como religar.
 *
 * ── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
 *
 * Em 01/09 o servidor da ponte com o WhatsApp caiu, e o único sintoma foi
 * **silêncio**: mensagem enviada, nenhuma resposta, e nada de anormal em tela
 * nenhuma. A página da Secretária continuou dizendo "está atendendo", porque
 * ela só conhecia o nosso liga/desliga.
 *
 * Atender depende de duas coisas, e a tela só sabia de uma. Este arquivo é a
 * outra.
 *
 * ── TUDO PASSA PELA EDGE FUNCTION ──────────────────────────────────────────
 *
 * A chave da ponte é de servidor. Falar com ela do navegador exigiria pôr a
 * chave no bundle, e quem tem a chave **manda mensagem por aquele WhatsApp**.
 * Mesmo motivo da `fotoDoPerfil()`, em `conversas.ts`.
 */

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp`

/**
 * `desconectado` e `indisponivel` parecem a mesma coisa e **não são** — cada um
 * manda a pessoa para um lugar diferente:
 *
 * - `desconectado` — a ponte respondeu, mas a sessão do WhatsApp caiu.
 *   Resolve aqui mesmo, reconectando.
 * - `indisponivel` — a ponte não respondeu. Nenhum botão desta tela adianta:
 *   quem precisa subir é o servidor, no painel da hospedagem.
 *
 * Confundir os dois faz a pessoa clicar em "Reconectar" dez vezes enquanto o
 * problema está em outro lugar.
 */
export type EstadoConexao =
  | 'verificando'
  | 'conectado'
  | 'conectando'
  | 'desconectado'
  | 'indisponivel'
  | 'nao_configurado'

export interface Conexao {
  /** Chave do provedor no banco: `meta` ou `uazapi`. */
  provedor: string
  estado: EstadoConexao
  ultimo_evento?: string | null
  callback_url?: string
  pendencias?: {id:string;erro:string|null;estado:string;criado_em:string;contato_id?:string|null}[]
  numero: string | null
  perfil: string | null
  foto: string | null

  // Como a ponte está configurada. Vem das secrets da Edge Function, nunca do
  // banco — três respostas que só interessam quando algo quebra.
  /** Host da API, sem protocolo. Não é segredo: quem protege é a chave. */
  servidor: string | null
  /** Qual das instâncias do servidor é a nossa. */
  instancia: string | null
  /** Os QUATRO últimos caracteres da chave. Serve para identificar, não para usar. */
  chaveFinal: string | null

  /**
   * A ponte avisa ESTE sistema quando chega mensagem?
   *
   * A TERCEIRA condição para atender, depois do agente ligado e do WhatsApp
   * conectado. Sem ela o card diz "Conectado", em verde, e o cliente recebe
   * silêncio — nada chega no banco, nada aparece em Conversas.
   *
   * `desconhecido` é o servidor não ter respondido: a tela **cala a boca** em
   * vez de acusar um problema que talvez não exista.
   *
   * ⚠️ A URL do webhook **nunca** vem para cá: ela carrega o segredo dentro. O
   * servidor manda só o veredito.
   */
  webhook: VeredictoWebhook
}

export type VeredictoWebhook = 'apontado' | 'outro' | 'ausente' | 'desconhecido'

/**
 * O nome de cada ponte **como se escreve na tela**.
 *
 * A seção se chama "Conexão do WhatsApp" — o nome do fornecedor não é título,
 * é dado. Mas ele precisa aparecer: quando cai, é ele que diz em qual painel
 * ir olhar. "WhatsApp desconectado", sozinho, não responde essa pergunta.
 */
export const NOME_PROVEDOR: Record<string, string> = {
  meta: 'Meta oficial',
  uazapi: 'uazapi',
}

export function nomeDoProvedor(chave: string): string {
  return NOME_PROVEDOR[chave] ?? chave
}

/** `true` quando o assistente consegue receber e responder. */
export function conexaoDePe(c: Conexao | null): boolean {
  return c?.estado === 'conectado'
}

async function comSessao(caminho: string, init?: RequestInit): Promise<Response> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('sem_sessao')

  return fetch(`${BASE}${caminho}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
}

/** Estado atual. Nunca lança: falha de rede também é uma resposta ('indisponivel'). */
export async function lerConexao(): Promise<Conexao> {
  const cair = (estado: EstadoConexao): Conexao => ({
    provedor: '', estado, numero: null, perfil: null, foto: null,
    servidor: null, instancia: null, chaveFinal: null, webhook: 'desconhecido',
  })

  try {
    const r = await comSessao('/conexao')
    const d = await r.json()
    if (!d?.ok) return cair('indisponivel')
    return {
      provedor: d.provedor ?? '',
      ultimo_evento:d.ultimo_evento, callback_url:d.callback_url, pendencias:d.pendencias,
      estado: (d.estado ?? 'indisponivel') as EstadoConexao,
      numero: d.numero ?? null,
      perfil: d.perfil ?? null,
      foto: d.foto ?? null,
      servidor: d.servidor ?? null,
      instancia: d.instancia ?? null,
      chaveFinal: d.chaveFinal ?? null,
      webhook: (d.webhook ?? 'desconhecido') as VeredictoWebhook,
    }
  } catch {
    return cair('indisponivel')
  }
}

/**
 * Abre o pareamento.
 *
 * Com o número, volta um **código de 8 dígitos** para digitar no celular — que
 * é melhor num painel de computador do que apontar a câmera para o monitor. O
 * QR volta junto como reserva: nem toda conta aceita o código.
 */
export async function conectar(
  numero?: string,
): Promise<{ codigo: string | null; qr: string | null }> {
  const r = await comSessao('/conexao/conectar', {
    method: 'POST',
    body: JSON.stringify({ numero: numero ?? '' }),
  })
  const d = await r.json()
  if (!d?.ok) throw new Error(d?.motivo ?? 'falhou')
  return { codigo: d.codigo ?? null, qr: d.qr ?? null }
}

/** Encerra a sessão do WhatsApp. A instância continua de pé, pronta para parear. */
export async function desconectar(): Promise<void> {
  const r = await comSessao('/conexao/desconectar', { method: 'POST' })
  const d = await r.json()
  if (!d?.ok) throw new Error(d?.motivo ?? 'falhou')
}

/**
 * De quanto em quanto tempo a tela pergunta se a ponte está de pé.
 *
 * **Um minuto, e o mesmo para as duas telas que olham.** Foram 30s aqui e 60s
 * na faixa de Conversas, sem que nada justificasse a diferença — e dois números
 * para a mesma pergunta são a garantia de que um dia alguém mude só um.
 *
 * Cada verificação são duas chamadas à ponte (estado + webhook). O preço de
 * esticar é a queda demorar até um minuto para aparecer na tela; para uma queda
 * que importa, um minuto não é nada.
 */
export const INTERVALO_PADRAO = 60_000

/**
 * Quanto tempo a conexão precisa ficar caída antes de virar aviso na tela.
 *
 * **Um minuto — e ele é o piso, não um número escolhido no meio da faixa.**
 * ⚠️ O prazo **não pode ser menor que `INTERVALO_PADRAO`**: abaixo da cadência
 * ele não espera nada, porque a primeira leitura ruim já o estouraria. Igual à
 * cadência, são **duas leituras ruins seguidas** antes de a faixa nascer.
 *
 * Começou em quatro minutos, pelo medo certo: a ponte pisca — o servidor
 * reinicia, a rede oscila, o WhatsApp derruba a sessão por um instante e volta
 * —, e faixa que aparece à toa é faixa que ninguém lê no dia em que ela
 * importa. Só que o custo do outro lado é maior e é imediato: enquanto a faixa
 * espera, ninguém na empresa sabe que o WhatsApp parou, e cada minuto ali é um
 * cliente escrevendo para o vazio. Piscada que dura um minuto inteiro é rara;
 * queda de verdade que dura quatro, não.
 */
export const ESPERA_ANTES_DE_AVISAR = 60_000

/**
 * Onde o começo da queda fica guardado entre carregamentos da página.
 *
 * ⚠️ **SEM ISTO O AVISO QUASE NUNCA APARECE**, e o motivo é o comportamento
 * mais natural do mundo: a pessoa vê que caiu, dá F5 para conferir, e o relógio
 * volta ao zero — junto com a espera inteira, toda vez.
 *
 * A versão anterior guardava só em memória, e a justificativa parecia boa — "a
 * aba fechada não observa nada, afirmar que está caído há um minuto sem ter
 * olhado seria inventar". Só que o efeito prático era um aviso que não avisa.
 *
 * `localStorage` porque a informação é **desta máquina e deste navegador**: é o
 * relógio de quem está olhando, não um dado da empresa. Falha em silêncio no
 * modo privado — e aí o relógio vale só enquanto a aba estiver aberta, que é
 * exatamente o comportamento de antes.
 */
const CHAVE_QUEDA = 'odonto:whatsapp-caiu-em'

function lerQuedaGuardada(): number | null {
  try {
    const valor = Number(localStorage.getItem(CHAVE_QUEDA))
    return Number.isFinite(valor) && valor > 0 ? valor : null
  } catch {
    return null
  }
}

function guardarQueda(instante: number | null): void {
  try {
    if (instante === null) localStorage.removeItem(CHAVE_QUEDA)
    else localStorage.setItem(CHAVE_QUEDA, String(instante))
  } catch {
    // Modo privado, ou storage cheio. O relógio passa a valer só nesta aba.
  }
}

/**
 * `a cada 1 minuto`, para a frase embaixo do botão.
 *
 * Sai do intervalo de verdade porque a versão digitada à mão já mentiu: a tela
 * dizia "30 segundos" enquanto o valor era outro. Número que aparece em dois
 * lugares só fica certo por acaso.
 */
export function cadenciaEmPalavras(ms: number): string {
  const segundos = Math.round(ms / 1000)
  if (segundos < 60) return `a cada ${segundos} segundos`
  const minutos = Math.round(segundos / 60)
  return minutos === 1 ? 'a cada 1 minuto' : `a cada ${minutos} minutos`
}

/**
 * Acompanha a conexão, com atualização automática.
 *
 * **Só consulta com a aba visível.** Cada verificação é uma chamada à ponte;
 * manter isso rodando em aba esquecida em segundo plano é gastar à toa. Ao
 * voltar para a aba, consulta na hora — quem volta quer o estado de agora, não
 * o de meia hora atrás.
 *
 * ── QUEM CHEGA NO MEIO ESPERA; NÃO É DESCARTADO ────────────────────────────
 *
 * Uma verificação de cada vez, porque servidor fora demora até o timeout e sem
 * trava as consultas se empilhariam justo quando ele está lento. Mas a trava
 * **devolve a que está em voo** em vez de sair calada: era assim que o clique
 * no "Verificar" sumia sem deixar rastro — caía exatamente no meio segundo em
 * que a consulta automática estava rodando, e a tela ficava igual.
 */
export function useConexao(intervaloMs = INTERVALO_PADRAO) {
  const [conexao, setConexao] = useState<Conexao | null>(null)
  const [verificando, setVerificando] = useState(false)
  const [verificadoEm, setVerificadoEm] = useState<Date | null>(null)
  const [caidaDesde, setCaidaDesde] = useState<number | null>(null)
  const emVoo = useRef<Promise<void> | null>(null)

  const recarregar = useCallback((): Promise<void> => {
    if (emVoo.current) return emVoo.current

    const tarefa = (async () => {
      setVerificando(true)
      try {
        const nova = await lerConexao()
        setConexao(nova)
        // Falhou também é ter verificado: `lerConexao` nunca lança, devolve
        // 'indisponivel'. O horário é de quando perguntamos, não de quando deu
        // certo — é a informação que a pessoa quer ao clicar de novo.
        setVerificadoEm(new Date())

        // A contagem da queda mora aqui, e não em quem exibe o aviso, porque é
        // aqui que a leitura chega. Uma queda que continua é a MESMA queda:
        // `?? Date.now()` só marca se ainda não havia marca — remarcar a cada
        // leitura ruim adiaria o aviso para sempre.
        //
        // `conectando` não é queda: alguém está pareando agora, e zerar o
        // relógio no meio disso é o comportamento certo.
        setCaidaDesde((atual) => {
          if (nova.estado === 'conectado' || nova.estado === 'conectando') {
            guardarQueda(null)
            return null
          }
          // A ordem importa: o que está na memória vale mais que o guardado
          // (é desta sessão), e o guardado vale mais que agora (senão o F5
          // devolveria o relógio para o zero).
          const marco = atual ?? lerQuedaGuardada() ?? Date.now()
          guardarQueda(marco)
          return marco
        })
      } finally {
        setVerificando(false)
      }
    })().finally(() => { emVoo.current = null })

    emVoo.current = tarefa
    return tarefa
  }, [])

  useEffect(() => {
    let vivo = true
    const consultar = () => { if (vivo && !document.hidden) void recarregar() }

    consultar()
    const id = setInterval(consultar, intervaloMs)
    document.addEventListener('visibilitychange', consultar)

    return () => {
      vivo = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', consultar)
    }
  }, [recarregar, intervaloMs])

  return { conexao, recarregar, verificando, verificadoEm, intervaloMs, caidaDesde }
}
