import {selecionar,rpc} from './db.ts'
import {conversar} from './llm.ts'
import {conversarComLimite} from './consumo_ia.ts'
import {verificarResposta} from './seguranca_ia.ts'
export async function textoGestaoIA(contato:string,instrucao:string):Promise<string>{
 const [configs,contatos,catalogo]=await Promise.all([selecionar<{modo:string;modelo:string;instrucoes:string|null;numeros_teste:string[]}>('assistente_config?select=modo,modelo,instrucoes,numeros_teste&limit=1'),selecionar<{nome:string;whatsapp:string;ia_ligada:boolean;ia_encaminhada_motivo:string|null}>(`contatos_dados?select=nome,whatsapp,ia_ligada,ia_encaminhada_motivo&id=eq.${contato}`),selecionar<{nome:string;preco_a_partir_de:number|null}>('catalogo_servicos?select=nome,preco_a_partir_de&ativo=eq.true&arquivado=eq.false')])
 const c=configs[0],p=contatos[0]
 if(!c||!p||c.modo==='desligada'||p.ia_encaminhada_motivo||c.modo==='teste'&&!c.numeros_teste.includes(p.whatsapp)||c.modo==='ao_vivo'&&!p.ia_ligada)throw Error('Assistente indisponível')
 const r=await conversarComLimite({modelo:c.modelo,maxTokens:2048,sistema:`Escreva uma mensagem curta de relacionamento para o cliente. Não prometa ações humanas, não revele informações internas e não invente preços. Não execute ferramentas.\n${c.instrucoes??''}\nCatálogo: ${JSON.stringify(catalogo)}`,mensagens:[{papel:'user',conteudo:JSON.stringify({nome:p.nome,instrucao})}],ferramentas:[]},conversar,rpc)
 if(!r.texto.trim()||r.texto.length>4000||r.chamadas.length||verificarResposta(r.texto,catalogo.flatMap(s=>s.preco_a_partir_de==null?[]:[Number(s.preco_a_partir_de)])))throw Error('Resposta precisa de revisão')
 return r.texto
}
