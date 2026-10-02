import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync('.supabase-token.local','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trimStart().startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const project=env.SUPABASE_PROJECT_REF.replace(/\/+$/,'').split('/').pop()
const headers={Authorization:`Bearer ${env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'}
const root=`https://api.supabase.com/v1/projects/${project}`
const query=`select json_build_object(
 'agent',(select json_build_object('active',ativo,'test_mode',modo_teste,'provider',provedor_whatsapp,'model',modelo,'custom_prompt',nullif(trim(prompt),'') is not null) from configuracoes_agente limit 1),
 'active_team',(select count(*) from profissionais where ativo),
 'working_hours',(select count(*) from profissional_horarios where ativo),
 'timezone',(select fuso_horario from configuracoes_clinica limit 1),
 'backup_tables',(select count(*) from information_schema.tables where table_schema='arc_backup'),
 'lead_count',(select count(*) from crm_clinica_dados),
 'project_count',(select count(*) from projetos)
) as inspection;`
for(const [path,options] of [['/database/query',{method:'POST',body:JSON.stringify({query})}],['/functions',{}]]) {
 const r=await fetch(root+path,{...options,headers}); if(!r.ok) throw Error(`Inspection ${r.status}`)
 const data=await r.json()
 console.log(JSON.stringify(path==='/functions'?data.map(f=>({name:f.name,status:f.status,version:f.version,updated_at:f.updated_at})):data))
}
