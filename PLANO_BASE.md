# Plano da base mestre

## Produto alvo

Uma instalação por cliente, com Supabase, domínio, credenciais, Storage e
integrações próprios. O núcleo mantém usuários e papéis, contatos, oportunidades,
histórico, dashboard e agenda. Conversas, campanhas, agente de IA, automações
e projetos de entrega são módulos ativados conforme a operação.

O cadastro inicial configura nome, identidade visual, fuso, termos exibidos,
catálogo, etapas abertas do funil e textos do assistente. Estado terminal de
oportunidade continua tendo significado estável: ganha ou perdida. Campos ou
regras muito específicos ficam em módulos por nicho, sem mudar o núcleo.

## Execução

1. **Isolamento da fonte (feito):** registrar o estado de origem, copiar só
   arquivos de código, excluir credenciais e destinos da ARC, manter repositório
   separado. Comandos de escrita remota ficam bloqueados até a instalação vazia
   ser validada.
2. **Esquema inicial limpo (feito):** `database/base/0001_base.sql`, derivada do
   esquema final do Arc CRM (não do caminho clínica → agência), com objetos
   renomeados e sem colunas mortas. Núcleo apenas: usuários e papéis, contatos,
   oportunidades, histórico, agenda e dashboard — projetos, conversas,
   campanhas e agente de IA ficam para os módulos (passo 4). Nenhum contato,
   usuário, serviço ou marca nasce no banco; só configuração neutra
   (`configuracoes_negocio` com nome em branco, `horario_comercial`
   placeholder). Ensaiada e aplicada num projeto Supabase descartável via
   `scripts/base-database.mjs` (credenciais só por variável de ambiente, nunca
   em arquivo neste repositório): RLS confirmado, primeiro usuário virou
   gestor, funil e trava de catálogo conferidos pelo `0001_check.sql`.
3. **Núcleo configurável (em andamento):** feito em 27–30/09 — front migrado para
   o esquema novo (`contatos`, `reunioes`, `catalogo_servicos`,
   `configuracoes_negocio`); funil lido de `etapas_funil` (`src/lib/funil.ts`);
   módulos ligados por `VITE_MODULOS` (`src/lib/modulos.ts`; vazio = só núcleo);
   migrações 0003 (`proxima_reuniao`), 0004 (gráficos do Dashboard), 0005
   (EXECUTE das funções fechado para `anon`) e 0006 (buckets avatars/logos),
   ensaiadas e aplicadas. Aplicadas no projeto descartável em 30/09 (0003–0006).
   Função `equipe` do núcleo escrita (`supabase/functions/equipe`, testes em
   `_shared/equipe_nucleo_test.ts`; ainda NÃO publicada). Função `equipe` publicada no projeto
   descartável e exercitada no navegador (convite por link, aceite, papel,
   desligar, excluir); tela de etapas do funil em Configurações → Funil; o
   catálogo já era editável em Serviços. Exercitado também: login, contato com
   reunião, funil automático, quadro do CRM e Dashboard. Feito em 01/10: comentários e
   identificadores "clínica/paciente/dentista" removidos do `src/` (resta só o valor
   `autor='paciente'` de `mensagens_whatsapp`, contrato do módulo de conversas, passo 4;
   as funções em `supabase/functions` seguem com os nomes antigos até o passo 4);
   `scripts/browser-check.mjs` reescrito só para o núcleo (esquema novo, sem marca
   de nicho, módulos ocultos), 10 rotas passam. Falta: fechar o cadastro
   público do Auth no gerador (passo 5). Texto original do passo: tirar nomes, rótulos e regras comerciais fixos das
   telas, do SQL e do agente. Um catálogo e um funil devem ser editáveis pela
   interface; alterações precisam aparecer em dashboard, agenda e conversas.
   Ganhar venda não deve criar projeto sem o módulo de entrega ativo.
