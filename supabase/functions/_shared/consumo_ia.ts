import type { PedidoLLM, RespostaLLM } from './llm.ts'
export class ErroConsumo extends Error {
 constructor(readonly motivo: string) { super(motivo) }
}
export interface UsoIA { entrada: number; saida: number }
export class ErroProvedor extends Error {
 constructor(readonly semSaldo: boolean, readonly incerto=false) { super(semSaldo?'provedor_sem_saldo':'provedor_indisponivel') }
}
export function estimarEntrada(pedido: PedidoLLM): number {
 // Um token não pode ocupar menos de um byte UTF-8; folga para papéis e esquema.
 return new TextEncoder().encode(JSON.stringify(pedido)).length+2048
}
type RpcConsumo = <T>(nome:string,args:Record<string,unknown>)=>Promise<T>
export async function conversarComLimite(pedido: PedidoLLM, modelo: (p:PedidoLLM)=>Promise<RespostaLLM>, rpc: RpcConsumo): Promise<RespostaLLM> {
 const id=crypto.randomUUID()
 const r=await rpc<{ok:boolean;motivo:string}>('assistente_consumo_reservar',{p_id:id,p_modelo:pedido.modelo,p_entrada:estimarEntrada(pedido),p_saida:pedido.maxTokens??2048})
 if (!r.ok) throw new ErroConsumo(r.motivo)
 let resposta: RespostaLLM
 try { resposta=await modelo(pedido) } catch(e) {
  const saldo=e instanceof ErroProvedor && e.semSaldo
  await rpc('assistente_consumo_finalizar',{p_id:id,p_uso:null,p_estado:saldo?'sem_saldo':'incerto'})
  if(saldo)throw new ErroConsumo('sem_saldo')
  throw e
 }
 // A chamada já ocorreu: não libera a reserva se medição/gravação ficar incerta.
 await rpc('assistente_consumo_finalizar',{p_id:id,p_uso:resposta.uso??null,p_estado:resposta.uso?'medido':'incerto'})
 return resposta
}
