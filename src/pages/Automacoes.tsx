import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { moduloAtivo } from '../lib/modulos'
import { Button, Card, LoadingState, Notice, PageHeader } from '../components/ui'
interface Regra { id: string; nome: string; tipo: 'lembrete' | 'followup'; canal: 'uazapi' | 'meta'; ativa: boolean; minutos: number; etapa: string | null; texto: string; modelo_nome: string | null }
interface Envio { id: string; estado: string; erro: string | null; vence_em: string }
interface Contato { id: string; nome: string | null; whatsapp: string | null }
interface Permissao { contato_id: string; autorizado: boolean; fonte: string }
export default function Automacoes() {
 const [regras,setRegras]=useState<Regra[]>([]),[envios,setEnvios]=useState<Envio[]>([]),[contatos,setContatos]=useState<Contato[]>([])
 const [permissoes,setPermissoes]=useState<Permissao[]>([]),[etapas,setEtapas]=useState<{chave:string;rotulo:string}[]>([])
 const [carregando,setCarregando]=useState(true),[ocupado,setOcupado]=useState(false),[erro,setErro]=useState('')
 const [tipo,setTipo]=useState<'lembrete'|'followup'>('lembrete'),[canal,setCanal]=useState<'uazapi'|'meta'>('uazapi')
 const carregar=useCallback(async()=>{
 const resultados=await Promise.all([
 supabase.from('automacao_regras').select('*').order('created_at'),
 supabase.from('automacao_envios').select('id,estado,erro,vence_em').order('vence_em',{ascending:false}).limit(50),
 supabase.from('contatos_dados').select('id,nome,whatsapp').order('nome').limit(500),
 supabase.from('automacao_permissoes').select('*'),supabase.from('etapas_funil').select('chave,rotulo').eq('tipo','aberta').order('ordem'),
 ])
 if(resultados.some(r=>r.error)) setErro('Não foi possível carregar as automações. Confira as migrações desta instalação.')
 else {setRegras(resultados[0].data as Regra[]);setEnvios(resultados[1].data as Envio[]);setContatos(resultados[2].data as Contato[]);setPermissoes(resultados[3].data as Permissao[]);setEtapas(resultados[4].data as {chave:string;rotulo:string}[])}
 setCarregando(false)
 },[])
 useEffect(()=>{void carregar()},[carregar])
 async function criar(event:FormEvent<HTMLFormElement>) {
 event.preventDefault();if(ocupado)return;setOcupado(true);setErro('')
 const form=event.currentTarget,dados=new FormData(form)
 try {
 let parametros:unknown={}
 if(canal==='meta'){
 const mensagem='Parâmetros: use um objeto com listas de textos, por exemplo {"body":["{{nome}}","{{hora}}"]}.'
 try{parametros=JSON.parse(String(dados.get('parametros')||'{}'))}catch{throw Error(mensagem)}
 if(!parametros||Array.isArray(parametros)||typeof parametros!=='object'||Object.values(parametros).some(v=>!Array.isArray(v)||v.some(x=>typeof x!=='string')))throw Error(mensagem)
 }
 const {error}=await supabase.from('automacao_regras').insert({nome:String(dados.get('nome')).trim(),tipo,canal,minutos:Number(dados.get('minutos')),etapa:tipo==='followup'?dados.get('etapa'):null,texto:String(dados.get('texto')).trim(),modelo_nome:canal==='meta'?String(dados.get('modelo')).trim():null,modelo_idioma:String(dados.get('idioma')||'pt_BR'),parametros,ativa:false})
 if(error)throw Error('Não foi possível salvar. Confira os campos da regra.')
 form.reset();await carregar()
 }catch(e){setErro(e instanceof Error?e.message:'Não foi possível salvar.')}
 finally{setOcupado(false)}
 }
 async function ativar(r:Regra){if(ocupado)return;setOcupado(true);setErro('');const {error}=await supabase.from('automacao_regras').update({ativa:!r.ativa}).eq('id',r.id);if(error)setErro('Não foi possível mudar a regra.');else await carregar();setOcupado(false)}
 async function autorizar(event:FormEvent<HTMLFormElement>){
 event.preventDefault();if(ocupado)return;setOcupado(true);setErro('');const form=event.currentTarget,d=new FormData(form)
 const {error}=await supabase.from('automacao_permissoes').upsert({contato_id:d.get('contato'),autorizado:d.get('autorizar')==='on',fonte:String(d.get('fonte')).trim(),atualizado_em:new Date().toISOString()},{onConflict:'contato_id'})
 if(error)setErro('Não foi possível registrar a autorização.');else{form.reset();await carregar()}setOcupado(false)
 }
 return <div className="page-content">
 <PageHeader eyebrow="Gestão" title="Automações" description="Lembretes de reunião e retomadas de contato. Cada regra começa desligada." />
 {erro&&<Notice tone="danger">{erro}</Notice>}
 <Notice>Registre a autorização de cada contato antes de ativar. O follow-up para quando o cliente responde, a equipe assume ou o negócio muda de etapa. Envios sem confirmação precisam de revisão.</Notice>
 {carregando?<LoadingState/>:<>
 <Card style={{margin:'16px 0',padding:20}}><h2>Nova regra</h2><form onSubmit={e=>void criar(e)} style={{display:'grid',gap:12,maxWidth:640}}>
 <label>Nome da regra<input name="nome" required maxLength={100}/></label>
 <label>Tipo<select aria-label="Tipo de automação" value={tipo} onChange={e=>setTipo(e.target.value as typeof tipo)}><option value="lembrete">Lembrete de reunião</option><option value="followup">Follow-up por etapa</option></select></label>
 <label>{tipo==='lembrete'?'Minutos antes da reunião':'Minutos após entrar na etapa'}<input name="minutos" type="number" min={15} max={10080} defaultValue={60} required/></label>
 {tipo==='followup'&&<label>Etapa<select aria-label="Etapa" name="etapa" required>{etapas.map(e=><option key={e.chave} value={e.chave}>{e.rotulo}</option>)}</select></label>}
 <label>Canal<select aria-label="Canal de envio" value={canal} onChange={e=>setCanal(e.target.value as typeof canal)}><option value="uazapi">WhatsApp conectado</option>{moduloAtivo('campanhas')&&<option value="meta">Meta oficial</option>}</select></label>
 <label>Texto da mensagem<textarea name="texto" required maxLength={1000} key={tipo} defaultValue={tipo==='lembrete'?'Olá {{primeiro_nome}}, {{assunto}} está marcada para {{dia}} às {{hora}}. Podemos confirmar?':'Olá {{primeiro_nome}}, podemos conversar sobre {{assunto}}?'}/></label>
 <small>Variáveis: {'{{nome}}, {{primeiro_nome}}, {{assunto}}, {{dia}}, {{hora}}'}. Dia e hora são do compromisso nos lembretes; no follow-up, da entrada na etapa.</small>
 {canal==='meta'&&<><label>Nome do modelo aprovado<input name="modelo" required pattern="[a-z][a-z0-9_]*"/></label><label>Idioma<input name="idioma" defaultValue="pt_BR" required/></label><label>Parâmetros do modelo<textarea name="parametros" defaultValue={'{"body":["{{nome}}","{{dia}}","{{hora}}"]}'}/></label><small>A Meta envia o texto do modelo aprovado. O texto acima é usado pelo WhatsApp conectado. Lembretes precisam de modelo UTILITY.</small></>}
 <Button type="submit" variant="primary" disabled={ocupado}>Salvar regra desligada</Button>
 </form></Card>
 <Card style={{padding:20}}><h2>Regras</h2>{regras.length===0?<p>Nenhuma regra configurada.</p>:regras.map(r=><div key={r.id} style={{display:'flex',gap:12,alignItems:'center',justifyContent:'space-between',padding:'12px 0'}}><div><strong>{r.nome}</strong><p>{r.tipo==='lembrete'?'Lembrete':'Follow-up'} · {r.minutos} min · {r.canal} · {r.ativa?'Ativa':'Desligada'}</p></div><Button disabled={ocupado} onClick={()=>void ativar(r)}>{r.ativa?'Desligar':'Ativar'} {r.nome}</Button></div>)}</Card>
 <Card style={{margin:'16px 0',padding:20}}><h2>Autorização do contato</h2><form onSubmit={e=>void autorizar(e)} style={{display:'grid',gap:12,maxWidth:640}}>
 <label>Contato<select aria-label="Contato" name="contato" required defaultValue=""><option value="" disabled>Selecione um contato</option>{contatos.map(c=><option key={c.id} value={c.id}>{c.nome||c.whatsapp||'Sem nome'}</option>)}</select></label>
 <label>Origem da autorização<input name="fonte" required minLength={5} maxLength={500} placeholder="Autorizou pelo WhatsApp em…"/></label>
 <label><input type="checkbox" name="autorizar"/> Autoriza lembretes e follow-up</label>
 <Button type="submit" disabled={ocupado}>Registrar preferência</Button>
 </form><p>{permissoes.filter(p=>p.autorizado).length} contato(s) autorizado(s).</p>
 {permissoes.map(p=><p key={p.contato_id}>{contatos.find(c=>c.id===p.contato_id)?.nome||p.contato_id}: {p.autorizado?'autorizado':'bloqueado'} · {p.fonte}</p>)}
 </Card>
 <Card style={{padding:20}}><h2>Últimos envios</h2>{envios.length===0?<p>Nenhum envio programado.</p>:<table><thead><tr><th>Prazo</th><th>Situação</th><th>Detalhe</th></tr></thead><tbody>{envios.map(e=><tr key={e.id}><td>{new Date(e.vence_em).toLocaleString('pt-BR')}</td><td>{e.estado}</td><td>{e.erro||'—'}</td></tr>)}</tbody></table>}</Card>
 </>}
 </div>
}
