# Aceite da fase 3

Revisão de 04/10/2026. Escopo: tarefas (0020), radar (0021), volta automática ao
assistente (0022), recuperação de falta (0023), lembretes e follow-up v1 (0024).
A captação por formulários (0025) pertence à fase 4.

## Estado

Implementação local revisada. O aceite em Supabase e os envios reais continuam
pendentes: o dono confirmou em 04/10/2026 que ainda não tem os ambientes de teste.
Nenhuma função, migração ou rotina desta revisão foi ativada em produção.

## Verificação local

- Preflight, TypeScript, build e lint.
- Ensaio PGlite das migrações e checagens SQL, incluindo permissões e RLS.
- Testes Deno de automações, assistente, vigia, conversas, campanhas, protocolo
  Meta e pedidos de parada.
- Interface com APIs simuladas: tarefas, radar, configuração do assistente,
  regras inicialmente desligadas, ativação explícita, autorização dos contatos
  e campos de follow-up e Meta.
- Instalações geradas com núcleo e com conversas/assistente/campanhas/projetos:
  isolamento, banco local, build e lint.

Na revisão, foi corrigido o preenchimento de variáveis vazias dentro de mensagens
com outros textos. Um contato sem nome agora bloqueia uma mensagem que usa
`{{nome}}` ou `{{primeiro_nome}}`, em vez de receber uma saudação incompleta.
Também foram acrescentadas verificações de interrupção após a equipe assumir,
adiar ou escrever, e após uma reunião futura ser registrada. A rota do worker
tem testes de método, segredo ausente/incorreto e caminho inválido.
Parâmetros Meta com JSON inválido agora exibem a orientação de preenchimento,
sem gravar a regra. Os testes de interface usam configuração fictícia própria,
dispensando um arquivo `.env` com acesso a um projeto.

Os testes locais não confirmam entrega pelos provedores nem o comportamento do
Supabase real. As instalações locais são artefatos de ensaio, sem credenciais.

## Preparação do aceite real

1. Criar dois projetos Supabase novos e vazios, cada um com suas próprias chaves.
   Usar núcleo em um e todos os módulos da fase 3 no outro, para operações distintas.
2. Gerar os repositórios derivados seguindo `INSTALACAO.md`. Definir configuração,
   fuso e domínio de teste em cada instalação. Fechar cadastro público do Auth.
3. Ensaiar e aplicar as migrações indicadas no README gerado, em ordem, com seus
   checks. Registrar projeto, revisão da base, resultado e data, sem segredos.
4. Publicar `equipe` e, na instalação completa, `whatsapp`, `automacoes` e
   `campanhas`. A 0024 deve estar aplicada antes dos novos webhooks.
5. Disponibilizar uma instância uazapi e um número Meta de teste, com modelo
   UTILITY aprovado para lembretes. Configurar secrets somente na instalação.
6. Configurar vigia e automações a cada cinco minutos e trabalhador de campanhas
   a cada minuto. Manter regras desligadas e assistente em modo teste inicialmente.

## Casos obrigatórios em ambiente real

| Caso | Resultado esperado |
|---|---|
| Gestor e consultor; acesso anônimo e usuário desligado | Permissões corretas; consultor não configura automações; navegador não reivindica fila |
| Núcleo sem módulos | Login, contatos, oportunidades, funil, agenda, tarefas e radar funcionam sem tabelas opcionais |
| Tarefa vencida e negócio parado | Avisos do vigia sem duplicação e filtros por responsável corretos |
| Assistente encaminha sem ação da equipe | Volta somente após o prazo configurado; respeita parada, assumir, adiar e desligamento manual |
| Registrar falta duas vezes | Uma tarefa de recuperação por reunião, com prazo de duas horas e responsável adequado |
| Agendar outra reunião futura | Recuperação concluída automaticamente |
| Regra desligada ou contato sem autorização | Nenhum envio |
| Lembrete uazapi e lembrete Meta UTILITY | Um envio por reunião/horário, com fuso, conteúdo e identificador conferidos |
| Cancelar ou remarcar após reserva | Horário antigo não envia; novo horário tem sua própria reserva |
| Follow-up após prazo na etapa | Envia uma vez por passagem; mudança de etapa, resposta, equipe ou reunião futura interrompe |
| Modelo MARKETING sem consentimento de campanhas | Não envia, mesmo com autorização de automações |
| SAIR nos dois provedores, IA desligada e webhook repetido | Bloqueia automações e revoga marketing em pedido inequívoco |
| Timeout ou resposta sem identificador | Estado incerto, aviso na Central e nenhuma repetição automática |
| Dois workers e repetição de processamento | Mesma reserva não inicia duas chamadas; limite por contato respeitado |

## Critério de encerramento

Registrar evidências dos casos acima nas duas instalações. Só então marcar a fase 3
como aceita em ambiente real e preparar a atualização do CRM em uso com backup,
ordem das migrações e funções, agendadores e acompanhamento dos primeiros envios.
O roteiro de regras e limites está em `AUTOMACOES.md`.
