import { prepararAutomacao, preencherAutomacao, processarAutomacoes, type DepsAutomacoes, type ContextoAutomacao, type EnvioAutomacao } from './automacoes.ts'
import { handler } from '../automacoes/index.ts'
const assert=(v:unknown,m='Falha')=>{if(!v) throw Error(m)}
const e: EnvioAutomacao={id:'envio',token:'token',regra_id:'regra',contato_id:'contato',reuniao_id:'reuniao',oportunidade_id:null,referencia_em:'2026-10-05T15:00:00Z'}
const c: ContextoAutomacao={regra:{id:'regra',nome:'Lembrete',tipo:'lembrete',ativa:true,canal:'uazapi',minutos:60,etapa:null,texto:'Oi {{primeiro_nome}}, {{assunto}} dia {{dia}} às {{hora}}.',modelo_nome:null,modelo_idioma:'pt_BR',parametros:{},created_at:'2026-10-04'},numero:'5511999999999',nome:'Ana Silva',assunto:'Reunião',fuso:'America/Sao_Paulo',ultimaMensagem:null}
const throws=(fn:()=>unknown)=>{let erro=false;try{fn()}catch{erro=true}assert(erro,'Deveria recusar')}
Deno.test('texto usa o fuso e recusa variáveis desconhecidas ou vazias',()=>{
 assert(prepararAutomacao(e,c,[]).texto==='Oi Ana, Reunião dia 05/10/2026 às 12:00.')
 throws(()=>preencherAutomacao('Oi {{foo}}',{})); throws(()=>preencherAutomacao('{{nome}}',{nome:''}))
 throws(()=>preencherAutomacao('Olá {{nome}}, podemos confirmar?',{nome:''}))
 throws(()=>preencherAutomacao('Olá {{nome}}, podemos confirmar?',{nome:'   '}))
 throws(()=>prepararAutomacao(e,{...c,nome:null},[]))
 throws(()=>prepararAutomacao(e,{...c,ultimaMensagem:'SAIR'},[]))
})
Deno.test('Meta exige aprovação e UTILITY para reunião; preenche parâmetros',()=>{
 const meta={...c,regra:{...c.regra,canal:'meta' as const,modelo_nome:'lembrete',parametros:{body:['{{nome}}','{{hora}}']}}}
 const m={id:'1',name:'lembrete',language:'pt_BR',category:'UTILITY',status:'APPROVED',components:[{type:'BODY',text:'Olá {{1}}, reunião às {{2}}.'}]}
 assert(prepararAutomacao(e,meta,[m]).texto==='Olá Ana Silva, reunião às 12:00.')
 throws(()=>prepararAutomacao(e,meta,[{...m,status:'PENDING'}])); throws(()=>prepararAutomacao(e,meta,[{...m,category:'MARKETING'}]))
 throws(()=>prepararAutomacao(e,meta,[]))
})
function fixture(overrides:Partial<DepsAutomacoes>={}) {
 const eventos:string[]=[]
 const d:DepsAutomacoes={reivindicar:async()=>[e],contexto:async()=>c,modelos:async()=>[],bloquear:async()=>{eventos.push('bloquear')},marcar:async()=>{eventos.push('marcar');return 'mensagem'},enviar:async()=>{eventos.push('enviar');return 'externo'},finalizar:async(_,estado)=>{eventos.push(estado)},...overrides}
 return {d,eventos}
}
Deno.test('processamento confirma antes de HTTP e finaliza sucesso',async()=>{
 const {d,eventos}=fixture();const r=await processarAutomacoes(d);assert(r.enviados===1);assert(eventos.join(',')==='marcar,enviar,enviado')
})
Deno.test('cancelamento na conferência final não chama o provedor',async()=>{
 const {d,eventos}=fixture({marcar:async()=>null});const r=await processarAutomacoes(d);assert(r.cancelados===1);assert(!eventos.includes('enviar'))
})
Deno.test('timeout ou resposta sem id é incerto e nunca tem nova tentativa',async()=>{
 for(const enviar of [async()=>{throw Error('Timeout')},async()=>null]){
 const {d,eventos}=fixture({enviar});const r=await processarAutomacoes(d);assert(r.falhas===1);assert(eventos.at(-1)==='incerto')
 }
})
Deno.test('pedido de parada bloqueia duravelmente, mesmo ambíguo',async()=>{
 const {d,eventos}=fixture({contexto:async()=>({...c,ultimaMensagem:'não tenho interesse'})});await processarAutomacoes(d);assert(eventos.join(',')==='bloquear,cancelado')
})
Deno.test('modelo inválido falha antes da reserva e sinaliza erro ao finalizar',async()=>{
 const {d,eventos}=fixture({contexto:async()=>({...c,regra:{...c.regra,canal:'meta'}})});await processarAutomacoes(d);assert(eventos.join(',')==='falhou')
 const f=fixture({enviar:async()=>{throw Error('Timeout')},finalizar:async()=>{throw Error('Banco indisponível')}});assert((await processarAutomacoes(f.d)).erros.length===1)
})

Deno.test('follow-up MARKETING exige consentimento de campanhas além da autorização de automações',()=>{
 const contexto={...c,regra:{...c.regra,tipo:'followup' as const,canal:'meta' as const,modelo_nome:'retomar',parametros:{}}}
 const modelo={id:'m',name:'retomar',language:'pt_BR',status:'APPROVED',category:'MARKETING',components:[{type:'BODY',text:'Podemos conversar?'}]}
 throws(()=>prepararAutomacao(e,contexto,[modelo]))
 assert(prepararAutomacao(e,{...contexto,marketingAutorizado:true},[modelo]).marketing===true)
})

Deno.test('rota do worker exige POST, segredo configurado e caminho processar',async()=>{
 const anterior=Deno.env.get('AUTOMACOES_SEGREDO')
 const segredo='segredo-ficticio-de-teste-automacoes'
 const base='https://teste.example/functions/v1/automacoes'
 try {
 Deno.env.delete('AUTOMACOES_SEGREDO')
 assert((await handler(new Request(base+'/processar',{method:'POST'}))).status===401)
 Deno.env.set('AUTOMACOES_SEGREDO',segredo)
 assert((await handler(new Request(base+'/processar',{method:'POST',headers:{Authorization:'Bearer incorreto'}}))).status===401)
 assert((await handler(new Request(base+'/processar',{headers:{Authorization:`Bearer ${segredo}`}}))).status===401)
 assert((await handler(new Request(base+'/outra',{method:'POST',headers:{Authorization:`Bearer ${segredo}`}}))).status===404)
 } finally {
 if(anterior===undefined)Deno.env.delete('AUTOMACOES_SEGREDO');else Deno.env.set('AUTOMACOES_SEGREDO',anterior)
 }
})
