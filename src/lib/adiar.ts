/**
 * Adiar conversa: regras puras (testadas em `scripts/testes/lib_test.ts`). O banco valida de verdade
 * (`conversa_adiar`, migração 0016: futuro, até 30 dias); aqui só se monta o que a tela oferece.
 *
 * Os horários seguem o relógio de quem usa a tela: "amanhã às 9h" é as 9h de quem está olhando.
 */
export interface OpcaoDeAdiamento { id: string; rotulo: string; ate: Date }

const as9h = (d: Date) => { const r = new Date(d); r.setHours(9, 0, 0, 0); return r }

export function opcoesDeAdiamento(agora: Date): OpcaoDeAdiamento[] {
  const em = (horas: number) => new Date(agora.getTime() + horas * 3_600_000)
  const amanha = as9h(new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1))
  const em3Dias = as9h(new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 3))
  // Próxima segunda-feira, sempre depois de hoje (hoje segunda = segunda que vem).
  const faltam = ((8 - agora.getDay()) % 7) || 7
  const segunda = as9h(new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + faltam))
  return [
    { id: '1h', rotulo: 'Daqui a 1 hora', ate: em(1) },
    { id: '3h', rotulo: 'Daqui a 3 horas', ate: em(3) },
    { id: 'amanha', rotulo: 'Amanhã, 9h', ate: amanha },
    { id: '3d', rotulo: 'Em 3 dias, 9h', ate: em3Dias },
    { id: 'segunda', rotulo: 'Segunda-feira, 9h', ate: segunda },
  ]
}

/** A conversa está adiada agora? (`adiada_ate` no futuro.) */
export function estaAdiada(c: { adiada_ate?: string | null }, agora = Date.now()): boolean {
  return !!c.adiada_ate && Date.parse(c.adiada_ate) > agora
}
