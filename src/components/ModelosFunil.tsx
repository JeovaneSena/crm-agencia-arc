import {useState} from 'react'
import {supabase} from '../lib/supabase'
import {recarregarFunil} from '../lib/funil'
import modelos from '../lib/modelosNicho.json'
import {Button,Card,Notice} from './ui'
export default function ModelosFunil(){
 const [modelo,setModelo]=useState('generico'),[confirmado,setConfirmado]=useState(false),[aviso,setAviso]=useState(''),[ocupado,setOcupado]=useState(false)
 async function aplicar(){setOcupado(true);const r=await supabase.rpc('funil_modelo_aplicar',{p_modelo:modelo});setAviso(r.error?'Não foi possível aplicar o modelo.':'Modelo aplicado. Os registros e as regras das etapas foram preservados.');if(!r.error){await recarregarFunil();setConfirmado(false)}setOcupado(false)}
 async function confirmar(){setOcupado(true);const r=await supabase.rpc('funil_confirmar');setAviso(r.error?'Não foi possível confirmar o funil.':'Funil atual confirmado.');setOcupado(false)}
 const m=modelos.find(m=>m.chave===modelo)!
 return <Card style={{padding:20,marginBottom:20}}><h2>Modelo de funil</h2><label>Nicho<select aria-label="Nicho" className="arc-field" value={modelo} onChange={e=>{setModelo(e.target.value);setConfirmado(false)}}>{modelos.map(m=><option key={m.chave} value={m.chave}>{m.nome}</option>)}</select></label><p>{m.rotulos.join(' → ')}</p><p>Aplicar substitui os oito nomes exibidos. Ordem, cores, exigências, automações e histórico permanecem. As etapas de reunião continuam vinculadas à agenda.</p><label><input type="checkbox" checked={confirmado} onChange={e=>setConfirmado(e.target.checked)}/>Confirmo a substituição dos nomes das etapas</label><div><Button disabled={ocupado||!confirmado} onClick={()=>void aplicar()}>Aplicar modelo</Button><Button disabled={ocupado} onClick={()=>void confirmar()}>Usar meu funil atual</Button></div>{aviso&&<Notice>{aviso}</Notice>}</Card>
}
