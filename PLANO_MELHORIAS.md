# Plano de melhorias a partir do DeskcommCRM

Data: 03/10/2026. Referência: repositório público `melgarafael/DeskcommCRM`, commit
`50ae453` (02/10/2026), licença MIT.

## Andamento

- **Fase 0 (fechar a base): deixada de fora por decisão do dono, em 03/10/2026.** As migrações 0008 a 0010
  seguem sem ensaio num banco real; toda função nova abaixo herda essa pendência.
- **Fase 1 (fundação viva): feita em 03/10/2026, sem commit.** Ensaiada em Postgres local (PGlite), testes
  Deno, testes de tela e uma instalação gerada com todos os módulos. **Nada foi aplicado em Supabase real.**
  - Central de avisos (0011): `docs/CENTRAL_DE_AVISOS.md`.
  - Regra única de opt-out em dois níveis (`_shared/optout.ts`), usada pelo assistente (trava 9) e pelas campanhas.
  - Vigia (`_shared/vigia.ts`, rota `/vigiar`, `scripts/vigia-worker.mjs`): mensagem presa, WhatsApp caído,
    assistente esquecido em teste, retenção de mídia e faxina dos avisos.
  - Retenção de mídia (0012), desligada de fábrica, ligada pelo gestor em Configurações → Empresa.
  - Linha do tempo única na ficha do contato.
  - Limites conhecidos: (1) o pedido de saída só é tratado quando a IA responderia àquela mensagem ou
    quando chega pelo webhook da Meta; com o assistente desligado, uma mensagem "SAIR" pela uazapi não
    revoga o marketing; (2) sem o agendamento do vigia (a cada 5 min, com `VIGIA_SEGREDO`) os avisos
    automáticos não aparecem; (3) a linha do tempo mostra só a última mensagem do cliente, não todas.
  - Fora da fase 1, ficou: "log de webhook" e "filas" da retenção (a base não tem log de webhook; as
    filas de campanha e de resposta são pequenas).

- **Fase 2 (atendimento do dia a dia): feita em 03/10/2026, sem commit.** Mesmos testes da fase 1 (PGlite, Deno, telas
  com mocks, instalação gerada com todos os módulos). **Nada foi aplicado em Supabase real.**
  - Conversas: respostas rápidas (0013), notas internas (0014), assumir/transferir/devolver atômico com histórico e
    "só o dono escreve" (0015), adiar conversa (0016), anexos, rascunho da IA.
  - Núcleo: etiquetas (0017), responsável pela oportunidade e ações em lote (0018), importar planilha CSV (0019),
    notas e passagens na linha do tempo. Ver `docs/NUCLEO_DO_CRM.md` e `docs/MODULO_CONVERSAS.md`.
  - Campanhas: tela de Modelos da Meta (listar, criar, apagar).
  - **Pendências conhecidas:** (1) anexos e criação/remoção de modelos da Meta nunca foram exercitados contra a
    uazapi e a Meta reais; (2) gravar mensagem de voz no navegador ficou de fora (webm/opus não é aceito como voz
    pelo WhatsApp sem conversão); (3) mini-conversa flutuante e atalhos de teclado não foram feitos; (4) a mensagem
    "SAIR" pela uazapi com o assistente desligado ainda não revoga o marketing (limite da fase 1).

## O que foi revisado

O DeskcommCRM tem cerca de 990 arquivos TypeScript, 188 tabelas em
`supabase/baseline.sql` (46 mil linhas), 41 rotinas periódicas, cerca de 70 telas e um
catálogo de 60 regras de negócio. Foram lidos o catálogo de regras
(`docs/business-rules`), a navegação com a descrição de cada tela
(`lib/navigation/catalogo.ts`), os cabeçalhos dos módulos de `lib/`, todas as rotinas
de `app/api/v1/cron`, a doutrina do "sistema vivo" (`docs/doctrine/sistema-vivo.md`) e
os documentos de `docs/features`. Nem todo arquivo foi lido linha a linha: antes de
implementar um item, ler o código e os testes indicados na coluna de referência.

