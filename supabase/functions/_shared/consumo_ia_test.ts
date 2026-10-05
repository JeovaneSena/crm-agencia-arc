import {conversarComLimite,ErroConsumo,ErroProvedor,estimarEntrada} from './consumo_ia.ts'
import {conversar} from './llm.ts'
import type {PedidoLLM} from './llm.ts'
const pedido:PedidoLLM={modelo:'gpt-test',sistema:'Teste',mensagens:[{papel:'user',conteudo:'Olá'}],ferramentas:[],maxTokens:700}
function assert(v:unknown,m='falhou'){if(!v)throw Error(m)}
Deno.test('teto/sem tarifa impede chamar modelo; reserva conta cada rodada',async()=>{
 let chamadas=0
 for(const motivo of ['teto_mensal','sem_tarifa','sem_saldo']){
  const rpc=async<T>()=>({ok:false,motivo} as T)
  try{await conversarComLimite(pedido,()=>{chamadas++;throw Error('não deveria chamar')},rpc);throw Error('deveria bloquear')}catch(e){assert(e instanceof ErroConsumo&&e.motivo===motivo)}
 }
 assert(chamadas===0)
 assert(estimarEntrada(pedido)>new TextEncoder().encode(JSON.stringify(pedido)).length)
})
Deno.test('uso medido e sem saldo finalizam reserva; timeout conserva incerteza',async()=>{
 const log:{nome:string;args:Record<string,unknown>}[]=[]
 const rpc=async<T>(nome:string,args:Record<string,unknown>)=>{log.push({nome,args});return {ok:true} as T}
 await conversarComLimite(pedido,()=>Promise.resolve({texto:'Oi',chamadas:[],uso:{entrada:10,saida:5}}),rpc)
 assert(log[1].args.p_estado==='medido')
 try{await conversarComLimite(pedido,()=>Promise.reject(new ErroProvedor(true)),rpc)}catch(e){assert(e instanceof ErroConsumo&&e.motivo==='sem_saldo')}
 assert(log.at(-1)?.args.p_estado==='sem_saldo')
 try{await conversarComLimite(pedido,()=>Promise.reject(new Error('timeout')),rpc)}catch{/* não reenvia */}
 assert(log.at(-1)?.args.p_estado==='incerto')
 await conversarComLimite(pedido,()=>Promise.resolve({texto:'Oi',chamadas:[]}),rpc)
 assert(log.at(-1)?.args.p_estado==='incerto','uso ausente não libera reserva')
})
Deno.test('adaptador OpenAI separa quota de rate limit e registra usage sem erro bruto',async()=>{
 Deno.env.set('OPENAI_API_KEY','chave-ficticia')
 // O módulo usa chaves na carga; importa uma instância nova só para este ensaio.
 const llm=await import('./llm.ts?teste-consumo')
 const original=globalThis.fetch
 try{
  globalThis.fetch=()=>Promise.resolve(Response.json({usage:{prompt_tokens:42,completion_tokens:12},choices:[{message:{content:'Oi'}}]}))
  assert((await llm.conversar(pedido)).uso?.entrada===42)
  for(const [code,saldo] of [['insufficient_quota',true],['project_spend_limit_exceeded',true],['rate_limit_exceeded',false]] as const){
   globalThis.fetch=()=>Promise.resolve(Response.json({error:{code,message:'segredo fora'}},{status:429}))
   try{await llm.conversar(pedido);throw Error('deveria falhar')}catch(e){assert(e instanceof ErroProvedor&&e.semSaldo===saldo&&!e.message.includes('segredo'))}
  }
 }finally{globalThis.fetch=original}
 void conversar
})
Deno.test('adaptador Anthropic distingue crédito, cobrança e teto de rate limit',async()=>{
 Deno.env.set('ANTHROPIC_API_KEY','chave-ficticia')
 const llm=await import('./llm.ts?teste-consumo-anthropic')
 const original=globalThis.fetch
 const p={...pedido,modelo:'claude-test'}
 try{
  globalThis.fetch=()=>Promise.resolve(Response.json({usage:{input_tokens:22,output_tokens:7},content:[{type:'text',text:'Oi'}]}))
  assert((await llm.conversar(p)).uso?.saida===7)
  for(const [status,error,saldo] of [
   [400,{message:'Your credit balance is too low'},true],
   [402,{type:'billing_error',message:'segredo fora'},true],
   [400,{message:'You have reached your specified workspace API usage limits'},true],
   [429,{details:{error_code:'enforced_spend_limit_reached'}},true],
   [429,{type:'rate_limit_error',message:'segredo fora'},false],
   [400,{type:'invalid_request_error',message:'segredo fora'},false],
  ] as const){
   globalThis.fetch=()=>Promise.resolve(Response.json({error},{status}))
   try{await llm.conversar(p);throw Error('deveria falhar')}catch(e){assert(e instanceof ErroProvedor&&e.semSaldo===saldo&&!e.message.includes('segredo'))}
  }
 }finally{globalThis.fetch=original}
})
