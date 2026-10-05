import {useCallback,useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import {supabase} from '../lib/supabase'
import {Button,Card,Notice,PageHeader} from '../components/ui'
interface Caso {id:string;contato_id:string;motivo:string;resumo:string;estado:string;solucao:string|null;contato:{nome:string|null}|null}
export default function Casos(){
 const [linhas,setLinhas]=useState<Caso[]>([]),[erro,setErro]=useState(''),[ocupado,setOcupado]=useState(false),[solucoes,setSolucoes]=useState<Record<string,string>>({}),[avaliacoes,setAvaliacoes]=useState<Record<string,string>>({})
 const carregar=useCallback(()=>supabase.from('assistente_casos').select('id,contato_id,motivo,resumo,estado,solucao,contato:contatos_dados(nome)').order('criado_em',{ascending:false}).limit(100).then(r=>{setErro(r.error?'Não foi possível carregar os casos.':'');setLinhas(r.data as unknown as Caso[]??[])}),[])
 useEffect(()=>{void carregar()},[carregar])
 async function agir(c:Caso,finalizar=false){setOcupado(true);const r=await supabase.rpc(finalizar?'assistente_caso_finalizar':'assistente_caso_assumir',finalizar?{p_id:c.id,p_solucao:solucoes[c.id],p_avaliacao:avaliacoes[c.id]??'necessario'}:{p_id:c.id});if(r.error)setErro('Não foi possível alterar o caso. Confira quem assumiu e preencha a solução.');else await carregar();setOcupado(false)}
 return <div className="page-content"><PageHeader title="Casos da equipe" description="Leia o contexto, assuma o atendimento e registre a solução." actions={<Button onClick={()=>void carregar()}>Atualizar casos</Button>}/>{erro&&<Notice tone="danger">{erro}</Notice>}
 {linhas.length===0&&<p>Nenhum caso registrado.</p>}{linhas.map(c=><Card key={c.id} style={{padding:20,marginBottom:16}}><h2>{c.contato?.nome??'Contato sem nome'} · {c.estado}</h2><p>{c.resumo}</p><Link to={`/conversas?lead=${c.contato_id}`}>Abrir conversa</Link> · <Link to={`/leads/${c.contato_id}`}>Ficha do contato</Link>
 {c.estado==='aguardando'&&<Button disabled={ocupado} onClick={()=>void agir(c)}>Assumir caso</Button>}
 {c.estado==='em_atendimento'&&<><label>Solução do caso<textarea maxLength={4000} value={solucoes[c.id]??''} onChange={e=>setSolucoes({...solucoes,[c.id]:e.target.value})}/></label><label>Avaliação do encaminhamento<select aria-label="Avaliação do encaminhamento" value={avaliacoes[c.id]??'necessario'} onChange={e=>setAvaliacoes({...avaliacoes,[c.id]:e.target.value})}><option value="necessario">Necessário</option><option value="desnecessario">Desnecessário</option></select></label><Button disabled={ocupado||(solucoes[c.id]?.trim().length??0)<3} onClick={()=>void agir(c,true)}>Finalizar caso</Button></>}
 {c.solucao&&<p>Solução: {c.solucao}</p>}</Card>)}</div>
}