A comparação foi feita com esta base (`database/base` 0001–0010, `src/`,
`supabase/functions`) e com o CRM de origem, que já tem parte destas funções em uso.

## A diferença que manda em tudo

| | DeskcommCRM | Esta base |
|---|---|---|
| Modelo | Uma instalação, várias empresas (`organization_id` e RLS em toda tabela) | Uma instalação por cliente, banco próprio |
| Stack | Next.js 16, rotas de API, trabalhadores Node em Docker | Vite + React, Supabase Edge Functions, trabalhadores por cron |
| WhatsApp | WAHA (QR) e Meta oficial, vários números | uazapi nas conversas; Meta oficial só nas campanhas |
| IA | Vários agentes, RAG, roteador, skills, MCP | Um assistente com travas, que não agenda |
| Tamanho | ~400 migrações e um baseline único | 10 migrações; módulos escolhidos no gerador |

Consequência: trazer regras e desenhos, não código. A licença MIT permite copiar
trechos; quando copiar (o vocabulário de opt-out, por exemplo), manter no cabeçalho
`Adaptado de DeskcommCRM (MIT, © 2026 Rafael Melgaço)`. Não importar o tamanho: cada
item entra como peça pequena ou módulo opcional, no padrão da base.

## Ideias de fundo que valem mais que qualquer tela

1. **Nenhuma demanda sem próximo passo.** Todo negócio aberto tem um próximo passo
   agendado ou um desfecho registrado. Radar, follow-up, tarefas e encerramento existem
   para isso (invariante 4 do sistema vivo).
2. **Falha nunca é muda.** Mensagem presa, conexão caída, IA sem saldo e caso parado
   viram item numa Central de avisos; nenhum trabalhador termina num `return` silencioso
   (invariante 6).
3. **Todo estado intermediário tem dono.** "Enviando" há mais de 5 minutos vira
   "falhou" com aviso (`cron/recover-stuck-messages`); caso parado volta a pedir atenção
   (`cron/case-stale-watcher`).
4. **Gatilho do banco nunca chama HTTP.** O banco grava o evento e o trabalhador o
   consome com idempotência. A fila da Meta e as campanhas já seguem isso.
5. **Derivar em vez de guardar.** A janela de 24 h sai da última mensagem recebida,
   nunca de uma coluna de expiração (`guardrails/messaging-window.ts`).
6. **Regra pura, separada de banco e rede.** Elegibilidade, risco, opt-out e ritmo são
   funções sem I/O, com teste próprio. `_shared/assistente.ts` já segue isso.
7. **O plano gratuito do Supabase tem 500 MB.** Numa instalação real o log de webhook
   chegou a 86% do banco; retenção não é opcional (`cron/webhook-log-retention`).

## Catálogo das funções

Estado na base: **Temos**, **Parcial**, **Não**. Decisão: **Trazer** (novo),
**Adaptar** (melhorar o que existe), **Portar** (já existe no CRM de origem),
**Depois**, **Fora**. Tamanho: **P** (uma migração pequena ou uma tela), **M**
(migração, função e tela, ou um trabalhador), **G** (módulo inteiro).

### 1. Atendimento (conversas)

| Função | Referência no Deskcomm | Base | Decisão | Tam |
|---|---|---|---|---|
| Lista, conversa e ficha lado a lado, em tempo real | `app/app/inbox` | Temos | — | — |
| Anexar imagem, documento, áudio gravado, emoji, contato e localização | `components/inbox/composer` | Não (envia só texto; recebe mídia) | Trazer | M |
| Respostas rápidas com `{{nome}}` e `{{primeiro_nome}}`, pessoais ou da equipe | `message_templates`, `lib/inbox/template-vars.ts` | Não | Trazer | P |
| Notas internas na conversa, que nunca saem para o WhatsApp, com menção | `conversation_notes`, regra AT-05 | Parcial (campo único "anotações") | Trazer | P |
| Etiquetas no contato e na conversa, filtro, e tela para renomear, juntar e excluir | `app/app/settings/tags`, `lib/inbox/marcador-da-conversa.ts` | Não | Trazer | M |
| Adiar conversa: sai da fila e volta sozinha se o cliente não respondeu | `cron/snooze-watcher` | Não | Trazer | P |
| "Eu cuido" atômico, transferir com registro, gestor vê sem escrever | regras AT-02 e AT-04 | Parcial (assumir e devolver) | Adaptar | P |
| Distribuição automática entre quem está disponível, com horário e capacidade | `lib/routing` | Não | Depois (só com cliente que tenha equipe) | M |
| Rascunho da IA no compositor, revisado pela pessoa antes de sair | `agent-engine/agent/draft-reply.ts` | Não | Trazer | P |
| Mesclar contatos duplicados | `lib/contacts/duplicados.ts`, `MergeDialog` | Não (só número único) | Trazer | M |
| Telefone por trás do id opaco do WhatsApp (LID) | `cron/contact-phones` | Não verificado | Verificar já (ver fase 0) | P |
| Grupos não viram contato | regra W-09 | Temos | — | — |
| Mini-conversa flutuante em qualquer tela; atalhos de teclado | `docs/features/mensagens-rapidas.md` | Não | Depois | M |

