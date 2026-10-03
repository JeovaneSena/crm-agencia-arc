# Módulo campanhas

Liga com `VITE_MODULOS=campanhas` (exige `conversas`). Dispara **modelos aprovados da Meta**
(WhatsApp Business API oficial, categoria Marketing) para contatos do CRM. Cada envio vira uma
mensagem na conversa do contato. A base ainda **não foi testada com a Meta real**.

## Regras que o módulo impõe
- **Sem consentimento registrado, não sai.** Quem pediu para parar nunca é reativado por campanha.
  O consentimento (com a fonte) e a trilha de revogações ficam em `marketing_consentimentos` e
  `marketing_preferencias_eventos` (a trilha não pode ser editada).
- **O público é congelado antes do início.** O gestor revisa quem vai receber e o início exige o
  mesmo `revisao_hash` revisado.
- **Quem envia é a função, não o navegador.** A fila é à prova de repetição; se uma chamada falha
  depois do ponto sem volta, o envio fica como incerto e nunca é reenviado.
- **Limites** por minuto e por dia em `campanhas_controle`, mais um interruptor geral de pausa.
  A campanha também pode ser pausada automaticamente pelo sistema.

## Banco (`database/base/0010_modulo_campanhas.sql`)
Consentimento, campanhas, público congelado, fila com reserva e controle de limites. Depende da 0007.

## Função (`supabase/functions/campanhas`)
Rotas: `GET/POST /webhook` (verificação e recibos da Meta, assinados), `GET /modelos`, `GET /modelos/todos`,
`POST /modelos`, `POST /modelos/apagar` e `GET /conta` (só gestor) e `POST /processar` (o trabalhador). Secrets: `META_ACCESS_TOKEN`, `META_APP_SECRET`,
`META_VERIFY_TOKEN`, `META_PHONE_NUMBER_ID`, `META_WABA_ID`, `META_GRAPH_VERSION` (ex.: `v21.0`) e
`CAMPANHAS_WORKER_SECRET` (24+ caracteres). Webhook da Meta:
`https://<ref>.supabase.co/functions/v1/campanhas/webhook`.

## Trabalhador
Sem agendamento, a fila não envia. Agende uma vez por minuto:
`SUPABASE_URL=https://<ref>.supabase.co CAMPANHAS_WORKER_SECRET=... node scripts/campanhas-worker.mjs`.
O ritmo real é do banco; rodar mais vezes não envia mais.

## Limites conhecidos
- A tela **Modelos da Meta** (`/campanhas/modelos`, só gestor) lista todos os modelos da conta (qualquer categoria
  e estado, com o motivo quando a Meta reprova), cria (texto com variáveis `{{1}}`, exemplo por variável, rodapé
  e até 3 botões de resposta) e apaga. A aprovação é da Meta e leva de minutos a horas. Cabeçalho com mídia,
  botão de link e modelos de autenticação continuam no WhatsApp Manager. O modelo é conferido antes de ir à Meta
  (nome, variáveis em sequência, texto que não começa nem termina com variável, limites), e apagar é recusado
  enquanto uma campanha em aberto usa o modelo. **Criar e apagar ainda não foram exercitados contra a Meta real.**

## Testes
`npm run test:campanhas` (função, sem rede) · `npm run test:ui:campanhas` (telas) ·
banco: `test:campanhas:db:rehearsal` e `:apply` (exigem `SUPABASE_PROJECT_REF` e
`SUPABASE_ACCESS_TOKEN` de um projeto descartável).
