import Distribuicao from '../components/Distribuicao'
import {useState} from 'react'
import {supabase} from '../lib/supabase'
import {moeda} from '../lib/oportunidades'
import {Button,Card,Notice,PageHeader} from '../components/ui'
interface Relatorio {
 desempenho:{id:string;nome:string;ganhos:number;perdas:number;valor:number}[]
 conversas_disponiveis:boolean
 conversas:{id:string;conversas:number;primeiras_respostas:number;primeira_resposta_minutos:number|null}[]
 perdas:{motivo:string;etapa:string;quantidade:number}[]
 previsao:{total:number;ponderado:number;quantidade:number;sem_data:number}
}
interface Evento {id:number;tabela:string;registro_id:string;operacao:string;usuario_id:string|null;campos:string[];criado_em:string}
interface Diagnostico {tabelas_sem_rls:string[];auditoria_protegida:boolean;migracoes:number;gestores_ativos:number;tabelas_sem_auditoria?:string[];tabelas_sem_mfa?:string[];seguranca_api?:boolean;eventos_pendentes?:number;eventos_parados?:number;saidas_incertas?:number}
export default function Gestao(){
 const hoje=new Date().toISOString().slice(0,10)
 const [anonimos,setAnonimos]=useState<{mes:string;ganhos:number;perdas:number;total:number}[]>([])
 const [inicio,setInicio]=useState(hoje.slice(0,8)+'01'),[fim,setFim]=useState(hoje),[dados,setDados]=useState<Relatorio|null>(null),[eventos,setEventos]=useState<Evento[]>([]),[diagnostico,setDiagnostico]=useState<Diagnostico|null>(null),[aviso,setAviso]=useState(''),[ocupado,setOcupado]=useState(false)
 async function consultar(){
  setOcupado(true);setAviso('')
  try {
   const ate=new Date(fim+'T00:00:00Z');ate.setUTCDate(ate.getUTCDate()+1)
   const [r,a,d,an]=await Promise.all([supabase.rpc('relatorio_gestao',{p_inicio:inicio+'T00:00:00Z',p_fim:ate.toISOString()}),supabase.from('auditoria').select('*').gte('criado_em',inicio+'T00:00:00Z').lt('criado_em',ate.toISOString()).order('id',{ascending:false}).limit(200),supabase.rpc('diagnostico_base'),supabase.from('resultados_anonimos').select('*').gte('mes',inicio.slice(0,7)+'-01').lte('mes',fim.slice(0,7)+'-01').order('mes')])
   if(r.error||a.error||d.error||an.error){setAviso('Não foi possível consultar. Confira o período e as migrações da instalação.');return}
   setDados(r.data);setEventos(a.data??[]);setDiagnostico(d.data);setAnonimos(an.data??[])
  }catch{setAviso('Falha de conexão. Tente novamente.')}finally{setOcupado(false)}
 }
 return <div className="page-content"><PageHeader title="Relatórios e auditoria" description="Resultados por responsável, previsão de receita e histórico de alterações."/>
 <Distribuicao/>
 <form onSubmit={e=>{e.preventDefault();void consultar()}} style={{display:'flex',gap:16,flexWrap:'wrap',marginBottom:20}}><label>De<input className="arc-field" type="date" required value={inicio} onChange={e=>setInicio(e.target.value)}/></label><label>Até<input className="arc-field" type="date" required min={inicio} value={fim} onChange={e=>setFim(e.target.value)}/></label><Button disabled={ocupado} type="submit">{ocupado?'Consultando…':'Consultar'}</Button></form>
 {aviso&&<Notice tone="danger">{aviso}</Notice>}
 {dados&&<><Card style={{padding:20,marginBottom:20}}><h2>Previsão de fechamento</h2><p>{dados.previsao.quantidade} negociações · {moeda(dados.previsao.total)} em propostas · <strong>{moeda(dados.previsao.ponderado)} ponderados</strong>.</p><p>{dados.previsao.sem_data} negociações abertas sem data prevista. Configure a probabilidade de cada etapa no funil. A previsão é uma estimativa, não receita contratada.</p></Card>
 <Card style={{padding:20,overflowX:'auto',marginBottom:20}}><h2>Desempenho por responsável</h2><p>Resultados atribuídos ao responsável atual. Perdas contam mudanças para Perdido no período. Datas consideradas em UTC.</p><table style={{width:'100%'}}><thead><tr><th>Pessoa</th><th>Ganhos</th><th>Perdas</th><th>Receita</th>{dados.conversas_disponiveis&&<><th>Conversas</th><th>Primeira resposta</th></>}</tr></thead><tbody>{dados.desempenho.map(p=>{const c=dados.conversas.find(c=>c.id===p.id);return <tr key={p.id}><td>{p.nome}</td><td>{p.ganhos}</td><td>{p.perdas}</td><td>{moeda(p.valor)}</td>{dados.conversas_disponiveis&&<><td>{c?.conversas??0}</td><td>{c?.primeira_resposta_minutos==null?'Sem amostra':`${Number(c.primeira_resposta_minutos).toFixed(1)} min (${c.primeiras_respostas})`}</td></>}</tr>})}</tbody></table>{dados.conversas_disponiveis&&<p>Conversas: contatos com envio humano confirmado. Primeira resposta: primeiro envio humano após a primeira mensagem recebida de cada contato dentro do período; respostas fora do período não entram na média.</p>}</Card>
 <Card style={{padding:20,marginBottom:20}}><h2>Motivos e etapas de perda</h2>{dados.perdas.length?dados.perdas.map((p,i)=><p key={i}>{p.motivo} · {p.etapa}: {p.quantidade}</p>):<p>Nenhuma oportunidade atualmente perdida com evento no período.</p>}</Card></>}
 {!!anonimos.length&&<Card style={{padding:20,marginBottom:20}}><h2>Resultados agregados após anonimização</h2><p>Totais mensais sem identificação ou vínculo individual. Inclui meses inteiros que intersectam o período; estes valores são mostrados separadamente dos resultados individuais.</p>{anonimos.map(a=><p key={a.mes}>{a.mes.slice(0,7)} · {a.ganhos} ganhos · {a.perdas} perdas · {moeda(a.total)}</p>)}</Card>}
 {diagnostico&&<Card style={{padding:20,marginBottom:20}}><h2>Diagnóstico da base</h2><p>{diagnostico.migracoes} migrações · {diagnostico.gestores_ativos} gestores ativos.</p><Notice tone={diagnostico.auditoria_protegida&&!diagnostico.tabelas_sem_rls.length&&!diagnostico.tabelas_sem_auditoria?.length&&!diagnostico.tabelas_sem_mfa?.length&&diagnostico.seguranca_api?'success':'danger'}>{diagnostico.auditoria_protegida?'Auditoria protegida.':'Revise a proteção da auditoria.'} {diagnostico.tabelas_sem_rls.length?`Tabelas sem RLS: ${diagnostico.tabelas_sem_rls.join(', ')}`:'Todas as tabelas públicas têm RLS.'}</Notice><p>{diagnostico.seguranca_api?'Verificação de sessão configurada.':'Revise a verificação de sessão na API.'}</p><p>Sem auditoria: {diagnostico.tabelas_sem_auditoria?.join(', ')||'nenhuma'}. Sem proteção de segundo fator: {diagnostico.tabelas_sem_mfa?.join(', ')||'nenhuma'}.</p><p>{diagnostico.eventos_pendentes??0} eventos pendentes · {diagnostico.eventos_parados??0} aguardando mais de 15 minutos · {diagnostico.saidas_incertas??0} saídas incertas.</p></Card>}
 {dados&&<Card style={{padding:20,overflowX:'auto'}}><h2>Auditoria</h2><p>Até 200 alterações mais recentes no período. Registra autor, operação e nomes dos campos, sem copiar os valores pessoais.</p><table style={{width:'100%'}}><thead><tr><th>Data</th><th>Tabela / registro</th><th>Operação</th><th>Autor</th><th>Campos</th></tr></thead><tbody>{eventos.map(e=><tr key={e.id}><td>{new Date(e.criado_em).toLocaleString('pt-BR')}</td><td>{e.tabela} / {e.registro_id}</td><td>{e.operacao}</td><td>{e.usuario_id??'Servidor'}</td><td>{e.campos.join(', ')}</td></tr>)}</tbody></table>{!eventos.length&&<p>Nenhuma alteração no período.</p>}</Card>}</div>
}
