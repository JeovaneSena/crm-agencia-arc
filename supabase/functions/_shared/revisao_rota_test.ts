Deno.env.set('SUPABASE_URL','https://teste.supabase.co')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','ficticia')
Deno.env.set('SUPABASE_ANON_KEY','ficticia')
Deno.env.set('OPENAI_API_KEY','ficticia')
const {handler}=await import('../melhorias/index.ts')
const id='00000000-0000-4000-8000-000000000029'
Deno.test('revisão HTTP exige gestor e compara sem envio; testes só são gravados no servidor',async()=>{
 const original=globalThis.fetch
 let papel='gestor',apto=false
 const log:string[]=[]
 try{
  globalThis.fetch=(entrada,init)=>{
   const u=new URL(String(entrada));log.push(u.pathname)
   let data:unknown=[]
   if(u.pathname==='/auth/v1/user')data={id}
   else if(u.pathname.endsWith('/usuarios'))data=[{papel,ativo:true}]
   else if(u.pathname.endsWith('/assistente_melhorias'))data=[{id,contato_id:id,conteudo:'Explique o próximo passo.',estado:'rascunho'}]
   else if(u.pathname.endsWith('/assistente_melhoria_base'))data={config:{modo:'desligada',nome:'Assistente',modelo:'gpt-test',instrucoes:'Empresa teste',numeros_teste:[],max_respostas:12,espera_segundos:0,devolver_apos_minutos:null},conteudo:'',versao:id}
   else if(u.pathname.endsWith('/mensagens_whatsapp'))data=[{autor:'cliente',conteudo:'Como funciona?',tipo:'texto'}]
   else if(u.pathname.endsWith('/configuracoes_negocio'))data=[{nome_negocio:'Teste',fuso_horario:'UTC'}]
   else if(u.pathname.endsWith('/assistente_consumo_reservar'))data={ok:true}
   else if(u.pathname.endsWith('/chat/completions'))data={usage:{prompt_tokens:10,completion_tokens:5},choices:[{message:{content:'A equipe confirma os próximos passos.'}}]}
   else if(u.pathname.endsWith('/assistente_melhoria_testar')){const p=JSON.parse(String(init?.body));apto=p.p_apto;data=id}
   return Promise.resolve(Response.json(data))
  }
  const req=()=>new Request('https://teste.supabase.co/functions/v1/melhorias',{method:'POST',headers:{authorization:'Bearer ficticio'},body:JSON.stringify({proposta_id:id})})
  papel='consultor';if((await handler(req())).status!==403)throw Error('consultor compara')
  papel='gestor';if((await handler(req())).status!==200||!apto)throw Error('comparação não registrada')
  if(log.some(p=>p.includes('/send')||p.includes('/enviar')||p.endsWith('/assistente_melhoria_aprovar')))throw Error('comparação enviou/aprovou')
  if(log.filter(p=>p.endsWith('/chat/completions')).length!==2)throw Error('comparação não usou duas respostas')
 }finally{globalThis.fetch=original}
})
