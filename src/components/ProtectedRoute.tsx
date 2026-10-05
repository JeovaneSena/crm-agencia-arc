import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import VerificarMfa from './VerificarMfa'
import SessaoProvider from './SessaoProvider'

export default function ProtectedRoute() {
  const [loading, setLoading] = useState(true)
  const [mfa,setMfa]=useState(false)
  const [erro,setErro]=useState(false)
  const [authenticated, setAuthenticated] = useState(false)

  useEffect(() => {
    let vivo=true
    async function conferir(){
      try {
        const {data:{session},error}=await supabase.auth.getSession()
        if(error)throw error
        if(!session){if(vivo){setAuthenticated(false);setLoading(false)};return}
        const r=await supabase.auth.mfa.getAuthenticatorAssuranceLevel(session.access_token)
        if(r.error)throw r.error
        if(vivo){setAuthenticated(true);setMfa(r.data.nextLevel==='aal2'&&r.data.currentLevel!=='aal2');setErro(false);setLoading(false)}
      }catch{if(vivo){setErro(true);setLoading(false)}}
    }
    void conferir()
    const {data:{subscription}}=supabase.auth.onAuthStateChange(()=>{setLoading(true);setTimeout(()=>void conferir(),0)})

    return () => {vivo=false;subscription.unsubscribe()}
  }, [])

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: 'var(--page)',
      }}>
        <div style={{ width: 32, height: 32, border: '3px solid var(--accent-soft)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if(erro)return <main><p role="alert">Não foi possível verificar a segurança da sessão.</p><button onClick={()=>window.location.reload()}>Tentar novamente</button><button onClick={()=>void supabase.auth.signOut()}>Sair</button></main>
  if(authenticated&&mfa)return <VerificarMfa onVerified={()=>setMfa(false)}/>

  // O provedor mora aqui, e não no App, para que só exista com sessão: as
  // telas de dentro podem contar com `useSessao` sem checar nulo.
  return authenticated
    ? <SessaoProvider><Outlet /></SessaoProvider>
    : <Navigate to="/login" replace />
}
