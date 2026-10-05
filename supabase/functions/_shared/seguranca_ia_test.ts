import { passagemDireta, verificarResposta, esperaProporcional } from './seguranca_ia.ts'
function igual(a:unknown,b:unknown){if(a!==b)throw Error(`${a} != ${b}`)}
Deno.test('passagem explícita e jurídico antes do modelo; perguntas comerciais continuam',()=>{
 for(const t of ['Quero falar com uma pessoa','Me transfira para um atendente','Atendimento humano','Quero um atendente'])igual(passagemDireta(t),'pedido_pessoa')
 for(const t of ['Vou ao Procon','Meu advogado vai entrar em contato','Vou processar'])igual(passagemDireta(t),'juridico')
 for(const t of ['Quanto custa?','Como funciona o processo de contratação?','Uma pessoa pode comprar?'])igual(passagemDireta(t),null)
})
Deno.test('respostas bloqueiam ferramenta, preço inventado, promessa e jurídico',()=>{
 igual(verificarResposta('O service_role gerou erro 403',[]),'vocabulario_interno')
 igual(verificarResposta('Vou chamar consultar_servicos',[]),'vocabulario_interno')
 igual(verificarResposta('A partir de R$ 100,00',[100]),null)
 igual(verificarResposta('Custa R$ 99,00',[100]),'preco_fora_catalogo')
 igual(verificarResposta('O preço é 99',[100]),'preco_fora_catalogo')
 igual(verificarResposta('100 reais',[100]),null)
 igual(verificarResposta('Cem reais',[]),'preco_fora_catalogo')
 igual(verificarResposta('A equipe vai ligar para você',[100]),'promessa_equipe')
 igual(verificarResposta('Nossa equipe entrará em contato',[100]),'promessa_equipe')
 igual(verificarResposta('Vou te encaminhar para a equipe',[100]),'promessa_equipe')
 igual(verificarResposta('Encaminhei sua conversa',[],true),null)
 igual(verificarResposta('O processo judicial não tem chance',[]),'juridico')
 igual(verificarResposta('Integramos APIs e sistemas. A equipe confirma a proposta.',[]),null)
})
Deno.test('espera cresce com texto e desconta processamento, sem passar de 7,5 segundos',()=>{
 igual(esperaProporcional('Oi',0),1200)
 igual(esperaProporcional('a'.repeat(500),0),7500)
 igual(esperaProporcional('a'.repeat(100),1000),2100)
 igual(esperaProporcional('a'.repeat(500),8000),0)
})
