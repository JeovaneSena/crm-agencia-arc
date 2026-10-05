// Ensaiar apenas em uma instalação gerada localmente; fetch é simulado, sem rede.
Deno.env.set('SUPABASE_URL','https://teste.supabase.co')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','ficticia')
Deno.env.set('WEBHOOK_SEGREDO','segredo-de-teste')
Deno.env.set('META_APP_SECRET','app-secret-de-teste')
Deno.env.set('META_WABA_ID','456')
Deno.env.set('META_PHONE_NUMBER_ID','123')
const raiz = Deno.env.get('CRM_TEST_INSTALACAO')
if (!raiz || !raiz.startsWith('/')) throw Error('Informe CRM_TEST_INSTALACAO: caminho absoluto da instalação de ensaio com captação, conversas, assistente e campanhas.')
const {handler: uaz}=await import(`${raiz}/supabase/functions/whatsapp/index.ts`)
const {handler: meta}=await import(`${raiz}/supabase/functions/campanhas/index.ts`)
Deno.test('instalação completa: uazapi e Meta chamam criação atômica com origem; reenvio preserva RPC',async()=>{
 const original=globalThis.fetch
 const log:{path:string;body:Record<string,unknown>}[]=[]
 let repetida=false
 try {
  globalThis.fetch=(entrada,init)=>{
   const path=new URL(String(entrada)).pathname
   const body=JSON.parse(String(init?.body ?? '{}'));log.push({path,body})
   if(path.endsWith('/captacao_contato_whatsapp'))return Promise.resolve(Response.json('00000000-0000-4000-8000-000000000026'))
   if(path.endsWith('/mensagens_whatsapp'))return Promise.resolve(Response.json(repetida?[]:[{id:'msg-26'}]))
   return Promise.resolve(Response.json([]))
  }
  const msg={event:'messages',message:{chatid:'5511999990026@s.whatsapp.net',messageid:'EXT26',messageType:'Conversation',text:'Olá [ref:landing-26]'}}
  const req=()=>new Request('https://teste.supabase.co/functions/v1/whatsapp',{method:'POST',headers:{'content-type':'application/json','x-webhook-segredo':'segredo-de-teste'},body:JSON.stringify(msg)})
  if((await uaz(req())).status!==200)throw Error('uaz recusou')
  let origem=log.find(c=>c.path.endsWith('/captacao_contato_whatsapp'))?.body.p_origem
  if(JSON.stringify(origem)!==JSON.stringify({canal:'referencia',referencia:'landing-26'}))throw Error('referência não encaminhada')
  repetida=true
  if((await (await uaz(req())).json()).ignorado!=='duplicada')throw Error('reenvio não deduplicado')
  repetida=false
  const raw=JSON.stringify({object:'whatsapp_business_account',entry:[{id:'456',changes:[{field:'messages',value:{metadata:{phone_number_id:'123'},messages:[{id:'wamid.ref26',from:'5511999990026',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Olá'},referral:{source_type:'ad',source_id:'987',ctwa_clid:'click_26',source_url:'fora'}}]}}]}]})
  const chave=await crypto.subtle.importKey('raw',new TextEncoder().encode('app-secret-de-teste'),{name:'HMAC',hash:'SHA-256'},false,['sign'])
  const sig=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',chave,new TextEncoder().encode(raw))),b=>b.toString(16).padStart(2,'0')).join('')
  const res=await meta(new Request('https://teste.supabase.co/functions/v1/campanhas/webhook',{method:'POST',headers:{'x-hub-signature-256':'sha256='+sig},body:raw}))
  if(res.status!==200)throw Error('Meta recusou: '+await res.text())
  origem=log.filter(c=>c.path.endsWith('/captacao_contato_whatsapp')).at(-1)?.body.p_origem
  if(JSON.stringify(origem)!==JSON.stringify({canal:'meta',meta:{source_type:'ad',source_id:'987',ctwa_clid:'click_26'}}))throw Error('Meta não encaminhada')
  if(log.some(c=>c.path.endsWith('/contatos_dados')&&c.body.whatsapp))throw Error('criação fora da transação de origem')
 }finally{globalThis.fetch=original}
})
