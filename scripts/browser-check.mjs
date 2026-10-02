// UI smoke tests use isolated mocked API responses. Database invariants are
// tested separately by agency-check.sql inside a rollback transaction.
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
const base = 'http://127.0.0.1:5187'
const comConversas = process.argv.includes('--conversas')
const comProjetos = process.argv.includes('--projetos')
const comAssistente = process.argv.includes('--assistente')
const comCampanhas = process.argv.includes('--campanhas')
const modulosLigados = [(comConversas || comAssistente || comCampanhas) && 'conversas', comProjetos && 'projetos', comAssistente && 'assistente', comCampanhas && 'campanhas'].filter(Boolean).join(',')
// Um servidor sobrando de um teste anterior responderia no lugar do nosso, com outros módulos ligados.
if (await fetch(base).then(() => true, () => false)) throw Error('A porta 5187 já está em uso (servidor de um teste anterior?). Encerre-o antes de rodar.')
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5187', '--strictPort'], { stdio: 'ignore', env: { ...process.env, VITE_MODULOS: modulosLigados } })
await Promise.race([
 (async () => { for (let i=0;i<80;i++) { try { if ((await fetch(base)).ok) return } catch {} await delay(100) } throw Error('Servidor de teste não iniciou') })(),
 new Promise((_,reject) => server.once('exit',code => reject(Error('Servidor encerrou: '+code))))
]).catch(e => { server.kill(); throw e })
const env = readFileSync('.env','utf8')
const supabaseUrl = env.match(/^VITE_SUPABASE_URL=(.+)$/m)[1].trim().replace(/^['"]|['"]$/g,'')
const project = new URL(supabaseUrl).hostname.split('.')[0]
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'test@example.invalid', role: 'authenticated', app_metadata: {}, user_metadata: {} }
const session = { access_token: 'test.token.signature', refresh_token: 'test-refresh', expires_at: Math.floor(Date.now()/1000)+3600, expires_in:3600, token_type:'bearer', user }
let opportunities = []
let provider='uazapi', metaConsent=false, metaSent=null, papel='gestor'
let connectionState='conectado'
const now = new Date().toISOString()
const lead = { id:'00000000-0000-4000-8000-000000000002', nome:'Contato de teste', whatsapp:'5511999999999', empresa:'Empresa Teste', email:'teste@example.invalid', status:'ganho', interesses:['Serviço A'], interesses_texto:'Serviço A', resumo_conversa:null, anotacoes:null, created_at:now, inicio_atendimento:now, ultima_mensagem:null, minutos_ultima_mensagem:null, ultima_reuniao:null, proxima_reuniao:null, cliente_desde:now }
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
const browser = await chromium.launch({headless:true,args:['--no-sandbox']})
const context = await browser.newContext({viewport:{width:1440,height:1000}})
const errors=[]
const page = await context.newPage()
page.on('pageerror',e=>errors.push(e.message))
const dias = Array.from({length:7},(_,i)=>i)
const tabelas = {
 contatos:()=>[lead], reunioes:()=>[meeting], profissionais:()=>[professional], catalogo_servicos:()=>services,
 oportunidades:()=>[opportunity], etapas_funil:()=>[], horario_comercial:()=>[],
 profissional_horarios:()=>dias.map(d=>({id:`h${d}`,profissional_id:professional.id,dia_semana:d,hora_inicio:'08:00',hora_fim:'18:00',ativo:true})),
 projetos:()=>[{id:'proj-1',contato_id:lead.id,oportunidade_id:opportunity.id,nome:'Projeto da venda inicial',etapa:'planejamento',prazo:null,escopo:'Escopo inicial',responsavel_id:null,created_at:now,updated_at:now,cliente:{nome:lead.nome,empresa:lead.empresa,status:lead.status},oportunidade:{nome:opportunity.nome,status:'ganho',cancelado_em:null}}],
 campanhas_lista:()=>[campanhaLinha], campanhas:()=>[campanhaCompleta], campanha_destinatarios:()=>destinatarios, campanha_eventos:()=>[{id:'ev1',tipo:'publico_congelado',descricao:'Público congelado para revisão.',criado_em:now}],
 campanhas_controle:()=>[{id:true,pausado:false,pausa_motivo:null,limite_por_minuto:30,limite_diario:250,usados_no_dia:12,proximo_disparo_em:now,atualizada_em:now}],
 marketing_consentimentos:()=>consentimentoRegistrado?[{contato_id:lead.id,ativo:true,consentido_em:now,revogado_em:null,fonte:'pediu pelo WhatsApp'}]:[],
 assistente_config:()=>[{id:true,modo:'desligada',nome:'Assistente',modelo:'claude-sonnet-5-5',instrucoes:null,numeros_teste:[],max_respostas:12,espera_segundos:6,updated_by:null,updated_at:now}],
 assistente_respostas:()=>[{mensagem_id:'r1',contato_id:lead.id,estado:'ignorada',motivo:'ia_desligada',created_at:now},{mensagem_id:'r2',contato_id:lead.id,estado:'falhou',motivo:'erro_interno',created_at:now}],
 conversas_config:()=>[{id:true,provedor:'uazapi'}],
 conversas_lista:()=>[{contato_id:lead.id,nome:lead.nome,whatsapp:lead.whatsapp,status:'novo_lead',assumida:false,assumido_por:null,assumido_em:null,assumido_por_nome:null,ultimo_conteudo:'Quero saber mais',ultimo_tipo:'texto',ultimo_autor:'cliente',ultima_em:now,nao_lidas:1,proxima_reuniao:null,...(comAssistente?{ia_ligada:false,ia_encaminhada_em:now,ia_resumo:'Quer fechar a proposta hoje'}:{})}],
 mensagens_whatsapp:()=>[{id:'m1',contato_id:lead.id,autor:'cliente',tipo:'texto',conteudo:'Quero saber mais',midia_url:null,id_externo:'e1',provedor:'uazapi',lida:false,criada_em:now},{id:'m2',contato_id:lead.id,autor:'atendente',tipo:'texto',conteudo:'Claro, como posso ajudar?',midia_url:null,id_externo:'e2',provedor:'uazapi',estado_envio:'enviado',lida:true,criada_em:now}],
 profissional_bloqueios:()=>[], oportunidade_eventos:()=>[], contatos_dados:()=>[],
 usuarios:()=>[{...user,nome:'Equipe Teste',papel,ativo:true,avatar_url:null,profissional_id:null,convidado_em:null,ultimo_acesso_em:null}],
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
 else if(url.pathname.endsWith('/functions/v1/campanhas/conta')) data={ok:true,configurada:true,numero:'+55 11 90000-0000',nome:'Empresa Teste',qualidade:'GREEN',limite:'TIER_250'}
 else if(url.pathname.endsWith('/functions/v1/whatsapp/foto')) data={ok:true,url:null}
 else if(url.pathname.includes('/functions/v1/equipe')) data={ok:true,usuarios:[
  {...user,nome:'Equipe Teste',email:'gestor@exemplo.test',papel:'gestor',ativo:true,avatar_url:null,profissional_id:null,convidado_em:null,convite_pendente:false,ultimo_acesso_em:now,criado_em:now},
  {id:'00000000-0000-4000-8000-000000000009',nome:'Consultor Convidado',email:'consultor@exemplo.test',papel:'consultor',ativo:true,avatar_url:null,profissional_id:null,convidado_em:now,convite_pendente:true,ultimo_acesso_em:null,criado_em:now}]}
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
 const rotas=['/','/crm','/leads','/clientes','/servicos','/equipe','/agenda',`/leads/${lead.id}`,'/configuracoes','/usuarios']
 for(const path of rotas){
  await page.goto(base+path)
  await page.waitForTimeout(600)
  const body=await page.locator('body').innerText()
  assert(!proibido.test(body),`Marca ou texto de nicho em ${path}`)
  assert(!body.includes('Não consegui carregar'),`Falha de carregamento em ${path}`)
  console.log('PASS rota',path)
 }
 await page.goto(base+'/')
 const desligados=[...(comCampanhas?[]:['Campanhas']),...(comAssistente?[]:['Assistente comercial de IA']),...(comProjetos?[]:['Projetos']),...((comConversas||comAssistente||comCampanhas)?[]:['Conversas'])]
 for(const modulo of desligados)
  assert.equal(await page.getByRole('link',{name:modulo,exact:true}).count(),0,`Módulo ${modulo} apareceu sem estar ligado`)
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
  let salvoCfg=null
  await context.route('**/rest/v1/rpc/assistente_salvar_config',async r=>{salvoCfg=r.request().postDataJSON();await r.fulfill({status:200,contentType:'application/json',body:''})})
  await page.goto(base+'/assistente-ia')
  await page.getByRole('heading',{name:'Assistente',exact:true}).first().waitFor()
  const tela=await page.locator('body').innerText()
  assert(!proibido.test(tela),'Marca ou texto de nicho em /assistente-ia')
  assert(tela.includes('Desligado')&&tela.includes('Ao vivo')&&tela.includes('confira a chave do modelo'),'tela do assistente incompleta')
  await page.getByRole('radio',{name:/Teste/}).check()
  await page.getByLabel(/Números de teste/).fill('(11) 98765-4321')
  await page.getByRole('button',{name:'Salvar'}).click()
  await page.waitForTimeout(400)
  assert(salvoCfg?.p_modo==='teste'&&salvoCfg.p_numeros?.[0]==='(11) 98765-4321'&&salvoCfg.p_modelo==='claude-sonnet-5-5','salvar não chamou a função com modo e números')
  console.log('PASS assistente: encaminhamento, ligar na conversa e configuração')
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