4. **Módulos opcionais (em andamento):** em 01/10 o módulo **conversas** foi escrito
   (migração 0007 + checagem, função `whatsapp` reduzida, telas desacopladas do assistente
   e das campanhas; ver `docs/MODULO_CONVERSAS.md`). Testes locais passam; em 01/10 a 0007 foi ensaiada e aplicada e a função `whatsapp`
   publicada no projeto descartável (sem uazapi: só `WEBHOOK_SEGREDO`). Exercitado no
   navegador contra o projeto real: lista, conversa e mensagens, sem erros de console/HTTP.
   Falta testar WhatsApp ponta a ponta (QR, webhook, envio), que exige uma instância
   uazapi de teste. Em 01/10 o módulo **projetos** foi escrito
   (migração 0008 + checagem, tela ajustada para etapas neutras, `test:ui:projetos`, registrado
   no gerador; ver `docs/MODULO_PROJETOS.md`): tela e gerador testados; a 0008 AINDA NÃO foi
   ensaiada num projeto real (sem token nesta máquina). Em 01/10 o módulo **assistente** foi escrito
   (migração 0009 + checagem, lógica com 8 travas e 17 testes em `_shared/assistente*.ts`, gancho
   `gancho.ts` ↔ `gancho_assistente.ts` trocado pelo gerador, tela `/assistente-ia`, encaminhamento
   à equipe na lista de conversas, `test:ui:assistente`; ver `docs/MODULO_ASSISTENTE.md`). Suporte,
   melhorias e token de API herdados ficaram fora da base pública. Tela e lógica testadas; a 0009 AINDA NÃO
   foi ensaiada num projeto real, nem o modelo/uazapi. O módulo **campanhas** foi
   implementado (migração 0010, função Meta, fila, webhook, trabalhador e telas). A
   migração passou no ensaio local; faltam ensaio num Supabase real e envio pela Meta.
   O gerador inclui o trabalhador e um roteiro de instalação por módulo. Texto original
   do passo: separar WhatsApp, campanhas, assistente e projetos,
   com permissões, telas e funções ligadas a cada módulo. Nenhum trabalhador
   periódico deve rodar sem ativação explícita da instalação.
5. **Gerador de instalações (feito em 01/10):** `npm run gerar -- <pasta> --slug x --nome "X" --dominio h [--modulos conversas]`
   (`scripts/gerar-instalacao.mjs`). Copia só a lista autorizada (núcleo + módulos escolhidos,
   migrações/funções/testes correspondentes), reescreve `package.json` sem comandos de publicação
   ou worker, gera `instalacao.json`, `.env.example`, README e git próprio, e roda a varredura
   `scripts/lib/proibidos.mjs` (refs, domínio, tokens, JWT, chaves) nos argumentos e na saída —
   se achar algo, apaga a pasta e falha. `scripts/auth-config.mjs` (`npm run auth:config|auth:aplicar`)
   fecha o cadastro público do Auth, define site_url e senha 10+; ainda não exercitado contra a
   API real (só validado localmente). Testado: instalação só-núcleo e núcleo+conversas passam
   tsc, lint, build e testes de função. `live-check.mjs` (específico do CRM de origem) ficou fora da base pública.
   Texto original: criar comando que copie apenas arquivos
   autorizados, aplique nome técnico e crie exemplos de configuração. O comando
   falha se encontrar credenciais, refs ou URLs da ARC.
6. **Validação (pendente):** duas instalações vazias em projetos isolados, configuradas
   para operações distintas. Exercitar login, RLS, contato, oportunidade,
   mudança de funil, agenda e desligamento de módulos. Build, lint e testes
   locais precisam passar antes de chamar a base de pronta.

## Decisões de arquitetura

- Não usar o mesmo banco para empresas diferentes: o RLS herdado foi desenhado
  para uma equipe por instalação.
- Preservar IDs de estados terminais (`ganho`, `perdido`) até que as transições
  sejam refeitas; rótulos visíveis podem mudar sem quebrar dados históricos.
- Substituir os nomes técnicos clínicos (`crm_clinica`, `consultas`, etc.) junto
  com todas as referências da aplicação e funções; renomear só o SQL quebra API.
- Não trazer backups `arc_backup` nem migrações de conversão para o esquema
  inicial; elas são relevantes apenas para instalações antigas.

## Critério de conclusão

Uma nova instalação abre sem dado ou marca de cliente e permite configurar um
nicho pela interface. Repetir a instalação para um segundo nicho não requer
alterar o núcleo. Nenhum comando da base consegue atingir a ARC com suas
configurações padrão.
