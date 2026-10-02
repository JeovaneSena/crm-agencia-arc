import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ServerCrash, PlugZap, Unplug } from 'lucide-react'
import {
  useConexao, nomeDoProvedor, ESPERA_ANTES_DE_AVISAR,
} from '../lib/whatsappConexao'

/**
 * A faixa vermelha do topo do sistema, quando o WhatsApp cai.
 *
 * ── POR QUE ELA EXISTE ─────────────────────────────────────────────────────
 *
 * Em 01/09/2026 a ponte com o WhatsApp caiu e o único sintoma foi **silêncio**.
 * Mensagem enviada, nenhuma resposta, e nada de anormal em tela nenhuma. A
 * página da Secretária continuava dizendo "está atendendo", porque só conhecia
 * o nosso liga/desliga.
 *
 * ── POR QUE NO TOPO DO SISTEMA, E NÃO SÓ EM CONVERSAS ──────────────────────
 *
 * Ela morava dentro de Conversas — a aposta era que a recepção passa o dia ali.
 * A aposta não é ruim, mas é uma aposta: quem estiver na Agenda, no CRM ou no
 * Dashboard não via nada. Como casca do sistema, ela alcança quem quer que
 * esteja logado, na tela em que estiver.
 *
 * ── E POR QUE ELA DEMORA ───────────────────────────────────────────────────
 *
 * Um minuto de queda contínua (`ESPERA_ANTES_DE_AVISAR`) antes de aparecer — o
 * mesmo intervalo da verificação, ou seja, duas leituras ruins seguidas. A
 * ponte pisca, e uma faixa que aparece a cada piscada é uma faixa que a equipe
 * aprende a ignorar; mas esperar demais é deixar a empresa sem saber que o
 * WhatsApp parou, com cliente escrevendo para o vazio.
 *
 * **Silenciosa quando está tudo bem**, e silenciosa enquanto verifica: piscar
 * "caiu" a cada carregamento de página, antes da primeira resposta, seria
 * alarme falso todo dia. Mesmo princípio do `AvisoBaixaConsulta`.
 */

const FONTE = "var(--font-body)"

/** Os estados em que nada entra nem sai. `conectando` não entra: ele é transição. */
const CAIDO = ['desconectado', 'indisponivel', 'nao_configurado']

export default function AvisoWhatsAppCaiu() {
  const { conexao, caidaDesde, verificadoEm } = useConexao()
  const estado = conexao?.estado

  // `verificando` (antes da primeira resposta) e `conectando` (alguém está
  // pareando agora) não acendem a faixa: piscar "caiu" a cada carregamento de
  // página seria alarme falso todo dia.
  const caido = !!estado && CAIDO.includes(estado)

  // ── O prazo ───────────────────────────────────────────────────────────────
  //
  // `agora` não é "agora": é o instante em que o relógio do prazo tocou. Nasce
  // em zero, então `agora - caidaDesde` é negativo e nada aparece; quando o
  // tempo vence, o setTimeout grava o instante e a conta vira verdadeira.
  //
  // Guardar o INSTANTE, e não um "já venceu" booleano, é o que dispensa
  // desligar a faixa na mão: a queda seguinte tem um `caidaDesde` mais novo
  // que este `agora`, e a conta volta a ser falsa sozinha. Sem isso, a segunda
  // queda apareceria na hora, sem esperar o minuto.
  const [agora, setAgora] = useState(0)

  useEffect(() => {
    if (caidaDesde === null) return
    const falta = ESPERA_ANTES_DE_AVISAR - (Date.now() - caidaDesde)
    if (falta <= 0) return
    // Relógio próprio: sem ele a faixa nasceria na consulta seguinte ao
    // vencimento — até um minuto atrasada, por uma diferença de milissegundos.
    const id = setTimeout(() => { setAgora(Date.now()) }, falta)
    return () => { clearTimeout(id) }
  }, [caidaDesde])

  // Dois relógios, e vale o que estiver mais adiantado.
  //
  // O `setTimeout` é o pontual: acende a faixa no minuto exato. Mas ele é um
  // disparo só — se por qualquer motivo não vier (aba suspensa pelo navegador,
  // efeito remontado, temporizador estrangulado em segundo plano), a faixa
  // ficaria escondida para sempre com a conexão caída.
  //
  // O `verificadoEm` é o teimoso: muda a cada consulta, uma por minuto, e
  // sozinho já garante que a faixa apareça — no máximo uma consulta depois da
  // hora. Um cobre a falha do outro.
  const marcoDoPrazo = Math.max(agora, verificadoEm?.getTime() ?? 0)
  const venceuOPrazo =
    caidaDesde !== null && marcoDoPrazo - caidaDesde >= ESPERA_ANTES_DE_AVISAR

  if (!caido || !venceuOPrazo) return null

  const provedor = nomeDoProvedor(conexao?.provedor ?? 'meta')

  const { Icone, frase } =
    estado === 'indisponivel'
      ? {
          Icone: ServerCrash,
          frase: `O servidor da ${provedor} não está respondendo. Nenhuma mensagem entra nem sai enquanto isso, e nenhum botão do sistema resolve — quem precisa subir é ele.`,
        }
      : estado === 'nao_configurado'
        ? {
            Icone: Unplug,
            frase: `A ${provedor} está selecionada, mas as chaves dela não foram configuradas no servidor. Nada entra nem sai enquanto isso.`,
          }
        : {
            Icone: PlugZap,
            frase: 'A sessão caiu. Nenhuma mensagem entra nem sai até religar — dá para fazer isso pelo próprio sistema.',
          }

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, flexShrink: 0,
      background: 'var(--danger-soft)', borderBottom: '1px solid var(--danger-border)',
      padding: '11px 20px', fontFamily: FONTE,
    }}>
      <Icone size={16} color="var(--danger)" style={{ flexShrink: 0, marginTop: 1 }} />

      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--danger)' }}>
          O WhatsApp da empresa está desconectado
        </div>
        <div style={{ fontSize: 12, color: 'var(--danger)', opacity: 0.9, lineHeight: 1.55, marginTop: 2 }}>
          {frase}{' '}
          <Link to="/secretaria-ia" style={{ color: 'var(--danger)', fontWeight: 700 }}>
            Ver a conexão
          </Link>
        </div>
      </div>
    </div>
  )
}
