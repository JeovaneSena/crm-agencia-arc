# Aceite da fase 4

Revisão de 05/10/2026. Escopo: formulários (0025), referências de landing pages,
origem de clique para WhatsApp Meta e relatório por origem (0026).

## Estado

Implementação local concluída e verificada. Não foi publicada em produção nem
aplicada em um projeto Supabase. O aceite real depende dos ambientes de teste
registrados como pendentes no aceite da fase 3.

## Evidências locais

- Preflight, TypeScript/build e lint da base.
- Ensaio/aplicação PGlite das 26 migrações, com checks revertidos: fontes,
  segredos, repetição, contatos existentes, limite, primeira origem, permissões,
  desligamento e exclusão. Relatório prova que dois negócios geram um lead e
  dois ganhos, sem duplicar os valores.
- 57 testes Deno aprovados: 56 da captação/gancho/campanhas/conversas/protocolo
  Meta, mais um ensaio dos dois webhooks da instalação completa gerada com
  banco simulado. Esse ensaio inclui assinatura Meta, código de referência,
  referral e reenvio. Ele não prova entrega ou comportamento do banco remoto.
- `npm run test:ui:captacao`: 13 rotas do núcleo e login, recebimentos, filtro,
  segredo/hash, ativação, renovação, primeira origem, edição de referência,
  consulta do relatório e acesso de consultor; sem exceções no navegador.
- Instalações geradas em `/tmp/crm-fase4-20261005`: núcleo (13 migrações),
  captação sem WhatsApp (15) e todos os módulos (26). As três passaram em
  preflight, banco local, build e lint. Gancho de origem aplicado somente onde
  captação foi escolhida. Artefatos sem credenciais e sem dados de clientes.

Os testes SQL estão em `0025_check.sql` e `0026_check.sql`; funções em
`captacao_test.ts`, `origem_integracao_test.ts`, `campanhas_test.ts` e
`conversas_test.ts`; interface em `scripts/browser-check.mjs --captacao`.
O ensaio de webhooks gerados está em `scripts/testes/captacao_webhooks_test.ts`.
Na base, execute `CRM_TEST_INSTALACAO=/caminho/absoluto/instalacao-completa npm run test:captacao:webhooks`.
O caminho deve ser um artefato de ensaio com captação/conversas/assistente/campanhas;
as requisições são simuladas e não usam credenciais reais.

## Aceite em ambiente real

1. Gerar instalações isoladas com captação e com todos os módulos. Aplicar as
   migrações em ordem com os checks. Conferir gestor, consultor, inativo e anônimo.
2. Publicar captação e os webhooks atualizados somente depois de 0025/0026.
3. Configurar o servidor de um site de teste. Exercitar fonte desligada, segredo
   incorreto, primeiro envio, reenvio com mesmo ID, telefone já existente,
   renovação de segredo, campos recusados e limite.
4. Enviar pelo WhatsApp a mensagem da landing page com referência válida,
   removida, desconhecida e desligada. Contato antigo não recebe nova atribuição.
5. Testar um anúncio/publicação Meta com referral real e um sem referral. Conferir
   conta/número, assinatura, IDs na ficha, repetição e opt-out.
6. Comparar relatório com contatos e oportunidades: dois negócios de um contato,
   ganhos/perdas, fontes sem UTM, sem origem, limites de data e exclusão.
7. Exercitar dois envios concorrentes do mesmo telefone, inclusive de fontes
   distintas. Confirmar um contato, uma oportunidade inicial e uma origem.

Registrar revisão, projeto, data e evidências sem segredos. Só após esse aceite,
preparar atualização do CRM em uso com backup e acompanhamento. O relatório
mostra propostas ganhas por coorte de contatos; não mede pagamentos, gastos ou
ROAS. O contrato da integração está em [MODULO_CAPTACAO.md](MODULO_CAPTACAO.md).
