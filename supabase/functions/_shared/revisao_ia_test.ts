import {compararMelhoria} from './revisao_ia.ts'
import type {ConfigIA,DepsRascunho} from './assistente.ts'
Deno.test('revisão compara mesmo histórico, guarda dois lados e não oferece ferramentas de escrita',async()=>{
 let leituras=0,chamadas=0
 const cfg:ConfigIA={modo:'desligada',nome:'Assistente',modelo:'gpt-test',instrucoes:'Negócio',numerosTeste:[],maxRespostas:5,esperaSegundos:0,devolverAposMinutos:null}
 const deps:DepsRascunho={agora:()=>new Date(),lerConfig:()=>Promise.resolve(cfg),historico:()=>{leituras++;return Promise.resolve([{deCliente:true,texto:'Pergunta',tipo:'texto'}])},contexto:()=>Promise.resolve({negocio:'Teste',fuso:'UTC'}),servicos:()=>Promise.resolve([]),horarios:()=>Promise.resolve([]),conversar:p=>{
  chamadas++
  if(p.ferramentas.some(f=>f.nome==='chamar_equipe'))throw Error('escrita na revisão')
  return Promise.resolve({texto:p.sistema.includes('Candidata')?'Resposta melhor.':'Resposta atual.',chamadas:[]})
 }}
 const r=await compararMelhoria(deps,'contato',cfg,'Ativa','Candidata')
 if(leituras!==1||chamadas!==2||!r.apto||!r.base.ok||!r.candidato.ok||r.base.texto===r.candidato.texto)throw Error('comparação inválida')
 deps.conversar=()=>Promise.resolve({texto:'Custa R$ 999,00.',chamadas:[]})
 if((await compararMelhoria(deps,'contato',cfg,'Ativa','Candidata')).apto)throw Error('proposta insegura passou')
})
