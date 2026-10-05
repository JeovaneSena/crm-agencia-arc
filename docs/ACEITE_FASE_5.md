# Aceite da fase 5

Revisão de 05/10/2026. Escopo: assistente seguro e orçamento (0027), fila de casos
opcional (0028) e revisão de melhorias opcional (0029).

## Estado

Implementação local concluída. Nenhuma migração ou função foi aplicada/publicada em
Supabase, e nenhuma mensagem foi enviada por provedor real durante este trabalho.
O aceite remoto continua pendente, em instalações isoladas da base e de clientes.

## Evidências locais

- Preflight, lint e TypeScript/build da base.
- 29 migrações ensaiadas/aplicadas em PGlite, incluindo permissões, reserva de custo,
  teto, saldo, finalização idempotente, retomada, encaminhamento com/sem fila, caso
  único, assumir/resolver, avaliação, aviso de atraso, comparação, configuração
  obsoleta, aprovação, rejeição, versões/testes imutáveis e restauração.
- 153 testes Deno da pasta compartilhada, sem rede real: inclui 31 do assistente,
  detectores, espera, orçamento, classificação de erros OpenAI/Anthropic, revisão
  comparativa e autorização da rota de melhorias. Travas foram verificadas quando
  a equipe assume ou a configuração muda antes de enviar, inclusive entre partes.
- Interface Playwright com API simulada: login e 13 rotas do núcleo, rascunho,
  encaminhamento, orçamento, recarga, assumir/resolver/avaliar caso, criar proposta,
  comparar dois textos, aprovação explícita e restauração; sem exceções no navegador.
- Instalações em `/tmp/crm-fase5-final-20261005`: núcleo (13 migrações), assistente
  (23) e completa (29) passaram em preflight, banco local, build e lint. Gancho
  financeiro e encaminhamento foram reconferidos após a integração final.
  Casos isolado e melhorias isolado passaram em preflight e banco local, com
  24 migrações cada e ganchos próprios.
  A comparação também passou pelo ensaio da rota na instalação completa gerada.

Comandos principais: `npm run test:db:local`, `npx --yes deno@2 test --allow-env
supabase/functions/_shared`, `npm run test:ui -- --assistente --casos --melhorias`,
`npm run preflight`, `npm run build` e `npm run lint`. Na verificação da interface,
o cenário de melhorias foi repetido após corrigir o contato ausente na API simulada.
Testes de SQL e detector receberam casos adicionais após o primeiro ensaio completo.

## Aceite em ambiente real

1. Gerar uma instalação com assistente e outra completa, em projetos descartáveis
   distintos. Aplicar as migrações selecionadas em ordem e seus checks. Testar
   gestor, consultor, inativo e anônimo, também usando chamadas diretas às RPCs.
2. Publicar o WhatsApp atualizado depois da 0027 e a função melhorias depois da
   0029. Configurar chaves e vigia apenas nas derivadas. Deixar modo teste e
   destinatários de teste explícitos até finalizar o aceite.
3. Pedir uma pessoa e mencionar Procon/advogado. Confirmar que não chamou modelo,
   desligou a IA, abriu aviso/caso e enviou só a confirmação fixa. Repetir webhook;
   assumir enquanto processa; conferir que não volta automaticamente.
4. Exercitar catálogo com centavos/milhares, preço não cadastrado, desconto,
   ferramentas/erros internos e promessa de equipe. Inspecionar resposta e motivo;
   revisar também exemplos que os padrões não reconhecem.
5. Configurar tarifas e teto pequeno. Testar 80%, bloqueio da próxima reserva,
   chamadas concorrentes, várias rodadas, rascunho e comparação. Conferir tokens e
   custo no provedor e no CRM; virar o mês UTC e atualizar tarifa sem mudar custo
   histórico. Testar timeout/falha de gravação com reserva conservada.
6. Simular falta de crédito/limite financeiro pela integração de teste. Confirmar
   suspensão de novas chamadas, aviso, regularização e confirmação manual. O vigia
   só retoma a última mensagem ainda elegível, com menos de 24 h; mensagem antiga,
   opt-out ou conversa assumida permanece sem resposta automática.
7. Conferir atraso proporcional e cancelamento por mensagem nova, mudança de modo
   ou atuação da equipe antes de cada parte enviada. Testar entrega real e estados
   incertos do WhatsApp, sem reenvio automático de mensagem potencialmente entregue.
8. Na fila, confirmar caso único, responsável preservado, resolução/avaliação,
   aviso após duas horas e que finalizar não religa a IA nem libera a conversa.
9. Na revisão, comparar a mesma conversa nos dois lados; confirmar nenhum envio.
   Aprovar explicitamente, testar instrução vigente no próximo atendimento,
   invalidar teste mudando configuração/versão, rejeitar e restaurar versão.
   Exercitar duas aprovações concorrentes e acesso recusado de consultor.

Registrar projeto, revisão, data e evidências sem segredos. O orçamento usa tarifas
manuais e reservas conservadoras; não é a fatura do provedor nem cobre visão/áudio.
As travas são detectores por padrões, com limites documentados no
[Assistente](MODULO_ASSISTENTE.md). “Apto” na revisão não mede ganho de qualidade;
o gestor julga o conteúdo, como descrito em [Casos e melhorias](CASOS_E_MELHORIAS.md).
