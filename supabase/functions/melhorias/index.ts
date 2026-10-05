import { usuarioDaSessao } from '../_shared/sessao.ts'
import { selecionar,rpc } from '../_shared/db.ts'
import { depsDoBanco } from '../_shared/gancho_assistente.ts'
import { compararMelhoria } from '../_shared/revisao_ia.ts'
import type { ConfigIA } from '../_shared/assistente.ts'
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'}
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:CORS})
export async function handler(req:Request):Promise<Response> {
 if(req.method==='OPTIONS')return new Response('ok',{headers:CORS})
 if(req.method!=='POST')return json({ok:false},405)
 const u=await usuarioDaSessao(req)
 if(!u||u.papel!=='gestor')return json({ok:false,motivo:'Somente gestor compara melhorias.'},403)
 try {
  const body=await req.json()
  if(typeof body.proposta_id!=='string'||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.proposta_id))return json({ok:false},422)
  const s=(await selecionar<{id:string;contato_id:string;conteudo:string;estado:string}>(`assistente_melhorias?select=id,contato_id,conteudo,estado&id=eq.${body.proposta_id}&limit=1`))[0]
  if(!s||!['rascunho','testada'].includes(s.estado))return json({ok:false,motivo:'Proposta indisponível.'},422)
  const base=await rpc<{config:Record<string,unknown>;conteudo:string;versao:string}>('assistente_melhoria_base',{})
  const c=base.config
  const config:ConfigIA={modo:c.modo as ConfigIA['modo'],nome:String(c.nome),modelo:String(c.modelo),instrucoes:c.instrucoes as string|null,numerosTeste:c.numeros_teste as string[],maxRespostas:Number(c.max_respostas),esperaSegundos:Number(c.espera_segundos),devolverAposMinutos:c.devolver_apos_minutos as number|null}
  const resultado=await compararMelhoria(depsDoBanco(),s.contato_id,config,base.conteudo,s.conteudo)
  const teste=await rpc<string>('assistente_melhoria_testar',{p_proposta:s.id,p_base:base,p_candidato:s.conteudo,p_resultado:resultado,p_apto:resultado.apto})
  return json({ok:true,teste_id:teste,...resultado})
 }catch{return json({ok:false,motivo:'Não foi possível comparar. Confira orçamento, saldo e configuração; nenhuma mensagem foi enviada.'},503)}
}
if(import.meta.main)Deno.serve(handler)