### 2. Funil e contatos

| Função | Referência no Deskcomm | Base | Decisão | Tam |
|---|---|---|---|---|
| Quadro com arrastar e soltar | `components/kanban` | Temos | — | — |
| Rótulo, cor e ordem das etapas por nicho; ganho e perdido derivados da etapa | regras P-02 e P-07 | Temos (chaves fixas) | — | — |
| Funis prontos por tipo de negócio (clínica, imobiliária, serviços, curso, loja) | `lib/onboarding/pacotes-de-funil.ts` | Não | Trazer no gerador (`--nicho`) | P |
| Vários funis e clonar negócio para outro funil | regra P-01 | Não | Fora por ora (uma operação por instalação) | G |
| Motivos de perda editáveis; relatório por motivo e pela etapa de onde saiu | `lib/leads/motivos-de-perda-do-funil.ts`, `lib/metrics/perdas.ts` | Parcial (6 motivos fixos, sem relatório) | Adaptar | P |
| Campos personalizados e campos obrigatórios por etapa | `lib/leads/campos-exigidos.ts`, `components/contacts/CustomFieldsEditor.tsx` | Não | Trazer (é o caminho para nicho sem mexer no núcleo) | G |
| Responsável pelo negócio | `lib/kanban/owner.ts` | Não (só em projetos) | Trazer | P |
| Ações em lote no quadro, até 50 por vez | regra AT-06, `BulkActionBar` | Não | Trazer | P |
| Linha do tempo única: mensagens, etapas, reuniões, notas, tarefas e ações da IA | `lib/leads/timeline-*`, invariante 3 | Parcial (eventos de etapa e mensagens, separados) | Trazer | M |
| Tarefas com prazo e lista de vencidas, criadas à mão, por automação ou por follow-up | `lib/tarefas`, `app/app/tasks` | Não | Trazer | M |
| Aviso e som quando um negócio entra numa etapa marcada | `lib/leads/aviso-de-etapa.ts` | Não | Trazer | P |
| Previsão ponderada de receita por data prevista de fechamento | `lib/leads/previsao.ts` | Não | Trazer (exige data prevista) | M |
| Importar contatos por planilha (CSV/XLSX) | `lib/leads/planilha.ts`, `app/app/imports` | Não | Trazer | M |
| Score explicável por fórmula | `lib/leads/score-formula.ts` | Não | Depois | M |
| Proposta de reativação quando o negócio esfria | `lib/leads/reactivation.ts` | Parcial (`retomar_em`) | Depois | M |
| IA propõe um dado do contato e a pessoa aprova | `lib/contacts/proposta-de-dado.ts` | Não | Depois | M |
| Propostas comerciais: modelo, PDF, numeração atômica, validade, aviso de vencida | `lib/propostas`, crons `proposal-*` | Parcial (só o valor) | Trazer como módulo | G |
| Empresas e pessoas (B2B) | módulo `crm_b2b` | Parcial (campo empresa) | Fora | — |

### 3. Agenda

