// Gerador de instalações: copia da base SÓ o que está na lista abaixo para uma
// pasta nova, fora desta, com nome, domínio e módulos do cliente. Não acessa a
// rede nem lê credenciais; falha (e apaga a pasta) se a varredura achar algo
// da ARC ou de outro cliente.
//
//   node scripts/gerar-instalacao.mjs ../clientes/acme --slug acme --nome "Acme Ltda" \
//        --dominio crm.acme.com.br [--modulos conversas] [--fuso America/Sao_Paulo] [--sem-git]
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
import { varrer } from './lib/proibidos.mjs'

const base = resolve(import.meta.dirname, '..')

// Módulos que já existem na base.
const MODULOS = {
  captacao: {
    migracoes: ['0025_captacao_de_formularios', '0026_origens_e_relatorio'],
    funcoes: ['captacao'],
    compartilhados: ['captacao.ts', 'captacao_test.ts', 'origem_captacao.ts', 'origem_integracao_test.ts'],
    scripts: ['test:captacao', 'test:captacao:db:rehearsal', 'test:captacao:db:apply', 'test:ui:captacao', 'test:origens:db:rehearsal', 'test:origens:db:apply'],
  },
  conversas: {
    migracoes: ['0007_modulo_conversas', '0012_retencao_de_midia', '0013_respostas_rapidas', '0014_notas_internas', '0015_assumir_e_transferir', '0016_adiar_conversa', '0024_automacoes_de_envio'],
    funcoes: ['whatsapp', 'automacoes'],
    compartilhados: ['uazapi.ts', 'whatsapp.ts', 'origem.ts', 'gancho.ts', 'sessao.ts', 'conversas_test.ts', 'optout.ts', 'optout_test.ts', 'vigia.ts', 'vigia_test.ts', 'automacoes.ts', 'automacoes_test.ts', 'meta-api.ts', 'meta-protocolo.ts', 'anexos.ts', 'anexos_test.ts'],
    arquivos: ['scripts/vigia-worker.mjs', 'scripts/automacoes-worker.mjs'],
    scripts: ['test:automacoes', 'test:automacoes:db:rehearsal', 'test:automacoes:db:apply', 'test:conversas', 'test:optout', 'test:vigia', 'test:anexos', 'test:conversas:db:rehearsal', 'test:conversas:db:apply', 'test:retencao:db:rehearsal', 'test:retencao:db:apply', 'test:respostas:db:rehearsal', 'test:respostas:db:apply', 'test:notas:db:rehearsal', 'test:notas:db:apply', 'test:conversa-dono:db:rehearsal', 'test:conversa-dono:db:apply', 'test:adiar:db:rehearsal', 'test:adiar:db:apply', 'test:ui:conversas'],
  },
  assistente: {
    requer: ['conversas'],
    migracoes: ['0009_modulo_assistente', '0022_volta_ao_assistente', '0027_assistente_seguro'],
    funcoes: [],
    // `gancho_assistente.ts` ocupa o lugar do `gancho.ts` vazio do módulo conversas.
    compartilhados: ['llm.ts', 'seguranca_ia.ts', 'seguranca_ia_test.ts', 'consumo_ia.ts', 'consumo_ia_test.ts', 'extras_ia.ts', 'gancho_assistente.ts', 'revisao_ia.ts', 'revisao_ia_test.ts', 'assistente.ts', 'assistente_prompt.ts', 'assistente_test.ts', ['gancho_assistente.ts', 'gancho.ts']],
    scripts: ['test:assistente', 'test:seguranca:ia', 'test:seguranca:db:rehearsal', 'test:seguranca:db:apply', 'test:assistente:db:rehearsal', 'test:assistente:db:apply', 'test:volta:db:rehearsal', 'test:volta:db:apply', 'test:ui:assistente'],
  },
  campanhas: {
    requer: ['conversas'],
    migracoes: ['0010_modulo_campanhas'],
    funcoes: ['campanhas'],
    compartilhados: ['campanhas.ts', 'meta-api.ts', 'meta-protocolo.ts', 'sessao.ts', 'campanhas_test.ts', 'meta_protocolo_test.ts'],
    arquivos: ['scripts/campanhas-worker.mjs'],
    scripts: ['test:campanhas', 'test:campanhas:db:rehearsal', 'test:campanhas:db:apply', 'test:ui:campanhas'],
  },
  casos: {
    requer: ['conversas','assistente'], migracoes: ['0028_fila_de_casos'], funcoes: [], compartilhados: [],
    scripts: ['test:casos:db:rehearsal','test:casos:db:apply','test:ui:casos'],
  },
  melhorias: {
    requer: ['conversas','assistente'], migracoes: ['0029_revisao_do_assistente'], funcoes: ['melhorias'], compartilhados: ['revisao_rota_test.ts'],
    scripts: ['test:melhorias:db:rehearsal','test:melhorias:db:apply','test:ui:melhorias','test:melhorias:rota'],
  },
  projetos: {
    migracoes: ['0008_modulo_projetos'],
    funcoes: [],
    compartilhados: [],
    scripts: ['test:projetos:db:rehearsal', 'test:projetos:db:apply', 'test:ui:projetos'],
  },
}
const NUCLEO = {
  migracoes: ['0001_base', '0002_nucleo_configuravel', '0003_contatos_proxima_reuniao', '0004_dashboard', '0005_funcoes_so_equipe', '0006_storage_perfil_logo', '0011_central_de_avisos', '0017_etiquetas', '0018_responsavel_e_lote', '0019_importar_contatos', '0020_tarefas', '0021_radar', '0023_recuperacao_de_falta', '0030_nicho_configuravel', '0031_modelos_e_preparacao', '0032_modelo_inicial'],
  funcoes: ['equipe'],
  compartilhados: ['db.ts', 'equipe-nucleo.ts', 'equipe_nucleo_test.ts', 'avisos.ts', 'avisos_test.ts'],
  arquivos: ['index.html', 'eslint.config.js', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'vite.config.ts', 'vercel.json', 'package-lock.json', '.gitignore'],
  pastas: ['src', 'public', 'supabase/email-templates'],
  scripts: ['scripts/base-database.mjs', 'scripts/base-migrar.mjs', 'scripts/preflight-base.mjs', 'scripts/browser-check.mjs', 'scripts/auth-config.mjs', 'scripts/ensaio-local.mjs', 'scripts/lib/proibidos.mjs', 'scripts/lib/supabase-stub.sql', 'scripts/testes/lib_test.ts', 'scripts/testes/campos_test.ts'],
  npm: ['dev', 'build', 'lint', 'preview', 'preflight', 'test:db:local', 'test:lib', 'test:avisos', 'test:campos', 'test:ui:nicho', 'test:nicho:db:rehearsal', 'test:nicho:db:apply', 'test:preparacao:db:rehearsal', 'test:preparacao:db:apply', 'auth:config', 'auth:aplicar', 'test:ui',
    ...['base', 'nucleo', 'contatos', 'dashboard', 'funcoes', 'storage', 'avisos', 'etiquetas', 'responsavel', 'importar', 'tarefas', 'radar', 'recuperacao'].flatMap(n => n === 'base'
      ? ['test:base:db:rehearsal', 'test:base:db:apply', 'test:base:db:verify']
      : [`test:${n}:db:rehearsal`, `test:${n}:db:apply`])],
}

