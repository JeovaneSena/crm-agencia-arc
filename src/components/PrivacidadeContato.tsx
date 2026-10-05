import {useNavigate} from 'react-router-dom'
import {apagarPessoa} from '../lib/apagarPessoa'
import {useState} from 'react'
import {supabase} from '../lib/supabase'
import {useSessao} from '../lib/sessao'
import {Button,Card,Notice} from './ui'
export default function PrivacidadeContato({contatoId}:{contatoId:string}){
 const navigate=useNavigate()
 const [anon,setAnon]=useState(false),[confirmacao,setConfirmacao]=useState('')
 const {gestor}=useSessao(),[ocupado,setOcupado]=useState(false),[aviso,setAviso]=useState('')
 if(!gestor)return null
 async function anonimizar(){setOcupado(true);setAviso('');try{await apagarPessoa(contatoId,'anonimizar');navigate('/leads')}catch{setAviso('Não foi possível anonimizar. Confira os envios em curso e tente novamente.')}finally{setOcupado(false)}}
 async function exportar(){
  setOcupado(true);setAviso('')
  try{const r=await supabase.rpc('privacidade_exportar',{p_contato:contatoId});if(r.error)throw r.error
   const url=URL.createObjectURL(new Blob([JSON.stringify(r.data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`contato-${contatoId}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setAviso('Exportação concluída. Os arquivos de mídia são obtidos separadamente.')
  }catch{setAviso('Não foi possível exportar os dados.')}finally{setOcupado(false)}
 }
 return <Card style={{padding:20,marginTop:20}}><h2>Dados pessoais</h2><p>Baixe os registros deste contato e seus vínculos. Para remover a ficha e os dados em cascata, use a opção de exclusão do contato e confira a confirmação: ela também elimina o histórico individual de vendas.</p><Button disabled={ocupado} onClick={()=>void exportar()}>{ocupado?'Exportando…':'Exportar dados do contato'}</Button> <Button disabled={ocupado} onClick={()=>setAnon(true)}>Anonimizar histórico</Button>{anon&&<Notice tone="warning"><p>A identificação e os registros individuais serão removidos definitivamente, incluindo mensagens, arquivos, propostas, campos e evidências do assistente. Só os totais de ganhos e perdas por mês serão agregados, sem vínculo com este contato. Cópias já exportadas ou backups anteriores exigem tratamento separado.</p><label>Digite ANONIMIZAR DADOS<input className="arc-field" value={confirmacao} onChange={e=>setConfirmacao(e.target.value)}/></label><Button variant="danger" disabled={ocupado||confirmacao!=='ANONIMIZAR DADOS'} onClick={()=>void anonimizar()}>Confirmar anonimização</Button> <Button disabled={ocupado} onClick={()=>setAnon(false)}>Cancelar</Button></Notice>}{aviso&&<Notice>{aviso}</Notice>}</Card>
}