| Função | Referência no Deskcomm | Base | Decisão | Tam |
|---|---|---|---|---|
| Profissionais, jornada, bloqueios, horários livres, marcar, remarcar e cancelar | `lib/agenda` | Temos | — | — |
| Lembretes antes da reunião, vários degraus com texto próprio | `cron/agenda-reminder`, `lib/agenda/lembretes.ts` | Não (origem: 0032, 24 h e 3 h, publicado desligado) | Portar e ampliar | M |
| Falta à reunião inicia um fluxo de recuperação | `followup/no-show-recuperacao-esgotada.ts` | Parcial (`faltou_em`) | Trazer com o follow-up | M |
| Google Agenda: ocupação, sincronização e Meet | `lib/agenda/google`, crons `agenda-google-*` | Não | Depois | G |
| Página pública de agendamento | `app/vitrine-agenda` | Não | Depois | M |
| Aniversário do contato vira evento para automação | `cron/contact-birthdays` | Não (sem data de nascimento) | Depois, com as automações | P |

### 4. Follow-up e automações

| Função | Referência no Deskcomm | Base | Decisão | Tam |
|---|---|---|---|---|
| Follow-up em fluxo ("escada de toques"): gatilhos silêncio, etapa, cliente voltou, negócio criado e falta; cancela quando o cliente responde; a pessoa pausa, adia e pula; taxa de conversão por fluxo; modelos prontos | `lib/followup` (`engine.ts`, `silence-sweep.ts`, `gatilho-*.ts`, `intervencao.ts`, `modelos/escada.ts`) | Não (origem: um toque às 23 h, 0037) | Trazer em duas versões: v1 texto fixo com silêncio e etapa; v2 com IA e esperas adaptativas | G |
| Pausa antes de reinscrever quem já passou pelo fluxo, para não entrar em laço a cada "obrigado" | `followup/pausa-de-reentrada.ts` | — | Regra obrigatória da v1 | — |
| Automações QUANDO / SE / ENTÃO com anti-laço. Gatilhos: negócio criado, mudou de etapa, N dias na etapa, N dias sem mensagem, etiqueta, data, mensagem recebida, falha de envio, reunião criada, confirmada, remarcada, cancelada, faltou ou concluída. Ações: etiqueta, responsável, mover ou criar negócio, tarefa, WhatsApp, mensagem da IA, iniciar follow-up, webhook | `lib/automation` | Não (regras fixas em SQL) | Trazer depois de etiquetas e tarefas | G |
| Captação de formulários por webhook (genérico com UTM, Elementor, RD Station, Respondi) e tela "Leads recebidos" | `lib/webhooks` | Não | Trazer | M |
| Webhooks de saída com reenvio | `automation/actions/call-webhook.ts` | Não | Depois | M |

### 5. Assistente de IA

