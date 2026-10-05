# Aceite da fase 6

Revisão de 05/10/2026. Escopo: campos e motivos editáveis (0030), modelos de nicho e
primeiro acesso guiado (0031), opção `--nicho` no gerador.

## Estado

Implementação concluída localmente. Nenhuma alteração aplicada em Supabase ou publicada
em produção. A prova de duas operações distintas foi feita em artefatos locais;
os dois projetos Supabase e o aceite real das integrações continuam pendentes.

## Evidências locais

- Preflight, TypeScript/build e lint da base.
- Ensaio/aplicação das 32 migrações em PGlite, com checks revertidos: permissões,
  tipos, zero/false, chaves desconhecidas, exigências por destino, lote atômico,
  controle de versão, campo arquivado preservado, motivo inativo, rótulos editáveis,
  modelos, estados terminais e preparação.
- Dois testes Deno das regras de preenchimento/tipo/destino, sem banco nem navegador.
- Interface com API simulada: núcleo, cadastro de campo obrigatório, motivo com
  retomada, preenchimento de contato com zero, oportunidade com “não” e data,
  registro de perda, prévia/aplicação explícita do modelo e conclusão do guia.
- Instalações em `/tmp/crm-fase6-20261005`: serviços com só núcleo (16 migrações) e
  imobiliária com todos os módulos (32). Ambas passaram em preflight, banco local,
  build e lint. Sem dados ou segredos de clientes. A geração genérica também passou em preflight e banco local (16 migrações);
  nicho desconhecido foi recusado antes de criar a pasta. Os ajustes finais das
  regras foram reconferidos após sincronizar as migrações dos artefatos.

Comandos: `npm run test:campos`, `npm run test:db:local`, `npm run test:ui:nicho`,
`npm run preflight`, `npm run build`, `npm run lint`. Os testes estão em
`0030_check.sql`, `0031_check.sql`, `scripts/testes/campos_test.ts` e `browser-check.mjs`.

## Aceite em ambiente real

1. Gerar e instalar os dois nichos em Supabase distintos, vazios e descartáveis.
   Aplicar as migrações escolhidas, incluindo a 0032 gerada, em ordem com os checks.
   Publicar apenas nas instalações isoladas. Registrar a revisão da base.
2. Exercitar gestor, consultor, inativo e anônimo nas tabelas, RPCs e rotas. Confirmar
   que equipe ativa preenche valores, mas só gestor configura e conclui preparação.
3. Criar cada tipo de campo nas duas entidades. Testar número zero, false, branco,
   data impossível, opção desconhecida, chave desconhecida, limite de texto e edição
   simultânea da mesma definição/ficha. Arquivar e confirmar preservação do histórico.
4. Exigir campos na proposta, ganho e perda; tentar atualizar pela API, arrastar,
   mover em lote e transitar pela agenda. Confirmar recusa com nome do campo, nenhum
   lote parcial e sucesso ao preencher. Captação/importação/WhatsApp devem continuar
   criando a oportunidade inicial sem exigências.
5. Renomear e arquivar motivos; registrar perdas com/sem data de retomada. Confirmar
   motivo arquivado preservado em perdas antigas e recusado em novas, e verificar
   que cancelamento de venda ganha conserva as regras de gestor.
6. Conferir modelos dos dois nichos, aplicar depois de configurar outros campos,
   comparar IDs/histórico/ordem/cores/regras. Editar rótulos pela tela e confirmar que
   outro nicho pode ser montado sem alterar o código do núcleo.
7. No primeiro acesso, seguir o guia até empresa/catálogo/horários/funil; confirmar
   recusa de conclusão incompleta. Testar consultor, guia reaberto e módulos desligados.
   Verificar que concluir não ativa IA, campanhas ou agendadores.
8. Exercitar um contato, oportunidade, reunião e venda reais de teste; confirmar
   dashboard, agenda, histórico e integrações instaladas. Registrar data e evidências
   sem segredos, antes de levar mudanças ao CRM em uso.

As limitações e contratos estão em [NICHOS_E_PREPARACAO.md](NICHOS_E_PREPARACAO.md).
A fase permanece com aceite remoto pendente até essas evidências existirem.
