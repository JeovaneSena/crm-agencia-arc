import {useCallback,useEffect,useState} from 'react'
import {supabase} from '../lib/supabase'
import {Button,Card,Notice,PageHeader} from '../components/ui'
interface Proposta {id:string;titulo:string;contato_id:string;evidencia:string;conteudo:string;estado:string}
interface Teste {id:string;proposta_id:string;apto:boolean;resultado:{base:{ok:boolean;texto?:string;motivo?:string};candidato:{ok:boolean;texto?:string;motivo?:string}}}
interface Versao {id:string;conteudo:string;criada_em:string}
export default function MelhoriasAssistente(){
 const [propostas,setPropostas]=useState<Proposta[]>([]),[testes,setTestes]=useState<Teste[]>([]),[versoes,setVersoes]=useState<Versao[]>([]),[ativa,setAtiva]=useState('')
 const [contatos,setContatos]=useState<{id:string;nome:string|null}[]>([]),[titulo,setTitulo]=useState(''),[contato,setContato]=useState(''),[evidencia,setEvidencia]=useState(''),[conteudo,setConteudo]=useState(''),[aviso,setAviso]=useState(''),[ocupado,setOcupado]=useState(false)
 const carregar=useCallback(()=>Promise.all([
  supabase.from('assistente_melhorias').select('*').order('criada_em',{ascending:false}).limit(50),supabase.from('assistente_melhoria_testes').select('*').order('criado_em',{ascending:false}).limit(100),supabase.from('assistente_melhoria_versoes').select('*').order('criada_em',{ascending:false}).limit(50),supabase.from('assistente_melhoria_controle').select('versao_id').maybeSingle(),supabase.from('contatos_dados').select('id,nome').order('created_at',{ascending:false}).limit(100)
 ]).then(([p,t,v,c,l])=>{if([p,t,v,c,l].some(r=>r.error)){setAviso('Não foi possível carregar as revisões.');return}setPropostas(p.data??[]);setTestes(t.data??[]);setVersoes(v.data??[]);setAtiva(c.data?.versao_id??'');setContatos(l.data??[])}),[])
 useEffect(()=>{void carregar()},[carregar])
 async function criar(e:React.FormEvent){e.preventDefault();setOcupado(true);const r=await supabase.rpc('assistente_melhoria_criar',{p_titulo:titulo,p_contato:contato,p_evidencia:evidencia,p_conteudo:conteudo});setAviso(r.error?'Não foi possível criar a proposta.':'Proposta criada. Compare e revise antes de aprovar.');if(!r.error){setTitulo('');setEvidencia('');setConteudo('');await carregar()}setOcupado(false)}
 async function comparar(id:string){setOcupado(true);const r=await supabase.functions.invoke('melhorias',{body:{proposta_id:id}});setAviso(r.error||!r.data?.ok?'Não foi possível comparar. Confira os custos e a configuração.':'Comparação pronta. Leia os dois textos antes de aprovar.');await carregar();setOcupado(false)}
 async function aprovar(p:Proposta,t:Teste){setOcupado(true);const r=await supabase.rpc('assistente_melhoria_aprovar',{p_proposta:p.id,p_teste:t.id});setAviso(r.error?'Teste desatualizado ou sem acesso. Compare novamente.':'Melhoria aprovada. A nova instrução será usada nas próximas chamadas.');await carregar();setOcupado(false)}
 async function rejeitar(id:string){setOcupado(true);const r=await supabase.rpc('assistente_melhoria_rejeitar',{p_id:id});setAviso(r.error?'Não foi possível rejeitar.':'Proposta rejeitada.');await carregar();setOcupado(false)}
 async function reverter(v:Versao){setOcupado(true);const r=await supabase.rpc('assistente_melhoria_reverter',{p_versao:v.id,p_atual:ativa});setAviso(r.error?'Não foi possível restaurar. Atualize as versões.':'Versão restaurada.');await carregar();setOcupado(false)}
 return <div className="page-content"><PageHeader title="Revisão do assistente" description="Registre uma correção observada, compare o resultado e aprove a instrução. A comparação não envia mensagens e usa o orçamento da IA."/>{aviso&&<Notice>{aviso}</Notice>}
 <Card style={{padding:20,marginBottom:20}}><form onSubmit={e=>void criar(e)} style={{display:'grid',gap:12,maxWidth:760}}>
 <label>Título da melhoria<input required minLength={3} maxLength={160} value={titulo} onChange={e=>setTitulo(e.target.value)}/></label>
 <label>Contato da evidência<select aria-label="Contato da evidência" required value={contato} onChange={e=>setContato(e.target.value)}><option value="">Escolha uma conversa</option>{contatos.map(c=><option key={c.id} value={c.id}>{c.nome??'Contato sem nome'}</option>)}</select></label>
 <label>O que precisa melhorar<textarea required minLength={3} maxLength={4000} value={evidencia} onChange={e=>setEvidencia(e.target.value)}/></label>
 <label>Instrução proposta<textarea required minLength={3} maxLength={4000} value={conteudo} onChange={e=>setConteudo(e.target.value)}/></label>
 <p>A instrução substitui a melhoria ativa e complementa as informações do negócio. As proteções de envio continuam no servidor.</p>
 <Button type="submit" disabled={ocupado}>Criar proposta</Button></form></Card>
 {propostas.map(p=>{const t=testes.find(t=>t.proposta_id===p.id);return <Card key={p.id} style={{padding:20,marginBottom:16}}><h2>{p.titulo} · {p.estado}</h2><p>{p.evidencia}</p><blockquote>{p.conteudo}</blockquote>
 {['rascunho','testada'].includes(p.estado)&&<><Button disabled={ocupado} onClick={()=>void comparar(p.id)}>Comparar {p.titulo}</Button><Button disabled={ocupado} onClick={()=>void rejeitar(p.id)}>Rejeitar {p.titulo}</Button></>}
 {t&&<><h3>Resposta atual</h3><p>{t.resultado.base?.texto??t.resultado.base?.motivo??'Sem resposta'}</p><h3>Com a instrução proposta</h3><p>{t.resultado.candidato?.texto??t.resultado.candidato?.motivo??'Sem resposta'}</p><p>O teste confere as proteções técnicas. A adequação da resposta depende da sua revisão.</p>
 {p.estado==='testada'&&<Button disabled={ocupado||!t.apto} onClick={()=>void aprovar(p,t)}>Aprovar {p.titulo}</Button>}</>}
 </Card>})}
 <Card style={{padding:20}}><h2>Versões de instruções</h2>{versoes.map(v=><div key={v.id}><p>{new Date(v.criada_em).toLocaleString('pt-BR')} · {v.id===ativa?'Ativa':'Anterior'}</p><blockquote>{v.conteudo||'Sem instrução complementar'}</blockquote>{v.id!==ativa&&<Button disabled={ocupado} onClick={()=>void reverter(v)}>Restaurar versão {v.id.slice(0,8)}</Button>}</div>)}</Card>
 </div>
}
