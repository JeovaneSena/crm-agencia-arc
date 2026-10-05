import {rpc} from '../_shared/db.ts'
import {destinoWebhook,processarSaidasGestao,type DepsGestao} from '../_shared/gestao.ts'
import {conferirGestao,enviarGestao} from '../_shared/gestao_canais.ts'
import {textoGestaoIA} from '../_shared/gestao_ia.ts'
const deps:DepsGestao={
 reivindicar:()=>rpc('gestao_saidas_reivindicar',{}),
 async preparar(s){
  if(s.acao.tipo==='webhook'){destinoWebhook(s.acao.destino??'',JSON.parse(Deno.env.get('GESTAO_WEBHOOKS')??'{}'));return null}
  await conferirGestao(s.contato_id)
  return s.acao.tipo==='mensagem_ia'?await textoGestaoIA(s.contato_id,s.acao.instrucao??''):s.acao.texto??''
 },
 iniciar:(s,texto)=>rpc('gestao_saida_iniciar',{p_id:s.id,p_token:s.token,p_texto:texto}),
 async enviar(s,texto){
  if(s.acao.tipo!=='webhook')return await enviarGestao(s.contato_id,texto??'')
  const u=destinoWebhook(s.acao.destino??'',JSON.parse(Deno.env.get('GESTAO_WEBHOOKS')??'{}'))
  const r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':s.id},body:JSON.stringify({evento_id:s.id,contato_id:s.contato_id}),redirect:'error',signal:AbortSignal.timeout(8000)})
  if(!r.ok)throw Error('Webhook sem confirmação');return s.id
 },
 finalizar:(s,estado,externo)=>rpc('gestao_saida_finalizar',{p_id:s.id,p_token:s.token,p_estado:estado,p_externo:externo}),
}
export async function handler(req:Request):Promise<Response>{
 const segredo=Deno.env.get('GESTAO_SEGREDO')??''
 if(req.method!=='POST'||segredo.length<24||req.headers.get('authorization')!==`Bearer ${segredo}`)return Response.json({ok:false},{status:401})
 if(!new URL(req.url).pathname.endsWith('/processar'))return Response.json({ok:false},{status:404})
 try{
  const eventos=await rpc<number>('gestao_processar',{p_limite:50})
  await rpc('gestao_manutencao',{})
  const r=await processarSaidasGestao(deps);return Response.json({ok:true,eventos,...r},{status:r.erros.length?500:200})
 }catch{return Response.json({ok:false,motivo:'erro_interno'},{status:500})}
}
if(import.meta.main)Deno.serve(handler)