| Função | Referência no Deskcomm | Base | Decisão | Tam |
|---|---|---|---|---|
| Numa rajada, só a última mensagem; nunca duas respostas à mesma | `agent/turno-ja-respondido.ts` | Temos (trava 8) | — | — |
| Resposta em bolhas por parágrafo | `agent/split-message.ts` | Temos (até 3) | — | — |
| Espera proporcional ao tamanho da resposta, para não parecer robô | `agent/atraso-humano.ts` | Parcial (espera fixa) | Adaptar | P |
| Passagem por frase ("quero falar com uma pessoa") antes do modelo, sem gastar IA | `agent/human-handoff.ts` | Não (só pela ferramenta do modelo) | Trazer | P |
| Resumo da passagem: por quê, o que já foi feito, o que falta | `escalacao/briefing-da-passagem.ts` | Parcial (`ia_resumo`; origem: 0035 com pendências) | Portar | M |
| A frase da passagem ao cliente é do sistema, não do modelo | `escalacao/aviso-ao-lead.ts` | Temos (despedida) | — | — |
| Volta automática ao assistente depois de X minutos sem resposta da equipe | `escalacao/devolucao-automatica.ts` | Não (trava fixa de 12 h) | Adaptar | P |
| Fila de casos para a equipe, com aviso quando um caso fica parado | `cron/case-stale-watcher`, `escalacao/chamados.ts` | Não (origem: 0035) | Portar | M |
| Trava de preço: valor citado fora da tabela não sai | `guardrails/promise` | Não | Trazer (tabela = catálogo de serviços) | M |
| Trava de vocabulário interno: nome de ferramenta, de tabela ou erro cru | `guardrails/vazamento-interno.ts` | Não | Trazer | P |
| Trava "prometeu a equipe sem chamar a equipe" | `guardrails/human-promise.ts` | Não | Trazer | P |
| Opt-out em dois níveis: pedido claro bloqueia; pedido ambíguo cala e chama a equipe | `lib/opt-out/deteccao.ts`, regra W-02 | Parcial (palavra isolada, só nas campanhas) | Trazer uma regra única para todo envio | P |
| Assunto jurídico (Procon, advogado, processo) passa à equipe na hora | regra IA-09 | Não | Trazer | P |
| Teto mensal de gasto com aviso em 80% e pausa em 100%; custo de cada resposta | regra IA-10, `llm_calls.cost_cents` | Não | Trazer | M |
| Provedor sem saldo: a resposta espera a recarga e a equipe é avisada | `queue/espera-de-saldo.ts` | Não | Trazer | P |
| Modo teste esquecido vira aviso | `channels/canal-mudo.ts` | Não | Trazer | P |
| Revisão das conversas com melhoria aprovada pelo gestor | `flywheel/live.ts` | Não (origem: 0036) | Portar como opcional | G |
| Notas duráveis por contato e resumo contínuo da conversa | `agent/lead-notes.ts`, `agent/compaction.ts` | Parcial (`ia_resumo`) | Depois | M |
| A IA sugere a etapa do funil e a confirmação é separada | `agent/stage-classifier.ts` | Não | Depois | M |
| Áudio e imagem lidos pela IA | `agent/media-parts.ts` | Não (só texto) | Depois | M |
| Base de conhecimento (RAG), vários agentes, roteador, skills, memória da organização, MCP | `lib/ai`, `lib/agent-engine` | Não | Fora por ora (o texto de informações basta no porte atual) | — |

### 6. WhatsApp, Meta e campanhas

| Função | Referência no Deskcomm | Base | Decisão | Tam |
|---|---|---|---|---|
| Anti-banimento: intervalo aleatório, janela de horário, aquecimento de número novo e teto diário | `agent-engine/pacing/engine.ts`, regras W-01, W-06 e W-07 | Parcial (limite por minuto e por dia) | Adaptar: aquecimento e intervalo aleatório | P |
| Vigia ativo da conexão, que avisa mesmo com o CRM fechado | `cron/channel-health` | Parcial (faixa vermelha só com o CRM aberto) | Adaptar | P |
| Mensagem presa em "enviando" vira falha com aviso | `cron/recover-stuck-messages`, regra W-12 | Parcial (envio incerto nas campanhas) | Adaptar para todo envio | P |
| Modelos da Meta: listar, criar, editar, apagar, sincronizar a aprovação e conferir antes de enviar | `channels/gestao-de-modelos.ts`, `channels/meta/template-sync.ts`, `channels/conferir-definicao.ts` | Não (origem: catálogo só de leitura) | Trazer | M |
| Conversas pela API oficial da Meta, com janela de 24 h | `lib/channels/meta` | Não (base: uazapi; origem: 0029) | Portar (decisão pendente) | G |
| Campanha com público por filtro, funil por carimbo (enviado, entregue, lido, respondeu), resposta ligada à campanha, lista de exclusão da operação (diferente de opt-out) e `{{saudacao}}` | `lib/campanhas` | Parcial (público congelado, consentimento, limites) | Adaptar | M |
| Saúde do número: taxa de bloqueio e de resposta seguram os envios | `agent-engine/health/circuit.ts` | Não | Depois | M |
| Vários números revezando numa campanha | `campanhas/rodizio.ts` | Não | Fora por ora | — |

### 7. Prospecção

