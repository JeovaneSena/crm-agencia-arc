// Agende a cada 5 min. Segredos somente no ambiente da instalação derivada.
const url=(process.env.SUPABASE_URL ?? '').replace(/\/+$/,'')
const segredo=process.env.AUTOMACOES_SEGREDO ?? ''
if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || segredo.length<24) {
 console.error('Defina SUPABASE_URL e AUTOMACOES_SEGREDO (24+ caracteres).'); process.exit(2)
}
try {
 const r=await fetch(`${url}/functions/v1/automacoes/processar`,{method:'POST',headers:{Authorization:`Bearer ${segredo}`},signal:AbortSignal.timeout(120000)})
 const d=await r.json()
 if(!r.ok || !d.ok || d.falhas) throw Error(`Verificação falhou (HTTP ${r.status}; ${d.falhas ?? 0} envio(s) com falha). Confira a Central e o histórico.`)
 console.log(`Automações: ${d.enviados} enviada(s); ${d.cancelados} cancelada(s).`)
} catch(e) { console.error(e.message); process.exit(1) }
