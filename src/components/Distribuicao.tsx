import {useCallback,useEffect,useState} from 'react'
import {supabase} from '../lib/supabase'
import {useEquipeAtiva} from '../lib/useEquipeAtiva'
import {Button,Card,Notice} from './ui'
interface Config {ativa:boolean;equipe:string[];versao:number}
export default function Distribuicao(){
 const equipe=useEquipeAtiva(),[config,setConfig]=useState<Config|null>(null),[aviso,setAviso]=useState(''),[ocupado,setOcupado]=useState(false)
 const carregar=useCallback(async()=>{const r=await supabase.from('distribuicao_config').select('ativa,equipe,versao').single();if(r.error){setAviso('Não foi possível carregar a distribuição.');return}setConfig(r.data)},[])
 useEffect(()=>{void carregar()},[carregar])
 async function salvar(){if(!config)return;setOcupado(true);try{const r=await supabase.rpc('distribuicao_salvar',{p_ativa:config.ativa,p_equipe:config.equipe,p_versao:config.versao});setAviso(r.error?'Configuração recusada. Atualize e confira as pessoas ativas.':'Distribuição salva.');await carregar()}catch{setAviso('Falha de conexão.')}finally{setOcupado(false)}}
 return <Card style={{padding:20,marginBottom:20}}><h2>Distribuição automática</h2><p>Novas oportunidades sem responsável informado percorrem a equipe selecionada em rodízio. Pessoas desligadas são ignoradas; escolhas explícitas são preservadas.</p>{config&&<><label><input type="checkbox" checked={config.ativa} onChange={e=>setConfig({...config,ativa:e.target.checked})}/> Ativar distribuição</label>{equipe.map(p=><label key={p.id} style={{display:'block',margin:'10px 0'}}><input type="checkbox" checked={config.equipe.includes(p.id)} onChange={e=>setConfig({...config,equipe:e.target.checked?[...config.equipe,p.id]:config.equipe.filter(id=>id!==p.id)})}/> {p.nome}</label>)}<Button disabled={ocupado} onClick={()=>void salvar()}>Salvar distribuição</Button></>}{aviso&&<Notice>{aviso}</Notice>}</Card>
}
