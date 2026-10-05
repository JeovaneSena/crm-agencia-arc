/** Ideia adaptada de DeskcommCRM (MIT, Rafael Melgaço): campos exigidos no destino. */
export type TipoCampo = 'texto' | 'numero' | 'data' | 'opcao' | 'booleano'
export interface CampoDef {chave:string;rotulo:string;entidade:'contato'|'oportunidade';tipo:TipoCampo;opcoes:string[];obrigatorio_em:string[];ativo:boolean;versao:number}
export type ValoresCampos = Record<string,string|number|boolean|null>
export function preenchido(v:unknown):boolean {return v!==null&&v!==undefined&&(typeof v!=='string'||v.trim()!=='')}
export function erroValor(c:CampoDef,v:unknown):string|null {
 if(!preenchido(v))return null
 const ok=c.tipo==='texto'?typeof v==='string'&&v.length<=2000:c.tipo==='numero'?typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e15:c.tipo==='booleano'?typeof v==='boolean':c.tipo==='opcao'?typeof v==='string'&&c.opcoes.includes(v):typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!v.startsWith('0000')&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v
 return ok?null:`Valor inválido: ${c.rotulo}`
}
export function camposFaltando(defs:CampoDef[],valores:Record<string,unknown>,etapa:string):CampoDef[]{return defs.filter(c=>c.ativo&&c.obrigatorio_em.includes(etapa)&&!preenchido(valores[c.chave]))}
