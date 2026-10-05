# Aceite da fase 7

Revisão de 05/10/2026. Escopo: gestão e conformidade técnica, migrações 0033–0040,
propostas opcionais, regras, distribuição, operação e TOTP.

## Estado

Implementação concluída e validada localmente. Nenhuma migração, função, agendamento
ou mensagem aplicada a um cliente ou à produção. Aceite Supabase, integrações e
restauração real continuam pendentes. Não declara a base pronta para publicação.

Contratos: [Gestão e privacidade](GESTAO_E_PRIVACIDADE.md) e
[cópia/restauração](OPERACAO_FASE_7.md).

## Evidências locais

- Preflight, TypeScript/build, lint e `git diff --check`.
- 40 migrações ensaiadas/aplicadas em PGlite com fixtures revertidas. Checks novos
  cobrem relatório por papel, previsão ponderada, perda e confirmação de resposta;
  auditoria sem valores pessoais e imutabilidade; export isolado; cascata, versões
  de evidência e agregação; propostas decimais, numeração, snapshot e emissão única;
  rodízio sem sobrescrever atribuição; regras sem ciclo, limites de timers separados,
  reserva/início únicos, chamada vencida incerta, bloqueio durante remoção; AAL1/AAL2
  e diagnóstico que identifica proteções deliberadamente retiradas.
- 161 testes Deno compartilhados passaram, incluindo oito novos do motor de saídas,
  autorização, timeout, erro de persistência, destinos e MFA.
- Navegador com API simulada: 16 rotas do núcleo e fluxos anteriores, relatórios,
  distribuição, regra criada desativada/ativação, proposta emitida/PDF, bloqueio de
  consultor e desafio TOTP antes de montar o CRM.
- Testes Node da cópia: parâmetros, SSL, senha fora dos argumentos, checksum e
  rejeição de caminhos fora da pasta. Não há prova de `pg_dump`/`pg_restore` real
  neste ambiente; os binários e credenciais de uma instalação não estão presentes.
- Duas instalações em `/tmp/crm-fase7-validacao`: serviços só núcleo (23 migrações)
  e imobiliária com todos os módulos, incluindo propostas (40). Preflight, banco,
  build e lint passaram. São artefatos de teste sem dados ou credenciais de cliente;
  o manifesto registra alterações locais quando o gerador usa uma árvore modificada.

Comandos: `npm run test:db:local`, `npm run test:gestao`, `npm run test:backup`,
`npm run test:ui:gestao`, `npx --yes deno@2 test --allow-env supabase/functions/_shared`,
`npm run preflight`, `npm run build`, `npm run lint`.

## Aceite em projetos descartáveis

1. Instalar os dois nichos em Supabase distintos, vazios e exclusivos. Conferir
   `instalacao.json`, aplicar somente as migrações selecionadas, em ordem, com checks.
   Registrar revisão da base e confirmar os adaptadores de conversas/assistente.
2. Exercitar gestor, consultor, conta inativa e anônimo, também por API direta.
   Consultor não configura nem lê gestão, auditoria ou export pessoal. Testar AAL1
   com TOTP verificado em tabelas, RPCs, Storage e todas as funções de navegador.
   AAL2 libera apenas o papel já existente; não eleva consultor a gestor.
3. Conferir relatórios com mensagens enviadas/entregues/lidas, sem resposta, envio
   incerto, vendas canceladas e perdas reabertas. Verificar limites UTC e mudança
   de responsável atual; comparar amostras, valores, probabilidades e datas.
4. Criar alterações nos módulos instalados e conferir auditoria sem valores pessoais.
   Recusar UPDATE/DELETE/TRUNCATE por authenticated e service_role. Confirmar o
   diagnóstico e o pre-request após reconexão/reload do PostgREST.
5. Exportar contato com conversa, mídia, notas, reuniões, projetos, propostas,
   consentimentos, filas, origem e evidências do assistente. Anonimizar com confirmação
   e verificar todos os vínculos/Storage, versões descendentes e totais mensais.
   Simular falha de Storage e corrida com envio para provar bloqueio/retomada.
   Conferir tratamento separado de cópias, backups e dados dos provedores.
6. Emitir duas propostas simultâneas e exigir números distintos. Repetir emissão
   com versão velha, tentar editar emitida, aceitar vencida, baixar PDF longo e
   conferir que conteúdo/total/cliente correspondem ao snapshot. Aceitar não deve
   fechar oportunidade. Confirmar aviso de vencimento pelo trabalhador.
7. Inserir oportunidades simultâneas para provar rodízio sob lock; testar fila
   desativada/vazia, conta desligada, atribuição explícita e oportunidade existente.
8. Com todos os workers configurados, exercitar cada gatilho e ação, inclusive
   confirmação/remarcação da agenda, condições falsas, regra desativada, ciclo e
   timers de durações distintas. Revogar autorização entre reserva e início, simular
   timeout/reinício e verificar ausência de envio duplicado. Webhooks precisam
   receptor de teste que deduplique `Idempotency-Key`.
9. IA primeiro em modo de teste, com orçamento e tarifas: validar opt-out, passagem
   humana, saldo, texto vazio/inseguro e limite de consumo. Meta usa o caminho de
   modelos/follow-up já validado, sem texto livre pela ação uazapi.
10. Provar cópia e restauração em outro projeto, incluindo procedimento Auth separado,
    IDs preservados, TOTP, grants/RLS, Storage, scripts e secrets. Exigir diagnóstico
    e contagens iguais antes de reativar workers. Conferir recuperação administrada
    por perda de autenticador e a expiração dos tokens de outras sessões.

Somente após registrar essas evidências a base pode avançar para publicação e
adoção em instalações reais. Funcionalidades seguintes seguem o roteiro do plano;
não foram acionadas nesta fase.
