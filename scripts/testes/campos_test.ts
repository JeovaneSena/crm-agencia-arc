import {preenchido,erroValor,camposFaltando,type CampoDef} from '../../src/lib/camposRegras.ts'
function assert(v:unknown){if(!v)throw Error('falhou')}
const c:CampoDef={chave:'prazo',rotulo:'Prazo',entidade:'oportunidade',tipo:'data',opcoes:[],obrigatorio_em:['proposta'],ativo:true,versao:1}
Deno.test('zero e false preenchidos; branco ausente; exigência só no destino ativo',()=>{
 assert(preenchido(0)&&preenchido(false)&&!preenchido('  ')&&!preenchido(null))
 assert(camposFaltando([c],{},'proposta').length===1)
 assert(camposFaltando([c],{},'qualificacao').length===0)
 assert(camposFaltando([{...c,ativo:false}],{},'proposta').length===0)
})
Deno.test('tipos recusam data impossível, número não finito e opção fora da lista',()=>{
 assert(erroValor(c,'0000-01-01')&&erroValor(c,'2026-02-30')&&erroValor(c,'texto')&&!erroValor(c,'2026-10-05'))
 assert(erroValor({...c,tipo:'numero'},NaN)&&!erroValor({...c,tipo:'numero'},0))
 assert(!erroValor({...c,tipo:'booleano'},false)&&erroValor({...c,tipo:'booleano'},'false'))
 assert(erroValor({...c,tipo:'opcao',opcoes:['Sim']},'Talvez')&&!erroValor({...c,tipo:'opcao',opcoes:['Sim']},'Sim'))
})
