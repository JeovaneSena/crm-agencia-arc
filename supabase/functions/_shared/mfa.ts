/** Só use após validar o token com /auth/v1/user. Não valida assinatura. */
export function segundoFatorConfirmado(token:string,usuario:{factors?:{status?:string}[]}):boolean{
 if(!usuario.factors?.some(f=>f.status==='verified'))return true
 try{
  const parte=token.split('.')[1].replaceAll('-','+').replaceAll('_','/')
  return JSON.parse(atob(parte.padEnd(Math.ceil(parte.length/4)*4,'='))).aal==='aal2'
 }catch{return false}
}
