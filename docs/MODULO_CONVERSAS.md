# Módulo conversas

Liga com `VITE_MODULOS=conversas` (build). Só o WhatsApp via **uazapi**; Meta oficial
fica para o módulo de campanhas. Não depende do assistente: sem ele, a equipe lê e
responde direto, e os botões "Assumir/Devolver" e o aviso "a assistente está atendendo"
não aparecem.

## Banco (`database/base/0007_modulo_conversas.sql`)
- `mensagens_whatsapp` — autor `cliente|agente|atendente`; só a função (service_role)
  escreve; a equipe lê e muda apenas `lida`. `UNIQUE(provedor,id_externo)` barra webhook
  repetido e `UNIQUE(pedido_id)` barra envio repetido.
- `contatos_dados.assumido_por/assumido_em` — quem da equipe assumiu a conversa. O módulo
  do assistente, quando existir, lê isto para parar de responder.
- `conversas_lista` (view, security_invoker) — uma linha por conversa, com não lidas e
  `proxima_reuniao`. `conversas_config` — provedor (hoje `uazapi`).
- Bucket privado `midias-whatsapp` (URL assinada); realtime em `mensagens_whatsapp`.

## Função (`supabase/functions/whatsapp`)
Rotas: webhook (`POST /`), `/enviar`, `/conexao`, `/conexao/conectar|desconectar`,
`/foto`, `/apagar-pessoa` (só gestor). Secrets: `WEBHOOK_SEGREDO`, `UAZAPI_API_URL`,
`UAZAPI_TOKEN`.

## Testes
`npm run test:conversas` (função, sem rede) · `npm run test:ui:conversas` (telas) ·
banco: `test:conversas:db:rehearsal` e `:apply` (exigem `SUPABASE_PROJECT_REF` e
`SUPABASE_ACCESS_TOKEN` de um projeto descartável).
