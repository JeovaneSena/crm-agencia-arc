import {useCallback,useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import {supabase} from '../lib/supabase'
import {moduloAtivo} from '../lib/modulos'
import {Button,Card,Notice,PageHeader} from '../components/ui'
import ModelosFunil from '../components/ModelosFunil'
interface Estado {empresa:boolean;catalogo:boolean;horarios:boolean;funil:boolean;concluida_em:string|null}
export default function Preparacao(){
 const [estado,setEstado]=useState<Estado|null>(null),[aviso,setAviso]=useState(''),[ocupado,setOcupado]=useState(false)
 const carregar=useCallback(()=>supabase.rpc('preparacao_status').then(r=>{if(r.error){setAviso('Não foi possível conferir a preparação.');return}setEstado(r.data)}),[])
 useEffect(()=>{void carregar()},[carregar])
 async function concluir(){setOcupado(true);const r=await supabase.rpc('preparacao_concluir');setAviso(r.error?'Complete empresa, catálogo, horários e confirme o funil.':'Preparação concluída.');if(!r.error)await carregar();setOcupado(false)}
 const passos=[['empresa','Dados da empresa','/configuracoes?aba=empresa','Defina nome, identidade visual e fuso horário.'],['catalogo','Catálogo de serviços','/servicos','Cadastre o que sua operação oferece.'],['horarios','Horários de atendimento','/configuracoes?aba=horarios','Confira a jornada usada pela agenda.'],['funil','Funil e informações do nicho','/configuracoes?aba=personalizacao','Escolha ou confirme o funil abaixo e configure campos e motivos de perda.']] as const
 return <div className="page-content"><PageHeader title="Prepare seu CRM" description="Configure a operação antes do primeiro atendimento. Você pode voltar a este guia pelas Configurações."/>{aviso&&<Notice>{aviso}</Notice>}{estado?.concluida_em&&<Notice>Preparação registrada em {new Date(estado.concluida_em).toLocaleString('pt-BR')}.</Notice>}
 <div style={{display:'grid',gap:16,marginBottom:20}}>{passos.map(([key,titulo,link,descricao],i)=><Card key={key} style={{padding:20}}><h2>{i+1}. {titulo} · {estado?.[key]?'Conferido':'Pendente'}</h2><p>{descricao}</p><Link to={link}>Configurar {titulo.toLowerCase()}</Link></Card>)}</div><ModelosFunil/>
 <Card style={{padding:20,marginBottom:20}}><h2>Equipe, integrações e primeiro teste</h2><p><Link to="/usuarios">Convide sua equipe</Link> e confira o acesso com uma conta consultora. <Link to="/leads">Cadastre um contato de teste</Link>, preencha os campos e mova uma oportunidade entre etapas.</p>{moduloAtivo('conversas')&&<p><Link to="/conversas">Conecte o WhatsApp</Link> e confira recebimento e envio com um número de teste.</p>}{moduloAtivo('assistente')&&<p><Link to="/assistente-ia">Configure o assistente</Link>, tarifas e orçamento. Teste com números permitidos antes de ativar ao vivo.</p>}{moduloAtivo('campanhas')&&<p><Link to="/campanhas">Confira a integração Meta</Link> e os modelos aprovados antes de iniciar envios.</p>}<p>Concluir este guia registra a configuração básica. O teste das integrações e o aceite da instalação devem ser feitos separadamente.</p></Card>
 <Button disabled={ocupado} onClick={()=>void carregar()}>Conferir novamente</Button> <Button disabled={ocupado||!estado} onClick={()=>void concluir()}>Concluir preparação</Button></div>
}
