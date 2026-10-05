// UI smoke tests use isolated mocked API responses. Database invariants are
// tested separately by agency-check.sql inside a rollback transaction.
import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
const base = 'http://127.0.0.1:5187'
const comConversas = process.argv.includes('--conversas')
const comProjetos = process.argv.includes('--projetos')
const comCasos=process.argv.includes('--casos')
const comMelhorias=process.argv.includes('--melhorias')
const comAssistente = process.argv.includes('--assistente')||comCasos||comMelhorias
const comCampanhas = process.argv.includes('--campanhas')
const comCaptacao = process.argv.includes('--captacao')
const supabaseUrl = 'https://crm-base-test.supabase.co'
const project = 'crm-base-test'
const modulosLigados = [(comConversas || comAssistente || comCampanhas) && 'conversas', comProjetos && 'projetos', comAssistente && 'assistente', comCampanhas && 'campanhas', comCaptacao && 'captacao', comCasos && 'casos', comMelhorias && 'melhorias'].filter(Boolean).join(',')
// Um servidor sobrando de um teste anterior responderia no lugar do nosso, com outros módulos ligados.
if (await fetch(base).then(() => true, () => false)) throw Error('A porta 5187 já está em uso (servidor de um teste anterior?). Encerre-o antes de rodar.')
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5187', '--strictPort'], { stdio: 'ignore', env: { ...process.env, VITE_MODULOS: modulosLigados, VITE_SUPABASE_URL: supabaseUrl, VITE_SUPABASE_ANON_KEY: 'chave-ficticia-para-testes' } })
await Promise.race([
 (async () => { for (let i=0;i<80;i++) { try { if ((await fetch(base)).ok) return } catch {} await delay(100) } throw Error('Servidor de teste não iniciou') })(),
 new Promise((_,reject) => server.once('exit',code => reject(Error('Servidor encerrou: '+code))))
]).catch(e => { server.kill(); throw e })
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'test@example.invalid', role: 'authenticated', app_metadata: {}, user_metadata: {} }
const session = { access_token: 'test.token.signature', refresh_token: 'test-refresh', expires_at: Math.floor(Date.now()/1000)+3600, expires_in:3600, token_type:'bearer', user }
let opportunities = []
let provider='uazapi', metaConsent=false, metaSent=null, papel='gestor'
let connectionState='conectado'
const now = new Date().toISOString()
const lead = { id:'00000000-0000-4000-8000-000000000002', nome:'Contato de teste', whatsapp:'5511999999999', empresa:'Empresa Teste', email:'teste@example.invalid', status:'ganho', interesses:['Serviço A'], interesses_texto:'Serviço A', resumo_conversa:null, anotacoes:null, created_at:now, inicio_atendimento:now, ultima_mensagem:null, minutos_ultima_mensagem:null, ultima_reuniao:null, proxima_reuniao:null, cliente_desde:now }
let fontesCaptacao=[{id:'00000000-0000-4000-8000-000000000025',nome:'Site de teste',ativa:false}]
const recebimentosCaptacao=[{id:'rc1',fonte_id:fontesCaptacao[0].id,resultado:'criado',motivo:null,recebido_em:now,utm:{utm_source:'google',utm_campaign:'outubro'},contato_id:lead.id,contato:{nome:lead.nome}},{id:'rc2',fonte_id:fontesCaptacao[0].id,resultado:'recusado',motivo:'telefone_invalido',recebido_em:now,utm:{},contato_id:null,contato:null}]
const opportunity = { id:'opp-inicial', contato_id:lead.id, nome:'Venda inicial', status:'ganho', valor_proposta:1250, servicos_contratados:['Serviço A'], escopo:'Escopo inicial', fechado_em:now, cancelado_em:null, created_at:now, updated_at:now, contato:lead }
const services = ['Reunião inicial','Serviço A','Serviço B'].map((nome,i)=>({ id:String(i), nome, descricao:'Descrição curta', descricao_longa:null, ativo:true, arquivado:false, e_reuniao_previa:i===0, exige_reuniao_previa:i!==0, preco_a_partir_de:null, duracao_minutos:30 }))
const professional = { id:'00000000-0000-4000-8000-000000000004',nome:'Ana',sobrenome:'Silva',cor:'#1E6E8C',ativo:true,created_at:now,updated_at:now }
const inicio = new Date(); inicio.setHours(14,0,0,0)
const meeting = { id:'meeting-1',contato_id:lead.id,profissional_id:professional.id,assunto:'Reunião inicial',interesse:'Serviço A',data_reuniao:inicio.toISOString(),data_fim:new Date(inicio.getTime()+3600000).toISOString(),duracao_minutos:60,status:'agendada',origem:'equipe',contato:lead,profissional:professional,created_at:now,updated_at:now }
const campanhaLinha = { id:'camp-1', nome:'Promo de outubro', objetivo:null, estado:'pronta', modelo_nome:'promo_outubro', criada_em:now, iniciada_em:null, concluida_em:null, motivo:null, revisao_hash:'hash1', aptos:1, excluidos:2, na_fila:1, aceitos:0, entregues:0, lidos:0, falhas:0, incertos:0 }
const campanhaCompleta = { ...campanhaLinha, modelo_id:'m1', modelo_idioma:'pt_BR', modelo_snapshot:{campos:[{tipo:'body',quantidade:2,texto:'Olá {{1}}, {{2}}'}]}, mapeamento_parametros:[{tipo:'body',posicao:1,origem:'primeiro_nome'},{tipo:'body',posicao:2,origem:'fixo',valor:'temos novidades'}], filtros_publico:{}, publico_congelado_em:now, limite_destinatarios:1000, intervalo_minimo_horas:24, pausada_em:null, cancelada_em:null }
const destinatarios = [
 {id:'d1',contato_id:lead.id,whatsapp:'5511999999999',nome:'Maria Souza',valores:{body:['Maria','temos novidades']},apto:true,motivo_exclusao:null,estado:'pendente',erro:null,tentativas:0},
 {id:'d2',contato_id:'c2',whatsapp:'5511988888888',nome:'Joana',valores:{},apto:false,motivo_exclusao:'sem_consentimento',estado:'excluido',erro:null,tentativas:0},
 {id:'d3',contato_id:'c3',whatsapp:'5511977777777',nome:'Pedro',valores:{},apto:false,motivo_exclusao:'pediu_para_parar',estado:'excluido',erro:null,tentativas:0}]