| Função | Referência no Deskcomm | Base | Decisão | Tam |
|---|---|---|---|---|
| Ritmo da abordagem fria abaixo do aquecimento normal; uma campanha ativa; 50 tentativas em 24 h; 5 minutos entre abordagens | `prospecting/ritmo-da-esteira-fria.ts`, `docs/features/prospeccao-nativa.md` | Não | Trazer para as campanhas de prospecção | P |
| Saída oferecida na primeira mensagem fria | `prospecting/rodape-de-saida.ts` | Não (origem: rodapé e botão "Não tenho interesse") | Portar | P |
| Busca de empresas no Google Maps (Apify) com teto de custo | `lib/prospecting` | Não (origem: lista comprada, 0040) | Depois | M |

### 8. Origem do cliente e anúncios

| Função | Referência no Deskcomm | Base | Decisão | Tam |
|---|---|---|---|---|
| Origem do clique-para-WhatsApp (dados do anúncio enviados pela Meta) gravada na primeira mensagem, sem sobrescrever o primeiro toque | `leads/atribuicao-de-anuncio.ts`, `channels/atribuicao-de-anuncio-oficial.ts` | Parcial (origem escolhida à mão) | Trazer (exige conversas pela Meta) | M |
| Código `[ref:XXXXXX]` para landing page com botão de WhatsApp, que guarda as UTMs | `docs/features/trackeamento-de-campanha.md`, `leads/origem-do-site.ts` | Não | Trazer | M |
| Venda devolvida à Meta (Conversions API) e ao Google Ads | `lib/conversoes` | Não | Depois | G |
| Custo por resultado das campanhas da Meta | `app/app/ads/meta` | Não | Depois | M |

### 9. Análise

| Função | Referência no Deskcomm | Base | Decisão | Tam |
|---|---|---|---|---|
| Painel do período | — | Temos | — | — |
| Radar de quem esfriou: crítico, em risco, em voo (tem follow-up), com janela por etapa | `lib/leads/risk-radar.ts`, `cron/risk-watcher` | Não | Trazer | M |
| Desempenho por atendente: conversas, primeira resposta média, ganhos e perdas | `fn_attendant_metrics`, `app/app/metrics` | Parcial (por profissional, só reuniões) | Adaptar | M |
| Relatório de atividades: quem fez o quê, pessoa ou IA | `lib/reports/atividades.ts` | Não | Depois (sai da linha do tempo) | M |
| Índice de atrito: toda medida de eficiência ao lado da que mostra o dano | `lib/metrics/atrito.ts` | Não | Fora (ideia guardada) | — |

### 10. Equipe, segurança, LGPD e operação

| Função | Referência no Deskcomm | Base | Decisão | Tam |
|---|---|---|---|---|
| Papéis e convite por link | `app/app/team` | Temos (gestor e equipe) | — | — |
| Central de avisos com gravidade e som | `agent_inbox_items`, `app/app/ai/inbox` | Não | Trazer (fundação do resto) | M |
| Avisos no celular (push) ou no WhatsApp do gestor | `notifications/push-dos-avisos.ts` | Não | Trazer junto com a Central | M |
| Registro de auditoria que só aceita inclusão | regra L-10, `lib/audit` | Parcial (eventos de etapa e de consentimento) | Trazer | M |
| LGPD: exportar os dados do titular e anonimizar em cascata, sem volta | `lib/lgpd` | Parcial (apagar pessoa) | Adaptar | M |
| Retenção de mídia, do log de webhook e das filas | crons `media-retention`, `webhook-log-retention`, `data-retention` | Não | Trazer | P |
| Primeiro acesso guiado: WhatsApp, funil sugerido, equipe, assistente e teste | `app/onboarding` | Parcial (gerador e guia) | Adaptar | M |
| Diagnóstico, cópia de segurança e restauração em um comando | `hostgator-setup-kit` (`healthcheck.sh`, `backup.sh`, `restore.sh`) | Parcial (ensaios de banco) | Trazer | M |
| Teste geral que reprova tabela sem RLS e auditoria editável | `tests/invariants` | Parcial (`*_check.sql` por migração) | Adaptar | P |
| Verificação em duas etapas e sessões | `app/app/settings/security` | Não | Depois (o Supabase Auth tem TOTP) | M |
| Multiempresa, cobrança, revenda, admin de plataforma, atualização pela tela, extensões, MCP público, telefonia e voz, Nuvemshop, financeiro, comandas, honorários, banco externo | — | — | Fora | — |

