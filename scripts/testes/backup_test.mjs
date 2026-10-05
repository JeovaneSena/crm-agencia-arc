import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {conexaoBanco,hashArquivo,conferirManifesto,executarBackup} from '../backup-base.mjs'
test('senha fica no ambiente, com SSL e decodificação',()=>{const d=conexaoBanco('postgresql://operador:p%40ss@banco.example.invalid:5432/postgres');assert.equal(d.PGPASSWORD,'p@ss');assert.equal(d.PGSSLMODE,'require');assert.throws(()=>conexaoBanco('https://example.invalid'))})
test('checksum e caminhos são conferidos antes de restaurar',()=>{
 const p=mkdtempSync(join(tmpdir(),'crm-backup-test-'))
 try{writeFileSync(join(p,'banco.dump'),'fixture');const m={formato:1,buckets:[],arquivos:[],banco_sha256:hashArquivo('fixture')};writeFileSync(join(p,'manifesto.json'),JSON.stringify(m));assert.equal(conferirManifesto(p).formato,1);writeFileSync(join(p,'banco.dump'),'alterado');assert.throws(()=>conferirManifesto(p));m.arquivos=[{arquivo:'../segredo',sha256:'x'}];writeFileSync(join(p,'banco.dump'),'fixture');writeFileSync(join(p,'manifesto.json'),JSON.stringify(m));assert.throws(()=>conferirManifesto(p))}finally{rmSync(p,{recursive:true,force:true})}
})
test('restaurar recusa a origem e exige o host exato sem acessar a rede',async()=>{
 const p=mkdtempSync(join(tmpdir(),'crm-restore-test-'))
 try{
  writeFileSync(join(p,'banco.dump'),'fixture')
  writeFileSync(join(p,'manifesto.json'),JSON.stringify({formato:1,buckets:[],arquivos:[],banco_sha256:hashArquivo('fixture'),origem_storage:'origem.supabase.co',origem_banco:'origem.example.invalid',origem_usuario:'postgres',origem_database:'postgres'}))
  const env={RESTORE_DATABASE_URL:'postgresql://postgres:senha-ficticia@destino.example.invalid/postgres',RESTORE_SUPABASE_URL:'https://destino.supabase.co',RESTORE_SERVICE_ROLE_KEY:'chave-ficticia'}
  await assert.rejects(executarBackup(['restaurar',p,'--confirmar-destino','errado'],env),/host exato/)
  await assert.rejects(executarBackup(['restaurar',p],{...env,RESTORE_SUPABASE_URL:'https://origem.supabase.co'}),/outro projeto/)
 }finally{rmSync(p,{recursive:true,force:true})}
})
