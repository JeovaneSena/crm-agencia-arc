// Read-only check, deliberately excludes tokens, QR codes and webhook URLs from output.
import { readFileSync } from 'node:fs'
const env=Object.fromEntries(readFileSync('agente-ia/.env.agente.local','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trimStart().startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const base=env.UAZAPI_API_URL?.replace(/\/+$/,'')
for(const path of ['/instance/status','/webhook']) {
 const r=await fetch(base+path,{headers:{token:env.UAZAPI_TOKEN},signal:AbortSignal.timeout(15000)})
 if(!r.ok) { console.log(path,{http:r.status}); continue }
 const d=await r.json()
 console.log(path,path.includes('status')?{http:r.status,status:d.instance?.status,connected:d.status?.connected??d.connected}: {http:r.status,hooks:Array.isArray(d)?d.map(w=>({enabled:w.enabled,configured:!!w.url})):null})
}