## Fases

**Fase 0 — Fechar a base antes de crescer (FORA, por decisão do dono).** Concluir o passo 6 do `PLANO_BASE.md`: as
migrações 0008–0010 nunca rodaram num banco real, e cada função nova se apoia nelas.
Decidir se o módulo conversas ganha a Meta oficial (ver decisões). Conferir com tráfego
real se a uazapi entrega o telefone ou um id opaco (LID): `_shared/uazapi.ts` usa os
dígitos de `chatid`, e no Deskcomm 52 de 54 contatos chegaram sem telefone por causa
disso.

**Fase 1 — Fundação viva (FEITA).** Peças pequenas que o resto usa:
- Central de avisos: tabela de avisos com gravidade e referência, sino no topo, som e,
  opcionalmente, mensagem no WhatsApp do gestor.
- Linha do tempo única do contato.
- Regra única de opt-out em dois níveis, usada pelo assistente e pelas campanhas.
- Vigias: mensagem presa, conexão caída (com o CRM fechado) e modo teste esquecido.
- Retenção de mídia, log de webhook e filas.

**Fase 2 — Atendimento do dia a dia (FEITA, exceto voz gravada e mini-conversa).** Respostas rápidas, notas internas, etiquetas,
adiar conversa, anexos e áudio no compositor, transferir conversa, responsável pelo
negócio, rascunho da IA, ações em lote, importação de planilha e a tela de modelos da
Meta (a pendência que falta para fechar o módulo campanhas).

**Fase 3 — Nenhum lead morre em silêncio.** Radar, tarefas, lembretes de reunião
(portar a 0032), follow-up v1, recuperação de falta e volta automática ao assistente.

**Fase 4 — De onde vem o cliente.** Captação de formulários com UTM, código `[ref:]`
para landing page, origem do clique-para-WhatsApp (se as conversas tiverem a Meta) e
relatório por origem. É o que mostra ao cliente de tráfego pago quanto cada anúncio
trouxe.

**Fase 5 — Assistente mais seguro.** Passagem por frase, travas de preço, de
vocabulário interno, de promessa da equipe e de assunto jurídico, teto mensal de gasto,
espera de saldo, espera proporcional, e portar a fila de casos (0035) e a revisão com
melhorias (0036) como opcionais.

**Fase 6 — Nicho sem mexer no núcleo.** Campos personalizados, campos obrigatórios por
etapa, motivos de perda editáveis, funis prontos por nicho no gerador e primeiro acesso
guiado. Isto cumpre o critério do `PLANO_BASE.md`: um segundo nicho sem alterar o
núcleo.

**Fase 7 — Gestão e conformidade.** Desempenho por atendente, perdas, previsão,
auditoria, LGPD, automações QUANDO / SE / ENTÃO, módulo de propostas, distribuição
automática, diagnóstico e cópia de segurança, verificação em duas etapas.

**Depois:** follow-up v2 com IA, Google Agenda, conversões para Meta e Google, busca de
empresas para prospecção, score, saúde do número.

## Como cada item entra na base

1. Ler a referência no Deskcomm, código e testes.
2. Escrever a regra como função pura, com teste Deno, antes da tela.
3. Migração `database/base/00NN_<nome>.sql` com `00NN_check.sql`; ensaio local e num
   projeto descartável.
4. Tela e `scripts/browser-check.mjs`.
5. Documento do módulo e gerador (lista autorizada, `.env.example`, README da
   instalação).
6. `npm run preflight`, build e lint.
7. Só então levar ao CRM de origem.

## Decisões pendentes

1. **Alvo:** base primeiro e CRM de origem depois (recomendado), ou o contrário.
2. **Meta oficial nas conversas da base:** sem ela ficam de fora a janela de 24 h, a
   origem do anúncio de clique-para-WhatsApp e os lembretes por modelo aprovado.
3. **Ordem:** a sugerida põe a fundação antes das funções visíveis. Para mostrar
   resultado a cliente mais cedo, trocar as fases 2 e 3 de lugar.
4. **Fase 0:** validar a base antes de começar ou em paralelo.
