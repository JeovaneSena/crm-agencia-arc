import { useEffect,useState } from 'react'
import { Button,Card,Notice } from './ui'
import { supabase } from '../lib/supabase'
export default function CustosAssistente({modelo}:{modelo:string}) {
 const [teto,setTeto]=useState(50),[entrada,setEntrada]=useState(''),[saida,setSaida]=useState('')
 const [gasto,setGasto]=useState({gasto:0,reservado:0}),[aviso,setAviso]=useState(''),[ocupado,setOcupado]=useState(false)
 const [saldo,setSaldo]=useState({openai:true,anthropic:true})
 useEffect(()=>{let vivo=true;void Promise.all([
  supabase.from('assistente_config').select('teto_mensal_usd,saldo_openai,saldo_anthropic').maybeSingle(),
  supabase.from('assistente_tarifas').select('entrada,saida').eq('modelo',modelo).maybeSingle(),supabase.rpc('assistente_consumo_resumo')
 ]).then(([c,t,r])=>{if(!vivo)return;if(c.error||t.error||r.error){setAviso('Não foi possível carregar os custos.');return}setTeto(Number(c.data?.teto_mensal_usd??50));setEntrada(t.data?.entrada===undefined?'':String(t.data.entrada));setSaida(t.data?.saida===undefined?'':String(t.data.saida));setGasto(r.data??{gasto:0,reservado:0});setSaldo({openai:c.data?.saldo_openai??true,anthropic:c.data?.saldo_anthropic??true})});return()=>{vivo=false}},[modelo])
 async function salvar(e:React.FormEvent){e.preventDefault();setOcupado(true);const r=await supabase.rpc('assistente_financeiro_salvar',{p_teto:teto,p_modelo:modelo,p_entrada:Number(entrada),p_saida:Number(saida)});setAviso(r.error?'Não foi possível salvar os custos.':'Custos salvos.');setOcupado(false)}
 async function recarga(provedor:'openai'|'anthropic'){setOcupado(true);const r=await supabase.rpc('assistente_recarga_confirmar',{p_provedor:provedor});setAviso(r.error?'Não foi possível confirmar a recarga.':'Recarga confirmada. Respostas pendentes serão conferidas pelo vigia.');if(!r.error)setSaldo({...saldo,[provedor]:true});setOcupado(false)}
 return <Card style={{padding:20,marginTop:24,maxWidth:760}} aria-label="Orçamento da IA"><h2>Orçamento da IA</h2>
 <p>Consumo estimado neste mês (UTC): US$ {Number(gasto.gasto).toFixed(4)} · reservas e chamadas incertas: US$ {Number(gasto.reservado).toFixed(4)}.</p>
 <p>Cadastre as tarifas do modelo {modelo}, em dólares por milhão de tokens. Sem tarifa, o modelo aguarda configuração. Os custos dependem das tarifas cadastradas e não substituem a fatura do provedor.</p>
 <form onSubmit={e=>void salvar(e)} style={{display:'grid',gap:12}}>
 <label>Teto mensal (US$)<input type="number" min={0} max={10000} step="0.01" required value={teto} onChange={e=>setTeto(Number(e.target.value))}/></label>
 <label>Entrada por milhão de tokens (US$)<input type="number" min={0.000001} max={10000} step="any" required value={entrada} onChange={e=>setEntrada(e.target.value)}/></label>
 <label>Saída por milhão de tokens (US$)<input type="number" min={0.000001} max={10000} step="any" required value={saida} onChange={e=>setSaida(e.target.value)}/></label>
 <Button type="submit" disabled={ocupado}>Salvar orçamento</Button></form>
 {(['openai','anthropic'] as const).map(p=><p key={p}>{p}: {saldo[p]?'disponível':'aguardando recarga'} <Button disabled={ocupado||saldo[p]} onClick={()=>void recarga(p)}>Confirmar recarga de {p}</Button></p>)}
 {aviso&&<Notice>{aviso}</Notice>}
 </Card>
}