function falhar(msg) { console.error(`Erro: ${msg}`); process.exit(1) }

const [destinoArg, ...resto] = process.argv.slice(2)
const opcoes = {}
for (let i = 0; i < resto.length; i++) {
  if (!resto[i].startsWith('--')) falhar(`argumento inesperado: ${resto[i]}`)
  const chave = resto[i].slice(2)
  opcoes[chave] = chave === 'sem-git' ? true : resto[++i]
}
if (!destinoArg || !opcoes.slug || !opcoes.nome || !opcoes.dominio) {
  falhar('uso: gerar-instalacao.mjs <pasta-destino> --slug <slug> --nome "<Nome>" --dominio <host> [--modulos a,b] [--fuso <tz>] [--sem-git]')
}

const destino = resolve(destinoArg)
if (destino === base || destino.startsWith(base + sep)) falhar('o destino deve ficar fora da pasta da base.')
if (existsSync(destino) && readdirSync(destino).length) falhar(`${destino} já existe e não está vazia.`)

const slug = opcoes.slug
if (!/^[a-z][a-z0-9-]{2,30}$/.test(slug)) falhar('slug: 3 a 31 caracteres, minúsculas, números e hífen, começando por letra.')
const dominio = opcoes.dominio.toLowerCase()
if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(dominio)) falhar('domínio inválido (use só o host, sem https://).')
const nome = opcoes.nome.trim()
if (!nome || nome.length > 80 || /[<>"\\]/.test(nome)) falhar('nome vazio, longo demais ou com caracteres < > " \\.')
const fuso = opcoes.fuso ?? 'America/Sao_Paulo'
try { new Intl.DateTimeFormat('pt-BR', { timeZone: fuso }) } catch { falhar(`fuso desconhecido: ${fuso}`) }
const modelosNicho = JSON.parse(readFileSync(join(base,'src/lib/modelosNicho.json'),'utf8'))
const nicho = opcoes.nicho ?? 'generico'
if (!modelosNicho.some(m=>m.chave===nicho)) falhar(`nicho inválido. Disponíveis: ${modelosNicho.map(m=>m.chave).join(', ')}.`)
const pedidos = (opcoes.modulos ?? '').split(',').map(m => m.trim()).filter(Boolean)
for (const m of pedidos) if (!MODULOS[m]) falhar(`módulo "${m}" não existe ainda. Disponíveis: ${Object.keys(MODULOS).join(', ')}.`)
// Ordem canônica (a do MODULOS): quem troca um arquivo do anterior vem depois, qualquer que seja a ordem digitada.
const modulos = Object.keys(MODULOS).filter(m => pedidos.includes(m))
for (const m of modulos) {
  if (!MODULOS[m]) falhar(`módulo "${m}" não existe ainda. Disponíveis: ${Object.keys(MODULOS).join(', ')}.`)
  for (const dep of MODULOS[m].requer ?? []) if (!modulos.includes(dep)) falhar(`o módulo "${m}" exige o módulo "${dep}".`)
}

// Argumentos também passam pela varredura: não se gera instalação apontando para a ARC.
const argsTexto = join(destino, '.args-tmp')
mkdirSync(destino, { recursive: true })
writeFileSync(argsTexto, [slug, dominio, nome].join('\n'))
const argsRuins = varrer(destino)
rmSync(argsTexto)
if (argsRuins.length) { rmSync(destino, { recursive: true, force: true }); falhar(`argumentos apontam para ${argsRuins[0].motivo}.`) }

const copiar = (rel) => {
  const origem = join(base, rel)
  if (!existsSync(origem)) throw Error(`arquivo da lista não existe na base: ${rel}`)
  mkdirSync(dirname(join(destino, rel)), { recursive: true })
  cpSync(origem, join(destino, rel), { recursive: true })
}

try {
  const sel = modulos.map(m => MODULOS[m])
  const migracoes = [...NUCLEO.migracoes, ...sel.flatMap(m => m.migracoes)].sort()
  const funcoes = [...NUCLEO.funcoes, ...sel.flatMap(m => m.funcoes)]
  const compartilhados = [...NUCLEO.compartilhados, ...sel.flatMap(m => m.compartilhados)]

  NUCLEO.arquivos.forEach(copiar)
  NUCLEO.pastas.forEach(copiar)
  NUCLEO.scripts.forEach(copiar)
  sel.flatMap(m => m.arquivos ?? []).forEach(copiar)
  for (const v of migracoes) { copiar(`database/base/${v}.sql`); copiar(`database/base/${v.slice(0, 4)}_check.sql`) }
  if (nicho !== 'generico') {
    const versao='0032_modelo_inicial'
    const m=modelosNicho.find(m=>m.chave===nicho)
    const chaves=['novo_lead','qualificacao','diagnostico','diagnostico_realizado','proposta','negociacao','ganho','perdido']
    const updates=m.rotulos.map((r,i)=>`UPDATE public.etapas_funil SET rotulo='${r.replaceAll("'","''")}' WHERE chave='${chaves[i]}';`).join('\n')
    writeFileSync(join(destino,`database/base/${versao}.sql`),`BEGIN;\n${updates}\nUPDATE public.preparacao_crm SET modelo='${nicho}' WHERE id;\nINSERT INTO crm_base_private.schema_migrations(version) VALUES('${versao}');\nNOTIFY pgrst,'reload schema';\nCOMMIT;\n`)
    writeFileSync(join(destino,'database/base/0032_check.sql'),`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.preparacao_crm WHERE modelo='${nicho}') THEN RAISE EXCEPTION 'FAIL: modelo inicial';END IF;END $$;\n`)
  }
  funcoes.forEach(f => copiar(`supabase/functions/${f}`))
  // Um módulo pode trocar um arquivo do anterior: [origem, destino] vence o arquivo de mesmo nome.
  const destinos = new Map()
  for (const item of compartilhados) { const [origem, nomeFinal] = Array.isArray(item) ? item : [item, item]; destinos.set(nomeFinal, origem) }
  if (modulos.includes('casos') || modulos.includes('melhorias')) destinos.set('extras_ia.ts', modulos.includes('casos') && modulos.includes('melhorias') ? 'extras_ia_completo.ts' : modulos.includes('casos') ? 'extras_ia_casos.ts' : 'extras_ia_melhorias.ts')
  if (modulos.includes('captacao')) destinos.set('origem.ts', 'origem_captacao.ts')
  for (const [nomeFinal, origem] of destinos) {
    mkdirSync(join(destino, 'supabase/functions/_shared'), { recursive: true })
    cpSync(join(base, `supabase/functions/_shared/${origem}`), join(destino, `supabase/functions/_shared/${nomeFinal}`))
  }

  // package.json: só os comandos autorizados (nada de publicar/worker) e nome próprio.
  const pacote = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8'))
  const permitidos = new Set([...NUCLEO.npm, ...sel.flatMap(m => m.scripts)])
  pacote.name = slug
  pacote.scripts = {
    ...Object.fromEntries(Object.entries(pacote.scripts).filter(([k]) => permitidos.has(k))),
    'auth:config': 'node scripts/auth-config.mjs show',
    'auth:aplicar': 'node scripts/auth-config.mjs apply --confirm',
  }
  writeFileSync(join(destino, 'package.json'), JSON.stringify(pacote, null, 2) + '\n')

  // index.html: título e chave de tema próprios.
  const nomeHtml = nome.replaceAll('&', '&amp;').replaceAll("'", '&#39;')
  const html = readFileSync(join(destino, 'index.html'), 'utf8')
    .replace('<title>CRM</title>', `<title>${nomeHtml}</title>`)
    .replaceAll('crm-base.tema', `${slug}.tema`)
  writeFileSync(join(destino, 'index.html'), html)
  for (const modelo of ['convite.html', 'recuperar-senha.html']) {
    const caminho = join(destino, 'supabase/email-templates', modelo)
    writeFileSync(caminho, readFileSync(caminho, 'utf8').replaceAll('CRM', nomeHtml))
  }

  let revisao = 'desconhecida'
  try { revisao = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: base }).toString().trim() } catch { /* sem git */ }
  const instalacao = { slug, nome, dominio, fuso, nicho, modulos, migracoes, funcoes, base_revisao: revisao, gerada_em: new Date().toISOString().slice(0, 10) }
  writeFileSync(join(destino, 'instalacao.json'), JSON.stringify(instalacao, null, 2) + '\n')

  writeFileSync(join(destino, '.env.example'), `VITE_SUPABASE_URL=\nVITE_SUPABASE_ANON_KEY=\nVITE_MODULOS=${modulos.join(',')}\n`)
  writeFileSync(join(destino, 'AGENTS.md'), `# ${nome}\n\nInstalação derivada da base mestre (revisão ${revisao}). Projeto Supabase, chaves, domínio (${dominio}), Storage e integrações são só deste cliente.\nNunca use credenciais, dados ou projetos de outro cliente aqui. Melhorias comuns voltam para a base; dados e customizações deste cliente não.\n\`npm run preflight\` confere o isolamento.\n`)
  const linhasMigracoes = migracoes.slice(1).flatMap(v => {
    const sql = `database/base/${v}.sql`
    const check = `database/base/${v.slice(0, 4)}_check.sql`
    return [`node scripts/base-migrar.mjs rehearse ${sql} ${check}`,
      `node scripts/base-migrar.mjs apply ${sql} ${check} --confirm`]
  }).join('\n')
  const linhasFuncoes = funcoes.map(f => `supabase functions deploy ${f} --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt`).join('\n')
  const extras = [
    `- Preparação: modelo inicial ${nicho}. No primeiro acesso, abra /preparacao, confira empresa, horários, catálogo e funil. Em Configurações → Personalização, defina campos e motivos de perda; exigências por etapa são conferidas no banco. O guia não ativa integrações nem substitui o aceite real.`,
    modulos.includes('captacao') && '- Captação: aplique a 0025 e a 0026 antes de publicar os webhooks. Publique `captacao` com `--no-verify-jwt`. Em Leads recebidos, o gestor cria uma fonte desligada, guarda o segredo no servidor do site e configura POST JSON ou formulário plano para o endereço exibido, com cabeçalho `X-Captacao-Segredo`. Envie `whatsapp` e `id_externo` único por envio (reenvios mantêm o mesmo ID), e opcionalmente `nome`, `email`, `empresa` e as cinco UTMs. Ative só depois de revisar; telefone repetido não altera o contato nem a primeira origem. Nunca coloque o segredo no JavaScript público. Para landing pages, configure o código de referência e as UTMs da fonte e inclua `[ref:codigo]` na mensagem do botão WhatsApp (exige conversas). Com campanhas, o webhook da Meta registra a origem de anúncios/publicações quando a Meta entrega referral. Consulte o relatório por origem em Leads recebidos.',
    modulos.includes('conversas') && '- Conversas: configure `WEBHOOK_SEGREDO`, `UAZAPI_API_URL` e `UAZAPI_TOKEN` nos secrets das Edge Functions; configure o webhook da uazapi para `https://<ref>.supabase.co/functions/v1/whatsapp` e teste conexão, recebimento e envio. Configure também `VIGIA_SEGREDO` (24+ caracteres) e agende `node scripts/vigia-worker.mjs` a cada 5 minutos, com `SUPABASE_URL` e `VIGIA_SEGREDO` no ambiente do agendador: é ele que avisa na Central quando o WhatsApp cai ou uma mensagem não sai; sem o agendamento esses avisos não aparecem.',
    modulos.includes('conversas') && '- Automações: configure `AUTOMACOES_SEGREDO` (24+ caracteres) nas Edge Functions e agende `node scripts/automacoes-worker.mjs` a cada 5 minutos com `SUPABASE_URL` e `AUTOMACOES_SEGREDO`. Na tela Automações, registre a autorização dos contatos, configure os textos/modelos e só então ative as regras. Envios pela Meta exigem o módulo campanhas.',
    modulos.includes('assistente') && '- Assistente: configure `OPENAI_API_KEY` ou `ANTHROPIC_API_KEY` nos secrets. Aplique a 0027, configure o teto mensal e tarifas em US$ por milhão de tokens em Assistente; sem tarifa a IA aguarda configuração. O vigia retoma espera por saldo/orçamento após recarga confirmada. Comece no modo desligado, teste com um número permitido e só depois ative ao vivo.',
    modulos.includes('casos') && '- Casos: a 0028 acrescenta fila de atendimento humano e aviso após duas horas. Assuma e registre a solução; finalizar não religa a IA.',
    modulos.includes('melhorias') && '- Melhorias: a 0029 e a função `melhorias` acrescentam evidência, comparação sem envio, aprovação explícita do gestor e versões restauráveis. A comparação usa o orçamento da IA. Atualizações da configuração invalidam comparações antigas.',
    modulos.includes('campanhas') && '- Campanhas: configure `META_ACCESS_TOKEN`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_PHONE_NUMBER_ID`, `META_WABA_ID`, `META_GRAPH_VERSION` e `CAMPANHAS_WORKER_SECRET`. Configure o webhook da Meta em `https://<ref>.supabase.co/functions/v1/campanhas/webhook`. Agende `node scripts/campanhas-worker.mjs` uma vez por minuto com `SUPABASE_URL` e `CAMPANHAS_WORKER_SECRET` no ambiente do agendador; sem esse agendamento a fila não envia.',
  ].filter(Boolean).join('\n')
  writeFileSync(join(destino, 'README.md'), `# ${nome}\n\nInstalação gerada em ${instalacao.gerada_em} pela base mestre (${revisao}). Módulos: ${modulos.join(', ') || 'só o núcleo'}. Este repositório usa somente recursos deste cliente.\n\n## Antes de começar\n\nUse Node.js 22+ e a CLI do Supabase. Crie um projeto Supabase **novo e vazio** e tenha seu ref e um access token de gestão. Não coloque o token nem a chave service_role em arquivos do repositório ou no frontend. Reserve o domínio \`https://${dominio}\` para o CRM.\n\n\`\`\`bash\nnpm ci\nnpm run preflight\nread -r -p 'Ref do projeto Supabase: ' SUPABASE_PROJECT_REF\nexport SUPABASE_PROJECT_REF\nread -r -s -p 'Access token Supabase: ' SUPABASE_ACCESS_TOKEN\nexport SUPABASE_ACCESS_TOKEN\n\`\`\`\n\n## 1. Banco de dados\n\nConfira o ref antes de aplicar. Cada comando \`rehearse\` testa e reverte; cada \`apply\` grava a migração após passar pelo check. Execute na ordem, sem pular linhas:\n\n\`\`\`bash\nnpm run test:base:db:rehearsal\nnpm run test:base:db:apply\n${linhasMigracoes}\nnpm run test:base:db:verify\n\`\`\`\n\n## 2. Auth e primeiro gestor\n\n\`\`\`bash\nnpm run auth:config\nnpm run auth:aplicar\n\`\`\`\n\nNo painel Supabase, em Authentication → Email Templates, cole os modelos de convite e recuperação de \`supabase/email-templates/\`. Esses modelos levam à página de definição de senha. Confira que o cadastro público ficou fechado e espere o site estar publicado antes de enviar o primeiro convite.\n\n## 3. Edge Functions\n\nAutentique a CLI do Supabase com acesso a este projeto. Publique somente as funções desta instalação. A verificação JWT da plataforma fica desativada porque cada função valida a sessão, o segredo do trabalhador ou a assinatura do webhook em seu próprio código:\n\n\`\`\`bash\n${linhasFuncoes}\n\`\`\`\n\nNo painel Supabase, em Edge Functions → Secrets, defina \`APP_URL=https://${dominio}\`. O Supabase fornece \`SUPABASE_URL\`, \`SUPABASE_ANON_KEY\` e \`SUPABASE_SERVICE_ROLE_KEY\` às funções.\n${extras ? `\n${extras}\n` : ''}\n## 4. Site\n\nCopie \`.env.example\` para \`.env\` e preencha apenas \`VITE_SUPABASE_URL\` e \`VITE_SUPABASE_ANON_KEY\` com os valores públicos deste projeto. O campo \`VITE_MODULOS\` já veio configurado. Configure essas mesmas variáveis no serviço que publica o site e aponte o domínio \`${dominio}\` para ele. O arquivo \`vercel.json\` inclui o fallback das rotas do app.\n\n\`\`\`bash\nnpm run build\nnpm run lint\n\`\`\`\n\n## 5. Aceite\n\nNo painel Supabase, em Authentication → Users, envie o convite para o primeiro gestor. A primeira conta criada após as migrações recebe esse papel. Abra o site publicado, aceite o convite, defina uma senha e entre. Confira usuários, contato, oportunidade, funil, agenda e somente os módulos escolhidos. Teste RLS com uma conta consultora. Se houver integrações, verifique webhook, recebimento e envio reais antes de ativar campanhas ou assistente. Execute \`npm run preflight\` novamente e registre o resultado.\n`)

  const achados = varrer(destino)
  if (achados.length) throw Error(`varredura encontrou: ${achados.map(a => `${a.arquivo} (${a.motivo})`).join('; ')}`)

  if (!opcoes['sem-git']) {
    const git = (...a) => execFileSync('git', a, { cwd: destino, stdio: 'ignore' })
    git('init', '-q', '-b', 'main'); git('add', '-A')
    git('-c', 'user.name=gerador', '-c', 'user.email=gerador@localhost', 'commit', '-q', '-m', `base: instalação ${slug} gerada da base ${revisao}`)
  }
  console.log(`Instalação "${slug}" gerada em ${destino}\n  módulos: ${modulos.join(', ') || 'só o núcleo'}\n  migrações: ${migracoes.length} · funções: ${funcoes.join(', ')}\nPróximo passo: ${relative(process.cwd(), join(destino, 'README.md')) || 'README.md'}`)
} catch (e) {
  rmSync(destino, { recursive: true, force: true })
  falhar(`${e.message}. A pasta foi removida.`)
}
