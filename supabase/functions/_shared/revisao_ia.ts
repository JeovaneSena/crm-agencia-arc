import { gerarRascunho, type DepsRascunho, type ConfigIA } from './assistente.ts'
export async function compararMelhoria(deps:DepsRascunho,contato:string,config:ConfigIA,ativa:string,candidata:string) {
 // Congela o mesmo histórico para os dois lados. Nenhuma ferramenta escreve/envia.
 const historico=await deps.historico(contato,20)
 const comparar=(extra:string)=>gerarRascunho({...deps,historico:()=>Promise.resolve(historico),lerConfig:()=>Promise.resolve({...config,instrucoes:[config.instrucoes,extra].filter(Boolean).join('\n\n')})},contato)
 const base=await comparar(ativa)
 const candidato=await comparar(candidata)
 return {base,candidato,apto:candidato.ok}
}
