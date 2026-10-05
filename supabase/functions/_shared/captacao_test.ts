import { atenderCaptacao, hashSegredo, lerCaptacao, prepararCaptacao } from './captacao.ts'

function igual(a: unknown, b: unknown) { if (JSON.stringify(a)!==JSON.stringify(b)) throw new Error(`Esperava ${JSON.stringify(b)}, recebeu ${JSON.stringify(a)}`) }
const segredo = 'a'.repeat(64)
const url = 'https://exemplo.test/functions/v1/captacao/receber/00000000-0000-4000-8000-000000000025'
const req = (body: unknown, headers: Record<string,string> = {}) => new Request(url, {method:'POST',headers:{'content-type':'application/json','x-captacao-segredo':segredo,...headers},body:JSON.stringify(body)})

Deno.test('captação normaliza campos e guarda apenas UTMs conhecidas', () => {
 const r=prepararCaptacao({Name:' Ana ',telefone:'(11) 99990-0025',email:'ANA@EXEMPLO.TEST',utm_source:'google',utm_campaign:'outubro',senha:'fora',consentimento:true})
 igual(r,{dados:{nome:'Ana',whatsapp:'5511999900025',email:'ana@exemplo.test',empresa:null,utm:{utm_source:'google',utm_campaign:'outubro'}},motivo:null,evento:null})
})
Deno.test('recusa dados inválidos sem jogar campos desconhecidos no histórico', () => {
 igual(prepararCaptacao([]).motivo,'formato_invalido')
 igual(prepararCaptacao({whatsapp:'123'}).motivo,'telefone_invalido')
 igual(prepararCaptacao({whatsapp:'5511999900025',email:'errado'}).motivo,'email_invalido')
 igual(prepararCaptacao({whatsapp:'5511999900025',nome:'a'.repeat(201),event_id:'evt'}),{dados:null,motivo:'campo_longo',evento:'evt'})
})
Deno.test('hash SHA-256 determinístico',async()=>igual(await hashSegredo('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'))
Deno.test('JSON e formulário plano; limite é por bytes lidos',async()=>{
 igual(await lerCaptacao(new Request(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'nome=Ana&whatsapp=5511999900025'})),{nome:'Ana',whatsapp:'5511999900025'})
 for(const [tipo,body,status] of [['application/json','{',400],['text/plain','x',415],['application/json','é'.repeat(9000),413]] as const){
  const r=await atenderCaptacao(new Request(url,{method:'POST',headers:{'content-type':tipo,'x-captacao-segredo':segredo},body}),()=>{throw Error('não deve chamar banco')})
  igual(r.status,status)
 }
})
Deno.test('método, segredo e rota recusados antes de chamar banco',async()=>{
 const banco=()=>{throw Error('não deve chamar banco')}
 igual((await atenderCaptacao(new Request(url),banco)).status,405)
 igual((await atenderCaptacao(req({}, {'x-captacao-segredo':''}),banco)).status,401)
 igual((await atenderCaptacao(new Request('https://exemplo.test/captacao/outra',{method:'POST'}),banco)).status,404)
})
Deno.test('fronteira HTTP chama RPC com hash e resultado sem dados pessoais',async()=>{
 let args: Record<string,unknown>={}
 const r=await atenderCaptacao(req({nome:'Ana',whatsapp:'5511999900025',event_id:'evt'}),async(nome,a)=>{igual(nome,'captacao_receber');args=a;return {resultado:'criado',repetido:false}})
 igual(args.p_hash,await hashSegredo(segredo));igual(args.p_evento,'evt')
 igual(r.status,200);igual(await r.json(),{ok:true,resultado:'criado',repetido:false})
 for(const [resultado,status] of [['nao_autorizado',401],['limite',429],['recusado',422]] as const)
  igual((await atenderCaptacao(req({whatsapp:'123'}),async()=>({resultado}))).status,status)
})

Deno.test('referência exige código fechado e Meta tem precedência; guarda apenas IDs', async () => {
 const { prepararOrigem } = await import('./captacao.ts')
 igual(prepararOrigem('Oi [ref:landing-outubro]',null),{canal:'referencia',referencia:'landing-outubro'})
 igual(prepararOrigem('[ref:abc<script>]',null),null)
 igual(prepararOrigem('[ref:a]',null),null)
 igual(prepararOrigem(null,{source_type:'ad',source_id:'123',ctwa_clid:'click_26',source_url:'javascript:x',body:'fora'}),{canal:'meta',meta:{source_type:'ad',source_id:'123',ctwa_clid:'click_26'}})
 igual(prepararOrigem('[ref:landing]',{source_type:'ad',source_id:'123'}),{canal:'meta',meta:{source_type:'ad',source_id:'123'}})
 igual(prepararOrigem('[ref:landing]',{source_type:'ad',source_id:'invalido'}),{canal:'referencia',referencia:'landing'})
 igual(prepararOrigem(null,{source_type:'post',source_id:'321',ctwa_clid:'x'.repeat(513)}),{canal:'meta',meta:{source_type:'post',source_id:'321'}})
})
