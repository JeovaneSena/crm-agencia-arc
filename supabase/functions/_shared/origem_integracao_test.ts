Deno.env.set('SUPABASE_URL','https://teste.supabase.co')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','ficticia')
const { contatoComOrigem } = await import('./origem_captacao.ts')
Deno.test('gancho envia somente origem validada e IA ao RPC; falha propaga para reenvio',async()=>{
 const original=globalThis.fetch
 const chamadas: Record<string,unknown>[]=[]
 try {
  globalThis.fetch=async(_url,init)=>{chamadas.push(JSON.parse(String(init?.body)));return Response.json('contato-26')}
  if(await contatoComOrigem('5511999990026','Olá [ref:landing]',null,{ia_ligada:true,segredo:'fora'})!=='contato-26') throw Error('contato perdido')
  if(JSON.stringify(chamadas[0])!==JSON.stringify({p_whatsapp:'5511999990026',p_origem:{canal:'referencia',referencia:'landing'},p_ia:true})) throw Error('contrato inválido')
  await contatoComOrigem('5511999990026',null,{source_type:'ad',source_id:'123'})
  if((chamadas[1].p_origem as {canal:string}).canal!=='meta'||chamadas[1].p_ia!==false) throw Error('Meta não encaminhada')
  globalThis.fetch=()=>Promise.resolve(new Response('falhou',{status:503}))
  let falhou=false
  try {await contatoComOrigem('5511999990026',null)} catch {falhou=true}
  if(!falhou) throw Error('falha ocultada; webhook não reenviaria')
 } finally {globalThis.fetch=original}
})