let consentimentoRegistrado=false
let retencao=null
let dono=null
let adiada=null
const abertasMock=[{...opportunity,id:'opp-a',nome:'Site institucional',status:'proposta',valor_proposta:5000,servicos_contratados:['Serviço A'],fechado_em:null,responsavel_id:'00000000-0000-4000-8000-000000000001',contato:{nome:'Contato de teste',empresa:'Empresa Teste',whatsapp:'5511999999999'}},{...opportunity,id:'opp-b',nome:'Tráfego pago',status:'negociacao',valor_proposta:2000,servicos_contratados:[],fechado_em:null,responsavel_id:null,contato:{nome:'Contato de teste',empresa:'Empresa Teste',whatsapp:'5511999999999'}}]
const ETQ=[{id:'e1',nome:'Quente',cor:'danger'},{id:'e2',nome:'Indicação',cor:'info'}]
let paresEtq=[{contato_id:'00000000-0000-4000-8000-000000000002',etiqueta_id:'e1'}]
let avisos=[{id:'av1',tipo:'conexao_caida',gravidade:'critico',titulo:'WhatsApp desconectado',detalhe:'Reconecte o número para voltar a receber mensagens.',rota:'/configuracoes',contato_id:null,somente_gestor:true,ocorrencias:3,criado_em:new Date().toISOString(),ultima_em:new Date().toISOString(),resolvido_em:null,resolucao:null},{id:'av2',tipo:'mensagem_presa',gravidade:'atencao',titulo:'Uma mensagem não saiu',detalhe:null,rota:'https://externo.example/phishing',contato_id:'00000000-0000-4000-8000-000000000002',somente_gestor:false,ocorrencias:1,criado_em:new Date().toISOString(),ultima_em:new Date().toISOString(),resolvido_em:null,resolucao:null}]
const amanha9=new Date();amanha9.setDate(amanha9.getDate()+1);amanha9.setHours(9,0,0,0)
const diasAdiante=(n)=>{const d=new Date();d.setDate(d.getDate()+n);d.setHours(9,0,0,0);return d.toISOString()}
const tarefaBase={detalhe:null,oportunidade_id:null,origem:'manual',criada_por:'00000000-0000-4000-8000-000000000001',concluida_em:null,concluida_por:null,created_at:now}
const tarefasMock=[
 {...tarefaBase,id:'t-venc',titulo:'Ligar para confirmar a proposta',vence_em:diasAdiante(-2),contato_id:lead.id,responsavel_id:'00000000-0000-4000-8000-000000000001',contato:{id:lead.id,nome:lead.nome}},
 {...tarefaBase,id:'t-colega',titulo:'Revisar a agenda da semana',vence_em:amanha9.toISOString(),contato_id:null,responsavel_id:'00000000-0000-4000-8000-0000000000aa',contato:null},
 {...tarefaBase,id:'t-sem',titulo:'Cobrar o briefing do cliente',vence_em:diasAdiante(3),contato_id:lead.id,responsavel_id:null,origem:'sistema',contato:{id:lead.id,nome:lead.nome}},
 {...tarefaBase,id:'t-feita',titulo:'Enviar a minuta do contrato',vence_em:diasAdiante(-1),contato_id:lead.id,responsavel_id:'00000000-0000-4000-8000-000000000001',concluida_em:new Date(Date.now()-3600000).toISOString(),concluida_por:'00000000-0000-4000-8000-000000000001',contato:{id:lead.id,nome:lead.nome}},
 {...tarefaBase,id:'t-outra',titulo:'Tarefa de OUTRA pessoa',vence_em:diasAdiante(5),contato_id:'outro-contato',responsavel_id:null,contato:{id:'outro-contato',nome:'Outra'}},
]
const radarBase={contato_nome:'Contato de teste',valor_proposta:null,protegido_por:null,esfria_apos_horas:48,ultima_atividade:now}
const radarMock=[
 {...radarBase,oportunidade_id:'opp-crit',contato_id:lead.id,nome:'Site institucional',etapa:'proposta',valor_proposta:5000,responsavel_id:'00000000-0000-4000-8000-000000000001',horas_parado:200,faixa:'critico'},
 {...radarBase,oportunidade_id:'opp-risco',contato_id:'c2',contato_nome:'Joana Prado',nome:'Tráfego pago',etapa:'qualificacao',responsavel_id:null,horas_parado:60,faixa:'em_risco'},
 {...radarBase,oportunidade_id:'opp-voo',contato_id:'c3',contato_nome:'Pedro Alves',nome:'Landing page',etapa:'negociacao',responsavel_id:'00000000-0000-4000-8000-0000000000aa',horas_parado:100,faixa:'em_voo',protegido_por:'tarefa'},
]
const browser = await chromium.launch({headless:true,args:['--no-sandbox']})
const context = await browser.newContext({viewport:{width:1440,height:1000}})
const errors=[]
const page = await context.newPage()
page.on('pageerror',e=>errors.push(e.message))
const dias = Array.from({length:7},(_,i)=>i)
let casosMock=[{id:'00000000-0000-4000-8000-000000000028',contato_id:lead.id,motivo:'pedido_pessoa',resumo:'Cliente pediu uma pessoa. Próximo passo: atender.',estado:'aguardando',solucao:null,contato:{nome:lead.nome}}]
let propostasMock=[],testesMelhoria=[]
let versoesMock=[{id:'00000000-0000-4000-8000-000000000029',conteudo:'',criada_em:now}]
let ativaMock=versoesMock[0].id
const tabelas = {
 assistente_casos:()=>casosMock,assistente_melhorias:()=>propostasMock,assistente_melhoria_testes:()=>testesMelhoria,assistente_melhoria_versoes:()=>versoesMock,assistente_melhoria_controle:()=>[{versao_id:ativaMock}],
 assistente_tarifas:()=>[{entrada:3,saida:15}],
 captacao_fontes:()=>fontesCaptacao,
 captacao_recebimentos:()=>recebimentosCaptacao,
 contato_atribuicoes:()=>[{utm:{utm_source:'google',utm_campaign:'outubro'},recebida_em:now,fonte:{nome:'Site de teste'}}],
 avisos:()=>avisos.filter(a=>!a.resolvido_em), tarefas:()=>tarefasMock, radar_negocios:()=>radarMock, etiquetas:()=>ETQ, contato_etiquetas:()=>paresEtq, contatos:()=>[lead], reunioes:()=>[meeting], profissionais:()=>[professional], catalogo_servicos:()=>services,
 oportunidades:()=>[opportunity,...abertasMock], etapas_funil:()=>[], horario_comercial:()=>[],
 profissional_horarios:()=>dias.map(d=>({id:`h${d}`,profissional_id:professional.id,dia_semana:d,hora_inicio:'08:00',hora_fim:'18:00',ativo:true})),
 projetos:()=>[{id:'proj-1',contato_id:lead.id,oportunidade_id:opportunity.id,nome:'Projeto da venda inicial',etapa:'planejamento',prazo:null,escopo:'Escopo inicial',responsavel_id:null,created_at:now,updated_at:now,cliente:{nome:lead.nome,empresa:lead.empresa,status:lead.status},oportunidade:{nome:opportunity.nome,status:'ganho',cancelado_em:null}}],
 campanhas_lista:()=>[campanhaLinha], campanhas:()=>[campanhaCompleta], campanha_destinatarios:()=>destinatarios, campanha_eventos:()=>[{id:'ev1',tipo:'publico_congelado',descricao:'Público congelado para revisão.',criado_em:now}],
 campanhas_controle:()=>[{id:true,pausado:false,pausa_motivo:null,limite_por_minuto:30,limite_diario:250,usados_no_dia:12,proximo_disparo_em:now,atualizada_em:now}],
 marketing_consentimentos:()=>consentimentoRegistrado?[{contato_id:lead.id,ativo:true,consentido_em:now,revogado_em:null,fonte:'pediu pelo WhatsApp'}]:[],
 assistente_config:()=>[{id:true,modo:'desligada',nome:'Assistente',modelo:'claude-sonnet-5-5',instrucoes:null,numeros_teste:[],max_respostas:12,espera_segundos:6,devolver_apos_minutos:null,teto_mensal_usd:50,saldo_openai:false,saldo_anthropic:true,updated_by:null,updated_at:now}],
 assistente_respostas:()=>[{mensagem_id:'r1',contato_id:lead.id,estado:'ignorada',motivo:'ia_desligada',created_at:now},{mensagem_id:'r2',contato_id:lead.id,estado:'falhou',motivo:'erro_interno',created_at:now}],
 conversa_eventos:()=>[{id:'ce1',contato_id:lead.id,tipo:'transferiu',de_usuario:user.id,para_usuario:'00000000-0000-4000-8000-0000000000aa',por_usuario:user.id,created_at:now}],
 notas_conversa:()=>[{id:'n1',contato_id:lead.id,texto:'Cliente prefere falar às terças.',autor_id:user.id,created_at:now,autor:{nome:'Equipe Teste'}}],
 respostas_rapidas:()=>[{id:'rr1',titulo:'Saudação',texto:'Oi, {{primeiro_nome}}! Como posso ajudar?',atalho:'oi',dono_id:null},{id:'rr2',titulo:'Com campo solto',texto:'Veja a proposta da {{empresa}}.',atalho:'solto',dono_id:'00000000-0000-4000-8000-000000000001'}],
 conversas_config:()=>[{id:true,provedor:'uazapi',retencao_midia_dias:retencao}],
 conversas_lista:()=>[{contato_id:lead.id,nome:lead.nome,whatsapp:lead.whatsapp,status:'novo_lead',assumida:!!dono,assumido_por:dono?.id??null,assumido_em:dono?now:null,assumido_por_nome:dono?.nome??null,ultimo_conteudo:'Quero saber mais',ultimo_tipo:'texto',ultimo_autor:'cliente',ultima_em:now,nao_lidas:1,proxima_reuniao:null,...(comAssistente?{ia_ligada:false,ia_encaminhada_em:now,ia_resumo:'Quer fechar a proposta hoje'}:{})}],
 mensagens_whatsapp:()=>[{id:'m1',contato_id:lead.id,autor:'cliente',tipo:'texto',conteudo:'Quero saber mais',midia_url:null,id_externo:'e1',provedor:'uazapi',lida:false,criada_em:now},{id:'m2',contato_id:lead.id,autor:'atendente',tipo:'texto',conteudo:'Claro, como posso ajudar?',midia_url:null,id_externo:'e2',provedor:'uazapi',estado_envio:'enviado',lida:true,criada_em:now},{id:'m3',contato_id:lead.id,autor:'cliente',tipo:'imagem',conteudo:null,midia_url:null,midia_removida_em:now,id_externo:'e3',provedor:'uazapi',lida:true,criada_em:now}],
 profissional_bloqueios:()=>[], oportunidade_eventos:()=>[{id:'ev1',status_anterior:'qualificacao',status_novo:'proposta',motivo:'Pediu orçamento',created_at:now,oportunidades:{nome:'Venda inicial',contato_id:lead.id}},{id:'ev2',status_anterior:null,status_novo:'novo_lead',motivo:null,created_at:now,oportunidades:{nome:'Negócio de OUTRA pessoa',contato_id:'outro-contato'}}], contatos_dados:()=>adiada?[{id:lead.id,adiada_ate:adiada}]:[],
 usuarios:()=>[{...user,nome:'Equipe Teste',papel,ativo:true,avatar_url:null,profissional_id:null,convidado_em:null,ultimo_acesso_em:null},{id:'00000000-0000-4000-8000-0000000000aa',nome:'Colega',papel:'consultor',ativo:true,avatar_url:null,profissional_id:null,convidado_em:null,ultimo_acesso_em:null}],
 configuracoes_negocio:()=>[{id:'config',nome_negocio:'Empresa Teste',logo_url:null,fuso_horario:'America/Sao_Paulo'}],
 resumo_periodo:()=>[{novos_contatos:1,reunioes_agendadas:1,vendas_ganhas:1,conversao:100,valor_fechado:1250,em_negociacao:0}],
 dashboard_por_dia:()=>dias.map(i=>({dia:new Date(Date.now()-(6-i)*86400000).toISOString().slice(0,10),atendimentos:3+i,agendamentos:i%3})),
 dashboard_dia_semana:()=>dias.map(i=>({dia_semana:i,contatos:i+2})),
 dashboard_profissionais:()=>[{profissional_id:professional.id,nome:'Ana Silva',cor:professional.cor,reunioes:4}],
 dashboard_servicos:()=>services.slice(1).map((s,i)=>({servico:s.nome,procurado:8-i,realizado:3-i})),
}
await context.route('**/*',async route=>{
 const url=new URL(route.request().url())
 if(url.hostname==='127.0.0.1') return route.continue()
 if(url.hostname!==new URL(supabaseUrl).hostname) return route.abort()
 const table=url.pathname.split('/').pop()
 let data=[]
 if(url.pathname.includes('/auth/')) data=user
 else if(url.pathname.endsWith('/functions/v1/whatsapp/conexao')) data={ok:true,provedor:'uazapi',estado:'conectado',numero:'5511900000000',perfil:'Empresa Teste',foto:null,servidor:null,instancia:null,chaveFinal:null,webhook:'apontado'}
 else if(url.pathname.endsWith('/functions/v1/campanhas/modelos')) data={ok:true,modelos:[{id:'m1',nome:'promo_outubro',idioma:'pt_BR',status:'APPROVED',categoria:'MARKETING',qualidade:'GREEN',compativel:true,motivo:null,campos:[{tipo:'body',quantidade:2,texto:'Olá {{1}}, {{2}}'}]},{id:'m2',nome:'modelo_reprovado',idioma:'pt_BR',status:'REJECTED',categoria:'MARKETING',qualidade:null,compativel:false,motivo:'Modelo rejected; aguarde aprovação na Meta.',campos:[]}]}
 else if(url.pathname.endsWith('/functions/v1/campanhas/modelos/todos')) data={ok:true,modelos:[{id:'m1',nome:'promo_outubro',idioma:'pt_BR',status:'APPROVED',categoria:'MARKETING',qualidade:'GREEN',motivo:null,corpo:'Olá {{1}}, temos novidades.',rodape:null,botoes:['Quero ver']},{id:'m2',nome:'aviso_reuniao',idioma:'pt_BR',status:'REJECTED',categoria:'UTILITY',qualidade:null,motivo:'INCORRECT_CATEGORY',corpo:'Sua reunião é amanhã.',rodape:null,botoes:[]}]}
 else if(url.pathname.endsWith('/functions/v1/campanhas/conta')) data={ok:true,configurada:true,numero:'+55 11 90000-0000',nome:'Empresa Teste',qualidade:'GREEN',limite:'TIER_250'}
 else if(url.pathname.endsWith('/functions/v1/whatsapp/foto')) data={ok:true,url:null}
 else if(url.pathname.includes('/functions/v1/equipe')) data={ok:true,usuarios:[
  {...user,nome:'Equipe Teste',email:'gestor@exemplo.test',papel:'gestor',ativo:true,avatar_url:null,profissional_id:null,convidado_em:null,convite_pendente:false,ultimo_acesso_em:now,criado_em:now},
  {id:'00000000-0000-4000-8000-000000000009',nome:'Consultor Convidado',email:'consultor@exemplo.test',papel:'consultor',ativo:true,avatar_url:null,profissional_id:null,convidado_em:now,convite_pendente:true,ultimo_acesso_em:null,criado_em:now}]}
 else if(url.pathname.endsWith('/rpc/assistente_consumo_resumo'))data={gasto:0.5,reservado:0.1,chamadas:1}
 else if(tabelas[table]) data=tabelas[table]()
 if(route.request().headers().accept?.includes('vnd.pgrst.object')&&Array.isArray(data)) data=data[0]??null
 await route.fulfill({status:200,contentType:'application/json',headers:{'content-range':'0-0/1'},body:JSON.stringify(data)})
})
const proibido=/pacientes?|clínica|odontol|dentista|sorriso|consultório|ARC|Gabriela/
try {
 await page.goto(base+'/login')
 await page.getByRole('heading',{name:'Acesse sua conta'}).waitFor()
 assert(!proibido.test(await page.locator('body').innerText()),'Marca ou texto de nicho no login')
 await page.evaluate(({project,session})=>localStorage.setItem(`sb-${project}-auth-token`,JSON.stringify(session)),{project,session})
 // Núcleo apenas: sem VITE_MODULOS, módulos opcionais não aparecem no menu.
 const rotas=['/','/crm','/leads','/clientes','/servicos','/equipe','/agenda','/radar','/tarefas','/avisos',`/leads/${lead.id}`,'/configuracoes','/usuarios']
 for(const path of rotas){
  await page.goto(base+path)
  await page.waitForTimeout(600)
  const body=await page.locator('body').innerText()
  assert(!proibido.test(body),`Marca ou texto de nicho em ${path}`)
  assert(!body.includes('Não consegui carregar'),`Falha de carregamento em ${path}`)
  console.log('PASS rota',path)
 }
 // Central de avisos: contador na barra, ordem por gravidade, rota externa ignorada, dispensar chama a função do banco.
 await page.goto(base+'/avisos')
 await page.getByRole('heading',{name:'WhatsApp desconectado'}).waitFor()
 assert.equal(await page.getByLabel('2 avisos abertos').count(),1,'contador da barra não mostra 2')
 const titulos=await page.locator('main h2').allInnerTexts()
 assert.deepEqual(titulos,['WhatsApp desconectado','Uma mensagem não saiu'],'avisos fora da ordem de gravidade')
 assert.equal(await page.locator('main a[href^="http"]').count(),0,'rota externa virou link')
 assert.equal(await page.getByRole('link',{name:'Ver',exact:true}).count(),1,'só o aviso com rota interna tem "Ver"')
 let dispensado=null
 await context.route('**/rest/v1/rpc/aviso_dispensar',async r=>{dispensado=r.request().postDataJSON();avisos=avisos.map(a=>a.id===dispensado.p_id?{...a,resolvido_em:new Date().toISOString(),resolucao:'manual'}:a);await r.fulfill({status:200,contentType:'application/json',body:''})})
 await page.getByRole('button',{name:/Dispensar/}).first().click()
 await page.waitForTimeout(500)
 assert.equal(dispensado?.p_id,'av1','dispensar não chamou aviso_dispensar com o id')
 assert.equal(await page.getByRole('heading',{name:'WhatsApp desconectado'}).count(),0,'aviso dispensado continuou na lista')
 console.log('PASS avisos: contador, ordem, rota segura e dispensar')
 // Linha do tempo do contato: junta etapa, reunião e aviso do contato; nunca mostra o evento de outra pessoa.
 await page.goto(base+`/leads/${lead.id}`)
 await page.getByRole('list',{name:'Linha do tempo do contato'}).waitFor()
 const tempo=await page.getByRole('list',{name:'Linha do tempo do contato'}).innerText()
 assert(tempo.includes('Contato criado'),'linha do tempo sem a criação do contato')
 assert(/Venda inicial: .+ → .+/.test(tempo)&&tempo.includes('Pediu orçamento'),'linha do tempo sem a mudança de etapa e o motivo')
 assert(tempo.includes('Reunião marcada: Reunião inicial'),'linha do tempo sem a reunião')
 assert(tempo.includes('Aviso: Uma mensagem não saiu'),'linha do tempo sem o aviso do contato')
 assert(!tempo.includes('OUTRA pessoa'),'a linha do tempo mostrou evento de outro contato')
 if(modulosLigados.includes('conversas')) assert(tempo.includes('Nota interna de Equipe Teste')&&tempo.includes('Cliente prefere falar às terças.')&&tempo.includes('Equipe Teste passou a conversa para Colega'),'a linha do tempo sem a nota interna e a passagem da conversa')
 else assert(!tempo.includes('Nota interna'),'nota interna apareceu sem o módulo conversas')
 console.log('PASS linha do tempo do contato')
 // Etiquetas: marcar na ficha (criando se for nova), filtrar a lista e a gestão (renomear, juntar) só do gestor.
 let criada=null, marcada=null, renomeada=null, juntou=null
 await context.route('**/rest/v1/etiquetas*',async r=>{const m=r.request().method()
  if(m==='POST'){criada=r.request().postDataJSON();return r.fulfill({status:201,contentType:'application/json',body:JSON.stringify({id:'e3',nome:criada.nome,cor:criada.cor})})}
  if(m==='PATCH'){renomeada=r.request().postDataJSON();return r.fulfill({status:200,contentType:'application/json',body:'[{"id":"e1"}]'})}
  return r.fallback()})
 await context.route('**/rest/v1/contato_etiquetas*',async r=>{if(r.request().method()!=='POST')return r.fallback();marcada=r.request().postDataJSON();paresEtq=[...paresEtq,{contato_id:marcada.contato_id,etiqueta_id:marcada.etiqueta_id}];await r.fulfill({status:201,contentType:'application/json',body:'[]'})})
 await context.route('**/rest/v1/rpc/etiqueta_juntar',async r=>{juntou=r.request().postDataJSON();await r.fulfill({status:200,contentType:'application/json',body:'1'})})
 await page.goto(base+`/leads/${lead.id}`)
 await page.getByLabel('Etiquetas do contato').getByText('Quente').waitFor()
 await page.getByLabel('Nova etiqueta').fill('  Tráfego   pago '); await page.keyboard.press('Enter'); await page.waitForTimeout(500)
 assert.deepEqual(criada,{nome:'Tráfego pago',cor:'accent'},'etiqueta nova não foi criada com o nome normalizado')
 assert.deepEqual(marcada,{contato_id:lead.id,etiqueta_id:'e3'},'a etiqueta nova não foi marcada no contato')
 await page.getByLabel('Nova etiqueta').fill('indicação'); await page.keyboard.press('Enter'); await page.waitForTimeout(500)
 assert.equal(marcada.etiqueta_id,'e2','nome existente (sem caixa/acento igual) deveria marcar a existente, não criar')
 await page.goto(base+'/clientes')
 await page.getByLabel('Filtrar por etiqueta').selectOption({label:'Indicação'})
 await page.getByText('Contato de teste').first().waitFor()
 await page.getByLabel('Filtrar por etiqueta').selectOption({label:'Quente'}); await page.getByText('Contato de teste').first().waitFor()
 await page.goto(base+'/configuracoes'); await page.getByRole('button',{name:'Etiquetas'}).click()
 await page.getByLabel('Nome da etiqueta Quente').fill('Muito quente'); await page.getByRole('button',{name:'Salvar nome'}).first().click(); await page.waitForTimeout(400)
 assert.deepEqual(renomeada,{nome:'Muito quente'},'renomear não enviou o novo nome')
 await page.getByRole('button',{name:'Juntar Quente em outra'}).click()
 await page.getByLabel('Etiqueta de destino').selectOption({label:'Indicação'}); await page.getByRole('button',{name:'Juntar',exact:true}).click(); await page.waitForTimeout(400)
 assert.deepEqual(juntou,{p_origem:'e1',p_destino:'e2'},'juntar não chamou a função com origem e destino')
 console.log('PASS etiquetas: marcar, criar, filtrar, renomear e juntar')

 // Tarefas: grupos e filtro, criar com prazo rápido, concluir/reabrir, adiar, apagar, e a ficha só com as do contato.
 let tarefaCriada=null, concluidas=[], prazoNovo=null, tarefaApagada=null
 await context.route('**/rest/v1/tarefas*',async r=>{const m=r.request().method()
  if(m==='POST'){tarefaCriada=r.request().postDataJSON();return r.fulfill({status:201,contentType:'application/json',body:'[]'})}
  if(m==='PATCH'){prazoNovo={id:new URL(r.request().url()).searchParams.get('id'),...r.request().postDataJSON()};return r.fulfill({status:200,contentType:'application/json',body:'[]'})}
  if(m==='DELETE'){tarefaApagada=new URL(r.request().url()).searchParams.get('id');return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{id:'t-venc'}])})}
  return r.fallback()})
 await context.route('**/rest/v1/rpc/tarefa_concluir',async r=>{concluidas.push(r.request().postDataJSON());await r.fulfill({status:200,contentType:'application/json',body:''})})
 await page.goto(base+'/tarefas')
 await page.getByRole('heading',{name:'Tarefas',exact:true}).waitFor()
 await page.getByText('Ligar para confirmar a proposta').waitFor()
 let lista=await page.locator('.page-content').innerText()
 assert(lista.includes('Você tem 1 tarefa vencida.')&&lista.includes('venceu há 2 dias'),'tarefas: faltou o aviso de vencida e o prazo por extenso')
 assert(!lista.includes('Revisar a agenda da semana')&&!lista.includes('Cobrar o briefing'),'tarefas: "Minhas" mostrou tarefa de outra pessoa ou sem responsável')
 assert.equal(await page.getByRole('region',{name:'Vencidas'}).count(),1,'tarefas: sem o grupo Vencidas')
 await page.getByRole('tab',{name:'Todas'}).click()
 await page.getByText('Revisar a agenda da semana').waitFor()
 lista=await page.locator('.page-content').innerText()
 assert(lista.includes('Cobrar o briefing do cliente')&&lista.includes('criada pelo sistema')&&lista.includes('sem responsável'),'tarefas: "Todas" sem a tarefa do sistema e sem responsável')
 assert(await page.getByRole('region',{name:'Concluídas'}).getByText('Enviar a minuta do contrato').count()===1,'tarefas: faltou a concluída na última semana')
 await page.getByRole('tab',{name:'Sem responsável'}).click()
 assert(!(await page.locator('.page-content').innerText()).includes('Revisar a agenda da semana'),'tarefas: filtro "Sem responsável" mostrou tarefa com dono')
 await page.getByRole('tab',{name:'Todas'}).click()
 await page.getByLabel('O que precisa ser feito').fill('  Enviar contrato  ')
 await page.getByRole('button',{name:'Criar tarefa'}).click()
 await page.getByText('Escolha o prazo.').waitFor()
 assert.equal(tarefaCriada,null,'tarefas: criou sem prazo')
 await page.getByRole('button',{name:'Amanhã, 9h'}).click(); await page.getByRole('button',{name:'Criar tarefa'}).click(); await page.waitForTimeout(500)
 assert.deepEqual(tarefaCriada,{titulo:'Enviar contrato',vence_em:amanha9.toISOString(),detalhe:null,contato_id:null,oportunidade_id:null,responsavel_id:null},'tarefas: corpo da criação errado')
 await page.getByRole('button',{name:'Concluir: Ligar para confirmar a proposta'}).click(); await page.waitForTimeout(400)
 await page.getByRole('button',{name:'Reabrir: Enviar a minuta do contrato'}).click(); await page.waitForTimeout(400)
 assert.deepEqual(concluidas,[{p_id:'t-venc',p_feita:true},{p_id:'t-feita',p_feita:false}],'tarefas: concluir e reabrir devem chamar a função com p_feita certo')
 await page.getByLabel('Mudar o prazo de Ligar para confirmar a proposta').selectOption({label:'Em 3 dias, 9h'}); await page.waitForTimeout(400)
 assert.deepEqual(prazoNovo,{id:'eq.t-venc',vence_em:diasAdiante(3)},'tarefas: adiar não gravou o novo prazo')
 await page.getByRole('button',{name:'Apagar: Ligar para confirmar a proposta'}).click()
 assert.equal(tarefaApagada,null,'tarefas: apagou sem confirmar')
 await page.getByRole('button',{name:'Apagar',exact:true}).click(); await page.waitForTimeout(400)
 assert.equal(tarefaApagada,'eq.t-venc','tarefas: não apagou a tarefa confirmada')
 // Ficha do contato: só as tarefas dele, já ligadas a ele; a feita entra na linha do tempo.
 tarefaCriada=null
 await page.goto(base+`/leads/${lead.id}`)
 await page.getByRole('form',{name:'Nova tarefa'}).waitFor()
 await page.getByText('Cobrar o briefing do cliente').waitFor()
 await page.getByRole('list',{name:'Linha do tempo do contato'}).getByText('Tarefa concluída: Enviar a minuta do contrato').waitFor()
 const ficha=await page.locator('body').innerText()
 assert(ficha.includes('Cobrar o briefing do cliente')&&!ficha.includes('OUTRA pessoa')&&!ficha.includes('Revisar a agenda da semana'),'tarefas: a ficha mostrou tarefa de outro contato')
 assert((await page.getByRole('list',{name:'Linha do tempo do contato'}).innerText()).includes('Tarefa concluída: Enviar a minuta do contrato'),'tarefas: a linha do tempo sem a tarefa concluída')
 await page.getByRole('form',{name:'Nova tarefa'}).getByLabel('O que precisa ser feito').fill('Mandar o briefing')
 await page.getByRole('form',{name:'Nova tarefa'}).getByRole('button',{name:'Em 3 dias, 9h'}).click(); await page.getByRole('form',{name:'Nova tarefa'}).getByRole('button',{name:'Criar tarefa'}).click(); await page.waitForTimeout(500)
 assert.equal(tarefaCriada?.contato_id,lead.id,'tarefas: criada na ficha deveria nascer ligada ao contato')
 assert(await page.getByRole('link',{name:'Tarefas'}).count()>=1,'tarefas: item no menu do núcleo')
 console.log('PASS tarefas: grupos, filtros, criar, concluir, reabrir, adiar, apagar e ficha')

 // Radar: faixas, filtro, "combinar próximo passo" cria tarefa ligada ao negócio; janela por etapa em Configurações → Funil.
 tarefaCriada=null
 await page.goto(base+'/radar')
 await page.getByRole('heading',{name:'Radar',exact:true}).waitFor()
 await page.getByText('Site institucional').waitFor()
 let radar=await page.locator('.page-content').innerText()
 assert(radar.includes('sem atividade há 8 dias')&&/R\$\s?5\.000/.test(radar),'radar: faltou o tempo parado por extenso e o valor da proposta')
 assert.equal(await page.getByRole('region',{name:'Críticos'}).count(),1,'radar: sem o grupo Críticos')
 assert(!radar.includes('Joana Prado')&&!radar.includes('Pedro Alves'),'radar: "Meus" mostrou negócio de outra pessoa ou sem responsável')
 await page.getByRole('tab',{name:'Todos'}).click()
 await page.getByText('Joana Prado').waitFor()
 radar=await page.locator('.page-content').innerText()
 assert(radar.includes('Em risco')&&radar.includes('Em voo')&&radar.includes('tem tarefa agendada')&&radar.includes('sem responsável'),'radar: "Todos" sem as faixas Em risco e Em voo')
 assert.equal(await page.getByRole('region',{name:'Em voo'}).getByRole('button',{name:'Combinar próximo passo'}).count(),0,'radar: negócio em voo já tem próximo passo, não precisa do botão')
 await page.getByRole('tab',{name:'Sem responsável'}).click()
 assert(!(await page.locator('.page-content').innerText()).includes('Pedro Alves'),'radar: "Sem responsável" mostrou negócio com dono')
 await page.getByRole('tab',{name:'Meus'}).click()
 await page.getByRole('button',{name:'Combinar próximo passo'}).click()
 await page.getByLabel('O que precisa ser feito').fill('Ligar para retomar a proposta')
 await page.getByRole('button',{name:'Amanhã, 9h'}).click(); await page.getByRole('button',{name:'Criar tarefa'}).click(); await page.waitForTimeout(500)
 assert.deepEqual(tarefaCriada,{titulo:'Ligar para retomar a proposta',vence_em:amanha9.toISOString(),detalhe:null,contato_id:lead.id,oportunidade_id:'opp-crit',responsavel_id:null},'radar: a tarefa deveria nascer ligada ao contato e ao negócio')
 let janela=null
 await context.route('**/rest/v1/etapas_funil*',async r=>{if(r.request().method()!=='PATCH')return r.fallback();janela=r.request().postDataJSON();await r.fulfill({status:200,contentType:'application/json',body:'[]'})})
 await page.goto(base+'/configuracoes'); await page.getByRole('button',{name:'Funil'}).click()
 const campoJanela=page.getByLabel('Esfria após, em horas, na etapa Proposta')
 await campoJanela.fill('5000')
 await page.locator('.funil-linha').filter({has:campoJanela}).getByRole('button',{name:'Salvar',exact:true}).click()
 await page.getByText('O tempo para esfriar vai de 1 a 2160 horas').waitFor()
 assert.equal(janela,null,'radar: gravou uma janela fora do limite')
 await campoJanela.fill('72')
 await page.locator('.funil-linha').filter({has:campoJanela}).getByRole('button',{name:'Salvar',exact:true}).click(); await page.waitForTimeout(500)
 assert.equal(janela?.esfria_apos_horas,72,'radar: a janela da etapa não foi gravada')
 console.log('PASS radar: faixas, filtros, próximo passo e janela por etapa')
 // CRM: responsável no cartão, filtro "Minhas" e ações em lote (a função do banco é tudo-ou-nada).
 await page.goto(base+'/crm')
 await page.getByText('Responsável: Equipe Teste').waitFor(); await page.locator('.crm-deal-owner',{hasText:'Sem responsável'}).first().waitFor()
 await page.getByLabel('Filtrar por responsável').selectOption({label:'Minhas'})
 assert.equal(await page.getByText('Tráfego pago').count(),0,'filtro "Minhas" mostrou oportunidade sem dono')
 await page.getByLabel('Filtrar por responsável').selectOption({label:'Todos os responsáveis'})
 let lotes=[]
 await context.route('**/rest/v1/rpc/oportunidades_*_em_lote',async r=>{lotes.push([new URL(r.request().url()).pathname.split('/').pop(),r.request().postDataJSON()]);await r.fulfill({status:200,contentType:'application/json',body:'2'})})
 await page.getByRole('button',{name:'Selecionar várias'}).click()
 await page.getByLabel('Selecionar Site institucional').check(); await page.getByLabel('Selecionar Tráfego pago').check()
 await page.getByLabel('Mover selecionadas para').selectOption({label:'Qualificação'}); await page.getByRole('button',{name:'Mover',exact:true}).click(); await page.waitForTimeout(500)
 assert.deepEqual(lotes[0],['oportunidades_mover_em_lote',{p_ids:['opp-a','opp-b'],p_status:'qualificacao'}],'mover em lote não chamou a função com os ids e a etapa')
 await page.getByRole('button',{name:'Selecionar várias'}).click()
 await page.getByLabel('Selecionar Site institucional').check()
 await page.getByLabel('Responsável das selecionadas').selectOption({label:'Sem responsável'}); await page.getByRole('button',{name:'Aplicar'}).click(); await page.waitForTimeout(500)
 assert.deepEqual(lotes[1],['oportunidades_definir_responsavel_em_lote',{p_ids:['opp-a'],p_responsavel:null}],'limpar responsável em lote')
 console.log('PASS crm: responsável, filtro e ações em lote')
 // Importar planilha: lê o CSV (; e acentos), mostra o que fica de fora e manda só as linhas prontas ao banco.
 let importado=null
 await context.route('**/rest/v1/rpc/contatos_importar',async r=>{importado=r.request().postDataJSON();await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({criados:2,ja_existiam:0,ignoradas:0})})})
 await page.goto(base+'/leads')
 await page.getByRole('button',{name:'Importar planilha'}).click()
 await page.getByLabel('Arquivo CSV').setInputFiles({name:'lista.csv',mimeType:'text/csv',buffer:Buffer.from('Nome;Telefone;E-mail\r\nAna Souza;(11) 98765-4321;ANA@EXEMPLO.COM\r\nBia;98765;\r\nCaio;21 99999-0000;\r\nAna de novo;11987654321;\r\n','utf8')})
 await page.getByText('2 contatos prontos para importar.').waitFor()
 await page.getByText('Ver o que ficou de fora').click(); await page.getByText('Linha 3: telefone sem DDD').waitFor()
 await page.getByLabel('Etiqueta do lote').fill('Lista outubro'); await page.keyboard.press('Tab')
 await page.getByRole('button',{name:'Importar 2'}).click(); await page.getByText('2 contatos importados.').waitFor()
 assert.deepEqual(importado.p_linhas,[{nome:'Ana Souza',whatsapp:'5511987654321',empresa:null,email:'ana@exemplo.com'},{nome:'Caio',whatsapp:'5521999990000',empresa:null,email:null}],'linhas enviadas ao banco')
 console.log('PASS importar planilha')
 await page.goto(base+'/')
 const desligados=[...(comCaptacao?[]:['Leads recebidos']),...(comCampanhas?[]:['Campanhas']),...(comAssistente?[]:['Assistente comercial de IA']),...(comProjetos?[]:['Projetos']),...((comConversas||comAssistente||comCampanhas)?[]:['Conversas'])]
 for(const modulo of desligados)
  assert.equal(await page.getByRole('link',{name:modulo,exact:true}).count(),0,`Módulo ${modulo} apareceu sem estar ligado`)
 if(modulosLigados.includes('conversas')) {
  let regrasAuto=[],permissoesAuto=[],gravadasAuto=[]
  await context.route('**/rest/v1/contatos_dados*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify([lead])}))
  await context.route('**/rest/v1/etapas_funil*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{chave:'proposta',rotulo:'Proposta',tipo:'aberta',ordem:1}])}))
  await context.route('**/rest/v1/automacao_regras*',async r=>{
   const method=r.request().method()
   if(method==='POST'){const d=r.request().postDataJSON();gravadasAuto.push(d);regrasAuto.push({...d,id:'auto-1',created_at:now})}
   if(method==='PATCH'){const d=r.request().postDataJSON();regrasAuto=regrasAuto.map(x=>({...x,...d}))}
   await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(method==='GET'?regrasAuto:[])})
  })
  await context.route('**/rest/v1/automacao_permissoes*',async r=>{
   if(r.request().method()==='POST'){const d=r.request().postDataJSON();permissoesAuto=[d]}
   await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(r.request().method()==='GET'?permissoesAuto:[])})
  })
  await context.route('**/rest/v1/automacao_envios*',r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}))
  await page.goto(base+'/automacoes')
  await page.getByRole('heading',{name:'Automações',exact:true}).waitFor()
  await page.getByLabel('Nome da regra').fill('Lembrar reunião')
  await page.getByLabel('Minutos antes da reunião').fill('180')
  await page.getByRole('button',{name:'Salvar regra desligada'}).click()
  await page.getByRole('button',{name:'Ativar Lembrar reunião'}).waitFor()
  assert.equal(gravadasAuto[0].ativa,false,'regra nasceu ativa')
  assert.equal(gravadasAuto[0].minutos,180)
  await page.getByRole('button',{name:'Ativar Lembrar reunião'}).click()
  await page.getByRole('button',{name:'Desligar Lembrar reunião'}).waitFor()
  await page.getByLabel('Contato',{exact:true}).selectOption(lead.id)
  await page.getByLabel('Origem da autorização').fill('Autorizou pelo WhatsApp hoje')
  await page.getByLabel('Autoriza lembretes e follow-up').check()
  await page.getByRole('button',{name:'Registrar preferência'}).click()
  await page.getByText('1 contato(s) autorizado(s).',{exact:true}).waitFor()
  assert.equal(permissoesAuto[0].contato_id,lead.id);assert.equal(permissoesAuto[0].autorizado,true)
  await page.getByLabel('Tipo de automação').selectOption('followup')
  await page.getByLabel('Minutos após entrar na etapa').waitFor()
  assert.equal(await page.getByLabel('Etapa',{exact:true}).count(),1)
  if(comCampanhas){
   await page.getByLabel('Canal de envio').selectOption('meta')
   await page.getByLabel('Nome do modelo aprovado').waitFor()
   await page.getByLabel('Parâmetros do modelo').fill('JSON inválido')
   await page.getByLabel('Nome da regra').fill('Modelo inválido')
   await page.getByLabel('Nome do modelo aprovado').fill('aviso_reuniao')
   await page.getByRole('button',{name:'Salvar regra desligada'}).click()
   await page.getByRole('alert').getByText(/Parâmetros: use um objeto/).waitFor()
   assert.equal(gravadasAuto.length,1,'JSON inválido foi salvo')
  }
  await context.unroute('**/rest/v1/contatos_dados*')
  await context.unroute('**/rest/v1/etapas_funil*')
  console.log('PASS automações: regra desligada, ativação explícita, autorização e campos de follow-up')
 }
 if(comConversas){
  // Módulo conversas: lista, abrir a conversa, mensagens do cliente e da equipe, envio.
  await page.goto(base+'/conversas')
  await page.getByText('Contato de teste').first().waitFor()
  await page.getByText('Contato de teste').first().click()
  await page.getByText('Claro, como posso ajudar?').waitFor()
  const corpo=await page.locator('body').innerText()
  assert(!proibido.test(corpo),'Marca ou texto de nicho em /conversas')
  assert(corpo.includes('Quero saber mais'))
  let enviado=null
  await context.route('**/functions/v1/whatsapp/enviar',async r=>{enviado=r.request().postDataJSON();await r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'})})
  await page.getByRole('textbox').last().fill('Mensagem de teste')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  assert(enviado?.contato_id===lead.id&&enviado?.texto==='Mensagem de teste'&&enviado?.pedido_id,'envio não chegou à função com contato_id, texto e pedido_id')
  console.log('PASS conversas: lista, mensagens e envio')
  // Respostas rápidas: inserir não envia; /atalho + Enter expande; variável sem valor bloqueia o envio.
  const caixa=page.getByRole('textbox',{name:'Resposta ao contato'})
  enviado=null
  await page.getByRole('button',{name:'Respostas rápidas'}).click()
  await page.getByRole('button',{name:/Saudação/}).click()
  assert.equal(await caixa.inputValue(),'Oi, Contato! Como posso ajudar?','a resposta não entrou preenchida com o nome do contato')
  assert.equal(enviado,null,'inserir a resposta enviou a mensagem')
  await caixa.fill('/oi'); await page.keyboard.press('Enter'); await page.waitForTimeout(300)
  assert.equal(await caixa.inputValue(),'Oi, Contato! Como posso ajudar?','/oi + Enter não expandiu')
  assert.equal(enviado,null,'/oi + Enter enviou em vez de expandir')
  await caixa.fill('/solto'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.waitForTimeout(300)
  assert.equal(enviado,null,'enviou com {{empresa}} sem preencher')
  assert(await page.getByRole('alert').filter({hasText:'{{empresa}}'}).count()>=1,'sem o aviso da variável pendente')
  await caixa.fill('')
  console.log('PASS conversas: respostas rápidas')
  // Notas internas: aparecem no histórico, são salvas na tabela própria e NUNCA passam pela rota de envio.
  assert((await page.getByRole('note',{name:'Nota interna'}).innerText()).includes('Cliente prefere falar às terças.'),'a nota existente não apareceu na conversa')
  let notaSalva=null, enviouAoCliente=false
  await context.route('**/rest/v1/notas_conversa*',async r=>{if(r.request().method()!=='POST')return r.fallback();notaSalva=r.request().postDataJSON();await r.fulfill({status:201,contentType:'application/json',body:'[]'})})
  await context.route('**/functions/v1/whatsapp/enviar',async r=>{enviouAoCliente=true;await r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'})})
  await page.getByRole('tab',{name:'Nota interna'}).click()
  await page.getByRole('textbox',{name:'Nota interna'}).fill('Combinar desconto na sexta.')
  await page.keyboard.press('Enter'); await page.waitForTimeout(400)
  assert(notaSalva?.contato_id===lead.id&&notaSalva?.texto==='Combinar desconto na sexta.'&&notaSalva?.autor_id===user.id,'a nota não foi gravada com contato, texto e autor')
  assert.equal(enviouAoCliente,false,'a nota foi enviada ao cliente')
  console.log('PASS conversas: notas internas')
  // Assumir é atômico no banco; transferir passa para outra pessoa; conversa de outro só o gestor toma.
  const COLEGA={id:'00000000-0000-4000-8000-0000000000aa',nome:'Colega'}
  let chamadasDono=[]
  await context.route('**/rest/v1/rpc/conversa_*',async r=>{
    const nome=new URL(r.request().url()).pathname.split('/').pop(), corpo=r.request().postDataJSON(); chamadasDono.push([nome,corpo])
    if(nome==='conversa_assumir'){ if(corpo.p_forcar||!dono){dono={id:user.id,nome:'Equipe Teste'};return r.fulfill({status:200,contentType:'application/json',body:'true'})} return r.fulfill({status:200,contentType:'application/json',body:'false'}) }
    if(nome==='conversa_transferir') dono=COLEGA
    if(nome==='conversa_devolver') dono=null
    await r.fulfill({status:200,contentType:'application/json',body:''})
  })
  await page.reload(); await page.getByText('Contato de teste').first().click()
  await page.getByRole('button',{name:'Assumir conversa'}).first().click(); await page.waitForTimeout(500)
  assert.equal(chamadasDono[0][0],'conversa_assumir'); assert.equal(chamadasDono[0][1].p_forcar,false)
  await page.getByRole('button',{name:'Liberar conversa'}).waitFor()
  await page.getByLabel('Transferir conversa para').selectOption({label:'Colega'})
  await page.getByRole('button',{name:'Transferir',exact:true}).click(); await page.waitForTimeout(500)
  assert.deepEqual(chamadasDono.at(-1),['conversa_transferir',{p_contato:lead.id,p_para:COLEGA.id}])
  // Agora a conversa é do Colega: o campo de resposta some, a nota interna continua, e o gestor pode tomá-la.
  await page.reload(); await page.getByText('Contato de teste').first().click()
  await page.getByText(/Colega.*está cuidando desta conversa/).waitFor()
  assert.equal(await page.getByRole('textbox',{name:'Resposta ao contato'}).count(),0,'escreveu em conversa de outra pessoa')
  await page.getByRole('button',{name:'Assumir de Colega'}).first().click(); await page.waitForTimeout(500)
  assert.equal(chamadasDono.at(-1)[0],'conversa_assumir'); assert.equal(chamadasDono.at(-1)[1].p_forcar,true,'gestor deveria forçar')
  dono=null
  console.log('PASS conversas: assumir, transferir e conversa de outra pessoa')
  // Adiar: sai da fila (e dos contadores), vai para "Adiadas" com a hora de volta, e "voltar agora" devolve.
  let adiou=[]
  await context.route('**/rest/v1/rpc/conversa_adiar',async r=>{const c=r.request().postDataJSON();adiou.push(c);adiada=c.p_ate;await r.fulfill({status:200,contentType:'application/json',body:''})})
  await page.goto(base+'/conversas'); await page.getByText('Contato de teste').first().click()
  await page.getByLabel('Adiar conversa').selectOption({label:'Daqui a 3 horas'}); await page.waitForTimeout(500)
  assert.equal(adiou.length,1); const horas=(Date.parse(adiou[0].p_ate)-Date.now())/3_600_000
  assert(horas>2.9&&horas<3.1,`adiou para ${horas} h em vez de 3`)
  await page.goto(base+'/conversas')
  await page.getByRole('button',{name:/^Adiadas/}).waitFor()
  assert.equal(await page.getByText('Contato de teste').count(),0,'conversa adiada continuou na fila')
  await page.getByRole('button',{name:/^Adiadas/}).click()
  await page.getByText(/Volta (hoje|amanhã)/).first().waitFor()
  await page.getByText('Contato de teste').first().click()
  await page.getByLabel('Adiar conversa').selectOption({label:'Voltar para a fila agora'}); await page.waitForTimeout(500)
  assert.equal(adiou.at(-1).p_ate,null,'voltar agora deveria mandar data nula')
  adiada=null
  console.log('PASS conversas: adiar e voltar para a fila')
  // Anexos: recusa cedo o que não serve; envia o escolhido com a legenda; sem texto também pode.
  const caixaAnexo=page.getByRole('textbox',{name:'Resposta ao contato'})
  await page.goto(base+'/conversas'); await page.getByText('Contato de teste').first().click(); await caixaAnexo.waitFor()
  await page.locator('input[type=file][aria-label="Anexar arquivo"]').setInputFiles({name:'virus.exe',mimeType:'application/octet-stream',buffer:Buffer.from('MZ')})
  await page.getByText(/não é aceito/).waitFor()
  let anexoEnviado=null
  await context.route('**/functions/v1/whatsapp/enviar-midia',async r=>{const b=r.request().postDataBuffer().toString('latin1');anexoEnviado={temArquivo:b.includes('filename="proposta.pdf"'),legenda:/name="legenda"\r\n\r\nSegue a proposta\r\n/.test(b),contato:b.includes(lead.id)};await r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'})})
  await page.locator('input[type=file][aria-label="Anexar arquivo"]').setInputFiles({name:'proposta.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 teste')})
  await page.getByRole('status').filter({hasText:'proposta.pdf'}).waitFor()
  await caixaAnexo.fill('Segue a proposta'); await page.keyboard.press('Enter'); await page.waitForTimeout(500)
  assert.deepEqual(anexoEnviado,{temArquivo:true,legenda:true,contato:true},'o anexo não chegou à função com arquivo, legenda e contato')
  assert.equal(await page.getByRole('status').filter({hasText:'proposta.pdf'}).count(),0,'o anexo continuou escolhido depois de enviar')
  console.log('PASS conversas: anexos')
  // Arquivo apagado pela retenção: a conversa explica em vez de ficar em branco.
  assert(corpo.includes('Arquivo removido pela retenção de dados.'),'conversa sem o aviso de arquivo removido')
  // Retenção de mídia: ligar um prazo exige confirmar que apagar não tem volta; o prazo vai ao banco como número.
  let prazo=null
  await context.route('**/rest/v1/conversas_config?*',async r=>{if(r.request().method()!=='PATCH')return r.fallback();prazo=r.request().postDataJSON();retencao=prazo.retencao_midia_dias;await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{retencao_midia_dias:retencao}])})})
  await page.goto(base+'/configuracoes')
  await page.getByRole('button',{name:'Empresa'}).click()
  await page.getByLabel('Guardar por').selectOption('180')
  const salvarPrazo=page.getByRole('button',{name:'Salvar prazo'})
  assert(await salvarPrazo.isDisabled(),'salvar deveria esperar a confirmação')
  await page.getByRole('checkbox',{name:/não podem ser recuperados/}).check()
  await salvarPrazo.click()
  await page.getByText('Prazo salvo.').waitFor()
  assert(prazo?.retencao_midia_dias===180,'o prazo não chegou ao banco como 180')
  console.log('PASS conversas: retenção de mídia')
 }
 if(comAssistente){
  // Módulo assistente: conversa encaminhada à equipe, botão de ligar/desligar e tela de configuração.
  await page.goto(base+'/conversas')
  await page.getByText('Pediu a equipe').first().waitFor()
  await page.getByText('Contato de teste').first().click()
  await page.getByText('Quer fechar a proposta hoje').waitFor()
  await page.getByText('O assistente está desligado nesta conversa.').waitFor()
  let ligou=null
  await context.route('**/rest/v1/contatos_dados?*',async r=>{if(r.request().method()!=='PATCH')return r.fallback();ligou=r.request().postDataJSON();await r.fulfill({status:200,contentType:'application/json',headers:{'content-range':'0-0/1'},body:'[]'})})
  await page.getByRole('button',{name:/Ligar nesta conversa/}).click()
  await page.waitForTimeout(400)
  assert(ligou?.ia_ligada===true&&ligou?.ia_encaminhada_em===null,'ligar não limpou o encaminhamento')
  // Rascunho da IA: a equipe assume, pede, a IA só preenche a caixa; nada é enviado.
  await context.route('**/rest/v1/rpc/conversa_assumir',async r=>{dono={id:user.id,nome:'Equipe Teste'};await r.fulfill({status:200,contentType:'application/json',body:'true'})})
  let enviouRascunho=false
  await context.route('**/functions/v1/whatsapp/enviar',async r=>{enviouRascunho=true;await r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'})})
  await context.route('**/functions/v1/whatsapp/rascunho',async r=>{await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,texto:'Posso sim ajudar com a proposta. Qual o prazo que você tem em mente?'})})})
  await page.getByRole('button',{name:'Assumir conversa'}).first().click()
  const caixaRascunho=page.getByRole('textbox',{name:'Resposta ao contato'})
  await caixaRascunho.waitFor()
  await page.getByRole('button',{name:'Sugerir resposta com IA'}).click()
  await page.getByText('Rascunho da IA. Leia e ajuste antes de enviar.').waitFor()
  assert.equal(await caixaRascunho.inputValue(),'Posso sim ajudar com a proposta. Qual o prazo que você tem em mente?','o rascunho não entrou na caixa')
  assert.equal(enviouRascunho,false,'o rascunho foi enviado ao cliente sozinho')
  await page.getByRole('button',{name:'Sugerir resposta com IA'}).click()
  await page.getByText(/Limpe a caixa de texto antes/).waitFor()
  dono=null
  console.log('PASS assistente: rascunho da IA')
  let salvoCfg=null
  await context.route('**/rest/v1/rpc/assistente_salvar_config',async r=>{salvoCfg=r.request().postDataJSON();await r.fulfill({status:200,contentType:'application/json',body:''})})
  await page.goto(base+'/assistente-ia')
  await page.getByRole('heading',{name:'Assistente',exact:true}).first().waitFor()
  const tela=await page.locator('body').innerText()
  assert(!proibido.test(tela),'Marca ou texto de nicho em /assistente-ia')
  assert(tela.includes('Desligado')&&tela.includes('Ao vivo')&&tela.includes('confira a chave do modelo'),'tela do assistente incompleta')
  await page.getByRole('radio',{name:/Teste/}).check()
  await page.getByLabel(/Números de teste/).fill('(11) 98765-4321')
  assert(tela.includes('Se a equipe não responder, o assistente volta a atender'),'falta o campo da volta automática')
  const prazo=page.getByLabel(/o assistente volta a atender depois de/)
  assert(await prazo.inputValue()==='','o prazo da volta automática deveria nascer vazio (nunca)')
  await prazo.fill('45')
  await page.getByRole('button',{name:'Salvar',exact:true}).click()
  await page.waitForTimeout(400)
  assert(salvoCfg?.p_devolver_apos===45,'salvar não enviou o prazo da volta automática')
  await prazo.fill('')
  await page.getByRole('button',{name:'Salvar',exact:true}).click()
  await page.waitForTimeout(400)
  assert(salvoCfg?.p_devolver_apos===null,'prazo em branco deveria ir como nulo (nunca volta sozinho)')
  assert(salvoCfg?.p_modo==='teste'&&salvoCfg.p_numeros?.[0]==='(11) 98765-4321'&&salvoCfg.p_modelo==='claude-sonnet-5-5','salvar não chamou a função com modo e números')
  let financeiro=null,recarga=null
  await context.route('**/rest/v1/rpc/assistente_financeiro_salvar',async r=>{financeiro=r.request().postDataJSON();await r.fulfill({status:200,contentType:'application/json',body:''})})
  await context.route('**/rest/v1/rpc/assistente_recarga_confirmar',async r=>{recarga=r.request().postDataJSON();await r.fulfill({status:200,contentType:'application/json',body:''})})
  await page.getByLabel('Teto mensal (US$)',{exact:true}).fill('25')
  await page.getByLabel('Entrada por milhão de tokens (US$)',{exact:true}).fill('3')
  await page.getByLabel('Saída por milhão de tokens (US$)',{exact:true}).fill('15')
  await page.getByRole('button',{name:'Salvar orçamento',exact:true}).click()
  await page.getByText('Custos salvos.',{exact:true}).waitFor()
  assert(financeiro.p_teto===25&&financeiro.p_modelo==='claude-sonnet-5-5')
  await page.getByRole('button',{name:'Confirmar recarga de openai',exact:true}).click()
  await page.getByText(/Recarga confirmada/).waitFor()
  assert.equal(recarga.p_provedor,'openai')
  console.log('PASS assistente: encaminhamento, configuração, orçamento e recarga')
 }
 if(comCasos){
  let assumiuCaso=null,finalizouCaso=null
  await context.route('**/rest/v1/rpc/assistente_caso_assumir',async r=>{assumiuCaso=r.request().postDataJSON();casosMock=casosMock.map(c=>({...c,estado:'em_atendimento'}));await r.fulfill({status:200,contentType:'application/json',body:''})})
  await context.route('**/rest/v1/rpc/assistente_caso_finalizar',async r=>{finalizouCaso=r.request().postDataJSON();casosMock=casosMock.map(c=>({...c,estado:'resolvido',solucao:finalizouCaso.p_solucao}));await r.fulfill({status:200,contentType:'application/json',body:''})})
  await page.goto(base+'/casos')
  await page.getByRole('button',{name:'Assumir caso',exact:true}).click()
  await page.getByLabel('Solução do caso',{exact:true}).fill('A equipe esclareceu a proposta.')
  await page.getByLabel('Avaliação do encaminhamento',{exact:true}).selectOption('desnecessario')
  await page.getByRole('button',{name:'Finalizar caso',exact:true}).click()
  await page.getByText('Solução: A equipe esclareceu a proposta.',{exact:true}).waitFor()
  assert(assumiuCaso.p_id===casosMock[0].id&&finalizouCaso.p_avaliacao==='desnecessario')
  console.log('PASS casos: contexto, assumir, solução e avaliação')
 }
 if(comMelhorias){
  let propostaCriada=null,comparacao=null,aprovou=null,restaurou=null
  await context.route('**/rest/v1/contatos_dados?*',async r=>{
   const url=new URL(r.request().url())
   if(r.request().method()!=='GET'||url.searchParams.get('select')!=='id,nome')return r.fallback()
   await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify([lead])})
  })
  const propostaId='00000000-0000-4000-8000-000000000030'
  await context.route('**/rest/v1/rpc/assistente_melhoria_criar',async r=>{propostaCriada=r.request().postDataJSON();propostasMock=[{id:propostaId,titulo:propostaCriada.p_titulo,evidencia:propostaCriada.p_evidencia,conteudo:propostaCriada.p_conteudo,contato_id:lead.id,estado:'rascunho'}];await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(propostaId)})})
  await context.route('**/functions/v1/melhorias',async r=>{comparacao=r.request().postDataJSON();testesMelhoria=[{id:'teste-29',proposta_id:propostaId,apto:true,resultado:{base:{ok:true,texto:'Resposta atual de teste.'},candidato:{ok:true,texto:'Resposta proposta de teste.'}}}];propostasMock[0].estado='testada';await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})})})
  await context.route('**/rest/v1/rpc/assistente_melhoria_aprovar',async r=>{aprovou=r.request().postDataJSON();ativaMock='versao-nova';versoesMock=[{id:ativaMock,conteudo:propostasMock[0].conteudo,criada_em:now},...versoesMock];propostasMock[0].estado='aprovada';await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(ativaMock)})})
  await context.route('**/rest/v1/rpc/assistente_melhoria_reverter',async r=>{restaurou=r.request().postDataJSON();ativaMock=restaurou.p_versao;await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(ativaMock)})})
  await page.goto(base+'/melhorias-assistente')
  await page.getByLabel('Título da melhoria',{exact:true}).fill('Explicar a proposta')
  await page.getByLabel('Contato da evidência',{exact:true}).selectOption(lead.id)
  await page.getByLabel('O que precisa melhorar',{exact:true}).fill('Cliente recebeu orientação incompleta.')
  await page.getByLabel('Instrução proposta',{exact:true}).fill('Explique o próximo passo da proposta.')
  await page.getByRole('button',{name:'Criar proposta',exact:true}).click()
  await page.getByRole('button',{name:'Comparar Explicar a proposta',exact:true}).click()
  await page.getByText('Resposta atual de teste.',{exact:true}).waitFor()
  await page.getByText('Resposta proposta de teste.',{exact:true}).waitFor()
  assert.equal(aprovou,null,'aprovação automática após comparar')
  await page.getByRole('button',{name:'Aprovar Explicar a proposta',exact:true}).click()
  await page.getByText(/Melhoria aprovada/).waitFor()
  assert(aprovou.p_proposta===comparacao.proposta_id&&aprovou.p_teste==='teste-29')
  await page.getByRole('button',{name:'Restaurar versão 00000000',exact:true}).click()
  await page.getByText('Versão restaurada.',{exact:true}).waitFor()
  assert.equal(restaurou.p_atual,'versao-nova')
  console.log('PASS melhorias: evidência, comparação, aprovação explícita e restauração')
 }
 if(comCampanhas){
  // Módulo campanhas: lista com o controle global, criação, revisão do público, início e consentimento na ficha.
  await page.goto(base+'/campanhas')
  await page.getByText('Promo de outubro').waitFor()
  await page.getByText('+55 11 90000-0000').waitFor()
  const lista=await page.locator('body').innerText()
  assert(!proibido.test(lista),'Marca ou texto de nicho em /campanhas')
  assert(lista.includes('Envios liberados')&&lista.includes('hoje 12 de 250')&&lista.includes('+55 11 90000-0000'),'controle ou conta da Meta ausentes')
  assert(await page.getByRole('link',{name:/Nova campanha/}).count()===1,'gestor sem o botão de nova campanha')

  let criada=null
  await context.route('**/rest/v1/campanhas?*',async r=>{if(r.request().method()!=='POST')return r.fallback();criada=r.request().postDataJSON();await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:'camp-1'})})})
  await page.goto(base+'/campanhas/nova')
  await page.getByLabel('Nome da campanha').fill('Promo de outubro')
  const opcoes=await page.getByLabel('Modelo aprovado').locator('option').allInnerTexts()
  assert(opcoes.some(o=>o.includes('promo_outubro'))&&opcoes.some(o=>o.includes('indisponível')),'lista de modelos sem o aprovado ou sem o motivo do reprovado')
  assert(await page.getByRole('option',{name:/modelo_reprovado/}).evaluate(o=>o.disabled),'modelo reprovado deveria estar desabilitado')
  await page.getByLabel('Modelo aprovado').selectOption('m1')
  await page.getByText('Olá Maria, {{2}}').first().waitFor().catch(()=>{})
  await page.getByLabel(/Valor de \{\{2\}\}/).selectOption('fixo')
  await page.getByLabel('Texto fixo').fill('temos novidades')
  await page.getByRole('button',{name:/Salvar e revisar/}).click()
  await page.waitForURL('**/campanhas/camp-1')
  assert(criada?.modelo_id==='m1'&&criada.nome==='Promo de outubro'&&criada.mapeamento_parametros?.length===2&&criada.mapeamento_parametros[1].valor==='temos novidades','a campanha salva não leva modelo e mapeamento')
  assert(!('criada_por' in criada)&&!('estado' in criada),'o navegador não deve mandar estado nem autoria')

  // Revisão: quantos entram, quantos ficam de fora e por quê; início só depois de confirmar.
  await page.getByText('Revise antes de enviar').waitFor()
  const rev=await page.locator('body').innerText()
  assert(rev.includes('1 contato(s) vão receber')&&rev.includes('Sem autorização registrada')&&rev.includes('Pediu para parar de receber'),'revisão sem a contagem ou sem os motivos')
  assert(rev.includes('Olá Maria, temos novidades'),'revisão sem o exemplo do texto')
  assert(await page.getByRole('button',{name:'Iniciar envio'}).isDisabled(),'iniciar deveria exigir a confirmação')
  let iniciou=null
  await context.route('**/rest/v1/rpc/campanha_iniciar',async r=>{iniciou=r.request().postDataJSON();await r.fulfill({status:200,contentType:'application/json',body:''})})
  await page.getByLabel(/Revisei a lista/).check()
  await page.getByRole('button',{name:'Iniciar envio'}).click()
  await page.waitForTimeout(400)
  assert(iniciou?.p_campanha==='camp-1'&&iniciou?.p_revisao_hash==='hash1','iniciar não mandou o hash revisado')

  // Consentimento na ficha do contato.
  let consentiu=null
  await context.route('**/rest/v1/rpc/marketing_registrar_preferencia',async r=>{consentiu=r.request().postDataJSON();consentimentoRegistrado=true;await r.fulfill({status:200,contentType:'application/json',body:''})})
  await page.goto(base+`/leads/${lead.id}`)
  await page.getByText('Nenhuma autorização registrada').waitFor()
  assert(await page.getByRole('button',{name:'Registrar autorização'}).isDisabled(),'registrar sem origem deveria estar bloqueado')
  await page.getByLabel('De onde veio a autorização').fill('pediu pelo WhatsApp')
  await page.getByRole('button',{name:'Registrar autorização'}).click()
  await page.getByText(/Autorizada em/).waitFor()
  assert(consentiu?.p_contato===lead.id&&consentiu?.p_ativo===true&&consentiu?.p_fonte==='pediu pelo WhatsApp','consentimento não chegou ao banco')
  console.log('PASS campanhas: lista, criação, revisão, início e consentimento')
  // Modelos da Meta: lista com status e motivo, cria com exemplo por variável, apaga com confirmação.
  let criado=null, apagado=null
  await context.route('**/functions/v1/campanhas/modelos',async r=>{if(r.request().method()!=='POST')return r.fallback();criado=r.request().postDataJSON();await r.fulfill({status:200,contentType:'application/json',body:'{"ok":true,"id":"mt9","status":"PENDING"}'})})
  await context.route('**/functions/v1/campanhas/modelos/apagar',async r=>{apagado=r.request().postDataJSON();await r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'})})
  await page.goto(base+'/campanhas/modelos')
  await page.getByRole('heading',{name:'promo_outubro'}).waitFor()
  assert((await page.getByRole('region',{name:'aviso_reuniao'}).innerText()).includes('Reprovado')&&(await page.getByRole('region',{name:'aviso_reuniao'}).innerText()).includes('INCORRECT_CATEGORY'),'a lista não mostra o status e o motivo da reprovação')
  await page.getByRole('button',{name:'Novo modelo'}).click()
  await page.getByLabel('Nome (minúsculas, números e _)').fill('oferta_semana')
  await page.getByLabel('Texto da mensagem').fill('Oi {{1}}, a oferta de {{2}} é sua.')
  assert.equal(await page.getByLabel(/Exemplo para/).count(),2,'um campo de exemplo por variável')
  await page.getByLabel('Exemplo para {{1}}').fill('Maria'); await page.getByLabel('Exemplo para {{2}}').fill('outubro')
  await page.getByLabel('Botão 1').fill('Quero ver')
  await page.getByRole('button',{name:'Enviar para a Meta'}).click(); await page.getByText(/Modelo enviado para análise/).waitFor()
  assert.deepEqual(criado,{nome:'oferta_semana',idioma:'pt_BR',categoria:'MARKETING',corpo:'Oi {{1}}, a oferta de {{2}} é sua.',exemplos:['Maria','outubro'],rodape:'',botoes:['Quero ver']},'o corpo enviado à função')
  await page.getByRole('button',{name:'Apagar promo_outubro'}).click(); await page.getByRole('button',{name:'Apagar',exact:true}).click(); await page.getByText('Modelo apagado.').waitFor()
  assert.deepEqual(apagado,{nome:'promo_outubro'})
  console.log('PASS campanhas: modelos da Meta')
 }
 if(comCaptacao){
  let criadaFonte=null,configuradaFonte=null
  await context.route('**/rest/v1/captacao_recebimentos?*',async r=>{
   const url=new URL(r.request().url());let data=recebimentosCaptacao
   if(url.searchParams.get('resultado')) data=data.filter(x=>x.resultado===url.searchParams.get('resultado').slice(3))
   await r.fulfill({status:200,contentType:'application/json',headers:{'content-range':`0-${data.length-1}/${data.length}`},body:JSON.stringify(data)})
  })
  await context.route('**/rest/v1/rpc/captacao_criar_fonte',async r=>{
   criadaFonte=r.request().postDataJSON()
   const id='00000000-0000-4000-8000-000000000026'
   fontesCaptacao.push({id,nome:criadaFonte.p_nome,ativa:false})
   await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(id)})
  })
  await context.route('**/rest/v1/rpc/captacao_configurar_fonte',async r=>{
   configuradaFonte=r.request().postDataJSON()
   fontesCaptacao=fontesCaptacao.map(f=>f.id===configuradaFonte.p_id?{...f,ativa:configuradaFonte.p_ativa}:f)
   await r.fulfill({status:200,contentType:'application/json',body:''})
  })
  let referenciaSalva=null, periodoRelatorio=null
  await context.route('**/rest/v1/rpc/captacao_configurar_referencia',async r=>{referenciaSalva=r.request().postDataJSON();await r.fulfill({status:200,contentType:'application/json',body:''})})
  await context.route('**/rest/v1/rpc/captacao_relatorio',async r=>{periodoRelatorio=r.request().postDataJSON();await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{canal:'referencia',fonte:'Landing de teste',origem:'google',campanha:'outubro',conteudo:'ad-26',leads:3,ganhos:2,valor_ganho:200}])})})
  await page.goto(base+'/captacao')
  await page.getByRole('heading',{name:'Leads recebidos'}).waitFor()
  await page.getByText('Telefone inválido ou sem DDD',{exact:false}).waitFor()
  assert((await page.locator('main').innerText()).includes('campaign: outubro'),'UTMs ausentes')
  await page.getByLabel('Resultado',{exact:true}).selectOption('recusado')
  await page.waitForTimeout(200)
  assert.equal(await page.locator('.captacao-recebimentos li').count(),1,'filtro não aplicado ao banco')
  await page.getByLabel('Nome da fonte').fill('Landing de teste')
  await page.getByRole('button',{name:'Criar fonte',exact:true}).click()
  await page.getByLabel('Segredo da fonte',{exact:true}).waitFor()
  const segredo=await page.getByLabel('Segredo da fonte',{exact:true}).inputValue()
  const {createHash}=await import('node:crypto')
  assert.equal(criadaFonte.p_hash,createHash('sha256').update(segredo).digest('hex'),'segredo não foi armazenado como hash')
  assert(!JSON.stringify(criadaFonte).includes(segredo),'segredo puro enviado ao banco')
  assert.equal(criadaFonte.p_nome,'Landing de teste')
  await page.getByRole('button',{name:'Já guardei o segredo'}).click()
  await page.getByRole('button',{name:'Ativar Landing de teste',exact:true}).click()
  await page.getByRole('button',{name:'Desligar Landing de teste',exact:true}).waitFor()
  assert(configuradaFonte.p_ativa===true&&configuradaFonte.p_hash===null,'ativação não chegou ao banco')
  await page.getByRole('button',{name:'Novo segredo de Landing de teste',exact:true}).click()
  await page.getByLabel('Segredo da fonte',{exact:true}).waitFor()
  assert.notEqual(await page.getByLabel('Segredo da fonte',{exact:true}).inputValue(),segredo,'renovação repetiu segredo')
  await page.getByRole('button',{name:'Consultar origens',exact:true}).click()
  await page.getByRole('cell',{name:'ad-26',exact:true}).waitFor()
  assert(new Date(periodoRelatorio.p_fim)>new Date(periodoRelatorio.p_inicio),'período inválido')
  await page.getByText('Origem da landing page · Landing de teste',{exact:true}).click()
  await page.getByLabel('Código de Landing de teste',{exact:true}).fill('landing-outubro')
  await page.getByLabel('source de Landing de teste',{exact:true}).fill('google')
  await page.getByRole('button',{name:'Salvar referência de Landing de teste',exact:true}).click()
  await page.getByText('Referência salva.',{exact:true}).waitFor()
  assert.equal(referenciaSalva.p_codigo,'landing-outubro')
  assert.equal(referenciaSalva.p_utm.utm_source,'google')
  await page.getByText('Olá! Quero saber mais. [ref:landing-outubro]',{exact:true}).waitFor()
  await page.goto(base+`/leads/${lead.id}`)
  await page.getByRole('region',{name:'Primeira origem do contato'}).waitFor()
  assert((await page.getByRole('region',{name:'Primeira origem do contato'}).innerText()).includes('outubro'),'ficha sem origem')
  papel='consultor'
  await page.goto(base+'/captacao')
  await page.getByRole('heading',{name:'Leads recebidos'}).waitFor()
  await page.waitForTimeout(300)
  assert.equal(await page.getByRole('button',{name:'Criar fonte',exact:true}).count(),0,'consultor configura fonte')
  assert.equal(await page.locator('.captacao-recebimentos li').count(),2,'consultor não vê recebimentos')
  papel='gestor'
  console.log('PASS captação: recebimentos, filtro, criação, hash, ativação, renovação, referência, relatório, primeira origem e consultor')
 }
 if(comProjetos){
  // Módulo projetos: quadro por etapa, cartão da venda ganha e edição com trava otimista.
  await page.goto(base+'/projetos')
  await page.getByText('Projeto da venda inicial').waitFor()
  const quadro=await page.locator('body').innerText()
  assert(!proibido.test(quadro),'Marca ou texto de nicho em /projetos')
  for(const etapa of ['Planejamento','Em andamento','Revisão','Entregue']) assert(quadro.includes(etapa),`Etapa ${etapa} ausente do quadro`)
  let salvo=null
  await context.route('**/rest/v1/projetos?*',async r=>{
   if(r.request().method()!=='PATCH') return r.fallback()
   salvo={corpo:r.request().postDataJSON(),url:r.request().url()}
   await r.fulfill({status:200,contentType:'application/json',headers:{'content-range':'0-0/1'},body:JSON.stringify({...tabelas.projetos()[0],etapa:'andamento'})})
  })
  await page.getByRole('button',{name:'Editar projeto'}).click()
  await page.getByRole('combobox',{name:'Etapa'}).selectOption('andamento')
  await page.getByRole('button',{name:'Salvar projeto'}).click()
  await page.waitForTimeout(500)
  assert(salvo?.corpo?.etapa==='andamento'&&salvo.url.includes('updated_at=eq.'),'salvar não enviou etapa nova com a trava updated_at')
  console.log('PASS projetos: quadro e edição')
 }
 assert.deepEqual(errors,[])
 console.log(`PASS login e ${rotas.length} rotas do núcleo; módulos ocultos; sem exceções no navegador`)
} finally { await browser.close(); server.kill() }
