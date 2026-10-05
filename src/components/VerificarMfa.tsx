import {useEffect,useState} from 'react'
import {supabase} from '../lib/supabase'
import {Button,Notice} from './ui'
export default function VerificarMfa({onVerified}:{onVerified:()=>void}){
 const [fatores,setFatores]=useState<{id:string;friendly_name?:string}[]>([]),[id,setId]=useState(''),[codigo,setCodigo]=useState(''),[erro,setErro]=useState(''),[ocupado,setOcupado]=useState(false)
 useEffect(()=>{void supabase.auth.mfa.listFactors().then(r=>{if(r.error){setErro('Não foi possível carregar o autenticador.');return}setFatores(r.data.totp);setId(r.data.totp[0]?.id??'')})},[])
 async function verificar(){setOcupado(true);setErro('');try{const r=await supabase.auth.mfa.challengeAndVerify({factorId:id,code:codigo});if(r.error)throw r.error;onVerified()}catch{setErro('Código recusado. Confira o autenticador e tente novamente.')}finally{setOcupado(false)}}
 return <main style={{minHeight:'100dvh',display:'grid',placeItems:'center',padding:20}}><form style={{maxWidth:420,width:'100%'}} onSubmit={e=>{e.preventDefault();void verificar()}}><h1>Verificação em duas etapas</h1><p>Informe o código do seu aplicativo autenticador para continuar.</p>{fatores.length>1&&<label>Autenticador<select className="arc-field" value={id} onChange={e=>setId(e.target.value)}>{fatores.map(f=><option key={f.id} value={f.id}>{f.friendly_name??f.id}</option>)}</select></label>}<label>Código<input className="arc-field" autoFocus autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" required maxLength={6} value={codigo} onChange={e=>setCodigo(e.target.value)}/></label>{erro&&<Notice tone="danger">{erro}</Notice>}<Button type="submit" disabled={ocupado||!id}>Confirmar código</Button> <Button type="button" onClick={()=>void supabase.auth.signOut()}>Sair</Button></form></main>
}
