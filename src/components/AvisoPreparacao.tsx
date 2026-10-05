import {useEffect,useState} from 'react'
import {Link,useLocation} from 'react-router-dom'
import {supabase} from '../lib/supabase'
import {useSessao} from '../lib/sessao'
export default function AvisoPreparacao(){
 const {gestor}=useSessao(),[pendente,setPendente]=useState(false),location=useLocation()
 useEffect(()=>{let vivo=true;if(gestor)void supabase.from('preparacao_crm').select('concluida_em').maybeSingle().then(r=>{if(vivo)setPendente(!r.error&&!!r.data&&!r.data.concluida_em)});return()=>{vivo=false}},[gestor,location.pathname])
 return gestor&&pendente&&location.pathname!=='/preparacao'?<div style={{padding:'12px 24px',background:'var(--info-soft)'}}>Sua operação ainda está em preparação. <Link to="/preparacao">Abrir guia de configuração</Link></div>:null
}
