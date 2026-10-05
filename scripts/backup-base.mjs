// Cópia lógica da aplicação + arquivos Storage. Não inclui contas Auth,
// segredos de integração ou configuração da plataforma. Leia OPERACAO_FASE_7.
import {execFileSync} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import {mkdirSync,writeFileSync,readFileSync,existsSync,chmodSync} from 'node:fs'
import {resolve,join,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
export function conexaoBanco(valor){
 const u=new URL(valor)
 if(!['postgres:','postgresql:'].includes(u.protocol)||!u.hostname||!u.pathname.slice(1))throw Error('Conexão de banco inválida.')
 return {PGHOST:u.hostname,PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:decodeURIComponent(u.pathname.slice(1)),PGSSLMODE:u.searchParams.get('sslmode')||'require'}
}
export const hashArquivo=bytes=>createHash('sha256').update(bytes).digest('hex')
export function conferirManifesto(pasta){
 const m=JSON.parse(readFileSync(join(pasta,'manifesto.json'),'utf8'))
 if(m.formato!==1||!Array.isArray(m.arquivos)||!Array.isArray(m.buckets))throw Error('Manifesto inválido.')
 for(const a of [{arquivo:'banco.dump',sha256:m.banco_sha256},...m.arquivos]){
  if(!/^(banco\.dump|midias\/[a-f0-9-]+\.bin)$/.test(a.arquivo)||hashArquivo(readFileSync(join(pasta,a.arquivo)))!==a.sha256)throw Error('Arquivo ausente ou checksum inválido.')
 }
 return m
}
function apiStorage(url,chave){
 const u=new URL(url);if(u.protocol!=='https:'||!u.hostname.endsWith('.supabase.co')||u.username||u.password)throw Error('URL Supabase inválida.')
 return async(caminho,metodo='GET',corpo,tipo='application/json')=>{
  const r=await fetch(`${u.origin}/storage/v1/${caminho}`,{method:metodo,headers:{apikey:chave,Authorization:`Bearer ${chave}`,'Content-Type':tipo,'x-upsert':'false'},body:corpo===undefined?undefined:corpo instanceof Uint8Array?corpo:JSON.stringify(corpo),redirect:'error',signal:AbortSignal.timeout(60000)})
  if(!r.ok)throw Error(`Storage recusou operação (${r.status}).`);return r
 }
}
async function copiarStorage(pasta,api){
 const buckets=await (await api('bucket')).json(),arquivos=[]
 async function percorrer(bucket,prefix=''){
  for(let offset=0;;offset+=100){
   const lote=await(await api(`object/list/${encodeURIComponent(bucket)}`,'POST',{prefix,limit:100,offset,sortBy:{column:'name',order:'asc'}})).json()
   for(const o of lote){
    const nome=prefix?`${prefix}/${o.name}`:o.name
    if(!o.id){await percorrer(bucket,nome);continue}
    const bytes=new Uint8Array(await(await api(`object/${encodeURIComponent(bucket)}/${nome.split('/').map(encodeURIComponent).join('/')}`)).arrayBuffer())
    const arquivo=`midias/${randomUUID()}.bin`;writeFileSync(join(pasta,arquivo),bytes,{mode:0o600});arquivos.push({bucket,nome,arquivo,tipo:o.metadata?.mimetype||'application/octet-stream',sha256:hashArquivo(bytes)})
   }
   if(lote.length<100)break
  }
 }
 for(const b of buckets)await percorrer(b.id)
 return {buckets:buckets.map(b=>({id:b.id,name:b.name,public:b.public,file_size_limit:b.file_size_limit,allowed_mime_types:b.allowed_mime_types})),arquivos}
}
export async function executarBackup(args,env=process.env){
 const [modo,destino,...flags]=args,pasta=resolve(destino||'')
 if(!['copiar','restaurar'].includes(modo)||!destino)throw Error('Uso: backup-base.mjs copiar|restaurar /pasta-fora-do-repositorio [--confirmar-destino host]')
 const repo=resolve(fileURLToPath(new URL('..',import.meta.url)))
 if(pasta===repo||pasta.startsWith(repo+sep))throw Error('Guarde as cópias fora do repositório.')
 if(modo==='copiar'){
  if(flags.length||existsSync(pasta))throw Error('Escolha uma pasta nova.')
  const db=conexaoBanco(env.BACKUP_DATABASE_URL||'')
  if(!env.BACKUP_SUPABASE_URL||!env.BACKUP_SERVICE_ROLE_KEY)throw Error('Defina conexão, URL e chave de serviço da origem no ambiente.')
  const api=apiStorage(env.BACKUP_SUPABASE_URL,env.BACKUP_SERVICE_ROLE_KEY)
  mkdirSync(pasta,{mode:0o700});mkdirSync(join(pasta,'midias'),{mode:0o700})
  // Senha só no ambiente do processo filho, nunca nos argumentos ou logs.
  execFileSync('pg_dump',['--format=custom','--schema=public','--schema=crm_base_private','--no-owner','--file',join(pasta,'banco.dump')],{env:{...env,...db},stdio:['ignore','ignore','pipe']})
  chmodSync(join(pasta,'banco.dump'),0o600)
  const storage=await copiarStorage(pasta,api)
  writeFileSync(join(pasta,'manifesto.json'),JSON.stringify({formato:1,criado_em:new Date().toISOString(),origem_banco:db.PGHOST,origem_usuario:db.PGUSER,origem_database:db.PGDATABASE,origem_storage:new URL(env.BACKUP_SUPABASE_URL).hostname,banco_sha256:hashArquivo(readFileSync(join(pasta,'banco.dump'))),...storage},null,2),{mode:0o600})
  console.log(`Cópia concluída: ${storage.arquivos.length} arquivos. Contas Auth e segredos exigem cópia separada.`);return
 }
 const m=conferirManifesto(pasta),db=conexaoBanco(env.RESTORE_DATABASE_URL||'')
 if(!env.RESTORE_SUPABASE_URL||!env.RESTORE_SERVICE_ROLE_KEY)throw Error('Defina conexão, URL e chave de serviço do destino no ambiente.')
 const host=new URL(env.RESTORE_SUPABASE_URL).hostname
 if(host===m.origem_storage||db.PGHOST===m.origem_banco&&db.PGUSER===m.origem_usuario&&db.PGDATABASE===m.origem_database)throw Error('A restauração exige outro projeto e host de banco.')
 const api=apiStorage(env.RESTORE_SUPABASE_URL,env.RESTORE_SERVICE_ROLE_KEY)
 if(flags.length===0){console.log(`Plano: restaurar aplicação e ${m.arquivos.length} arquivos no destino ${host}. Prepare o Supabase, contas Auth com os mesmos IDs e segredos. Para executar: --confirmar-destino ${host}`);return}
 if(flags.length!==2||flags[0]!=='--confirmar-destino'||flags[1]!==host)throw Error('Confirme o host exato do destino.')
 const executarSql=sql=>execFileSync('psql',['--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--command',sql],{env:{...env,...db},encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
 if(executarSql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','crm_base_private') AND c.relkind IN ('r','p')")!=='0')throw Error('O destino deve ter os esquemas da aplicação vazios. Nenhuma tabela será apagada.')
 const existentes=await(await api('bucket')).json();if(existentes.length)throw Error('O Storage do destino precisa estar vazio.')
 execFileSync('pg_restore',['--exit-on-error','--single-transaction','--no-owner','--dbname',db.PGDATABASE,join(pasta,'banco.dump')],{env:{...env,...db},stdio:['ignore','ignore','pipe']})
 executarSql("ALTER ROLE authenticator SET pgrst.db_pre_request='public.verificar_sessao_api'; NOTIFY pgrst,'reload config'; NOTIFY pgrst,'reload schema';")
 for(const b of m.buckets)await api('bucket','POST',b)
 for(const a of m.arquivos)await api(`object/${encodeURIComponent(a.bucket)}/${a.nome.split('/').map(encodeURIComponent).join('/')}`,'POST',new Uint8Array(readFileSync(join(pasta,a.arquivo))),a.tipo)
 console.log('Restauração concluída. Verifique diagnóstico, Auth, MFA, arquivos e integrações antes de reativar trabalhadores.')
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))executarBackup(process.argv.slice(2)).catch(()=>{console.error('Operação não concluída. Confira configuração, permissões, ferramentas PostgreSQL e integridade da cópia. Uma falha no Storage exige revisar o destino antes de repetir.');process.exitCode=1})
