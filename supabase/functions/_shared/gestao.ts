export interface SaidaGestao {id:string;token:string;contato_id:string;acao:{tipo:string;texto?:string;instrucao?:string;destino?:string}}
export interface DepsGestao {
 reivindicar():Promise<SaidaGestao[]>;
 preparar(s:SaidaGestao):Promise<string|null>;
 iniciar(s:SaidaGestao,texto:string|null):Promise<boolean>;
 enviar(s:SaidaGestao,texto:string|null):Promise<string>;
 finalizar(s:SaidaGestao,estado:'enviado'|'falhou'|'incerto'|'cancelado',externo:string|null):Promise<void>;
}
export async function processarSaidasGestao(d:DepsGestao){
 let enviados=0,falhas=0,cancelados=0;const erros:string[]=[]
 for(const s of await d.reivindicar()){
  let iniciou=false
  try{
   const texto=await d.preparar(s)
   if(!await d.iniciar(s,texto)){await d.finalizar(s,'cancelado',null);cancelados++;continue}
   iniciou=true
   const externo=await d.enviar(s,texto)
   if(!externo)throw Error('Sem confirmação')
   await d.finalizar(s,'enviado',s.acao.tipo==='webhook'?null:externo);enviados++
  }catch{
   falhas++
   try{await d.finalizar(s,iniciou?'incerto':'falhou',null)}catch{erros.push(s.id)}
  }
 }
 return {enviados,falhas,cancelados,erros}
}
export function destinoWebhook(destino:string,mapa:Record<string,string>):URL{
 const valor=mapa[destino];if(!valor)throw Error('Destino indisponível')
 const u=new URL(valor)
 if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port&&u.port!=='443'||!u.hostname.includes('.')||/^(localhost|127\.|10\.|0\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)|\[|\.local$|\.internal$/i.test(u.hostname))throw Error('Destino inválido')
 return u
}
