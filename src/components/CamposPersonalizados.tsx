import {useCallback,useEffect,useState} from 'react'
import {supabase} from '../lib/supabase'
import {erroValor,type CampoDef,type ValoresCampos} from '../lib/camposRegras'
import {Button,Card,Notice} from './ui'
export function CamposEditor({defs,valores,onChange,disabled=false,etapa}:{defs:CampoDef[];valores:ValoresCampos;onChange:(v:ValoresCampos)=>void;disabled?:boolean;etapa?:string}){
 return <fieldset disabled={disabled} style={{display:'grid',gap:12,border:'1px solid var(--border)',padding:16,borderRadius:10}}><legend>Campos personalizados</legend>{defs.filter(c=>c.ativo).map(c=>{
 const v=valores[c.chave],required=!!etapa&&c.obrigatorio_em.includes(etapa)
 const set=(v:string|number|boolean|null)=>onChange({...valores,[c.chave]:v})
 return <label key={c.chave}>{c.rotulo}{required?' *':''}{c.tipo==='opcao'||c.tipo==='booleano'?<select className="arc-field" aria-label={c.rotulo} required={required} value={v===null||v===undefined?'':String(v)} onChange={e=>set(e.target.value===''?null:c.tipo==='booleano'?e.target.value==='true':e.target.value)}><option value="">Sem resposta</option>{c.tipo==='booleano'?<><option value="true">Sim</option><option value="false">Não</option></>:c.opcoes.map(o=><option key={o}>{o}</option>)}</select>:<input className="arc-field" aria-label={c.rotulo} required={required} type={c.tipo==='numero'?'number':c.tipo==='data'?'date':'text'} step={c.tipo==='numero'?'any':undefined} maxLength={2000} value={v===null||v===undefined?'':String(v)} onChange={e=>set(c.tipo==='numero'?(e.target.value===''?null:Number(e.target.value)):e.target.value)}/>}</label>
 })}</fieldset>
}
export default function CamposDoContato({contatoId}:{contatoId:string}){
 const [defs,setDefs]=useState<CampoDef[]>([]),[valores,setValores]=useState<ValoresCampos>({}),[versao,setVersao]=useState<number|null>(null),[aviso,setAviso]=useState(''),[ocupado,setOcupado]=useState(false)
 const carregar=useCallback(()=>Promise.all([supabase.from('campos_personalizados').select('*').eq('entidade','contato').order('rotulo'),supabase.from('contatos_dados').select('campos_custom,campos_versao').eq('id',contatoId).single()]).then(([d,c])=>{if(d.error||c.error||!c.data){setAviso('Não foi possível carregar os campos.');return}setDefs(d.data??[]);setValores(c.data.campos_custom??{});setVersao(c.data.campos_versao)}),[contatoId])
 useEffect(()=>{void carregar()},[carregar])
 async function salvar(){const erro=defs.filter(c=>c.ativo).map(c=>erroValor(c,valores[c.chave])).find(Boolean);if(erro){setAviso(erro);return}setOcupado(true);const r=await supabase.rpc('campos_contato_salvar',{p_contato:contatoId,p_valores:Object.fromEntries(defs.filter(c=>c.ativo).map(c=>[c.chave,valores[c.chave]??null])),p_versao:versao});setAviso(r.error?'Não foi possível salvar. O contato pode ter mudado; atualize os campos.':'Campos salvos.');if(!r.error)await carregar();setOcupado(false)}
 if(!defs.some(c=>c.ativo)&&!aviso)return null
 return <Card style={{padding:20,marginBottom:20}}><h2>Informações do contato</h2><CamposEditor defs={defs} valores={valores} onChange={setValores} disabled={ocupado||versao===null}/><Button disabled={ocupado||versao===null} onClick={()=>void salvar()}>Salvar campos do contato</Button><Button disabled={ocupado} onClick={()=>void carregar()}>Atualizar campos</Button>{aviso&&<Notice>{aviso}</Notice>}</Card>
}
