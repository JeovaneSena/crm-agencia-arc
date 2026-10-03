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
`/foto`, `/apagar-pessoa` (só gestor), `/vigiar` (o vigia, ver abaixo). Secrets: `WEBHOOK_SEGREDO`, `VIGIA_SEGREDO`, `UAZAPI_API_URL`,
`UAZAPI_TOKEN`.

## Testes
`npm run test:conversas` (função, sem rede) · `npm run test:ui:conversas` (telas) ·
banco: `test:conversas:db:rehearsal` e `:apply` (exigem `SUPABASE_PROJECT_REF` e
`SUPABASE_ACCESS_TOKEN` de um projeto descartável).

## Vigia (avisos na Central)
`POST /vigiar` (Authorization: `Bearer VIGIA_SEGREDO`, 24+ caracteres) confere o que não gera evento
sozinho e abre ou fecha avisos na Central (`/avisos`, migração 0011):
- **mensagem presa**: da equipe ou da IA, `pendente` há mais de 5 min. Vira `incerto` (pode ter saído:
  nunca é reenviada sozinha) e a equipe é avisada, um aviso por contato.
- **WhatsApp caído**: a conexão uazapi lida duas vezes com 10 s de intervalo; só uma queda confirmada
  abre o aviso (crítico). Com a Meta oficial como provedor, nada a vigiar.
- **assistente esquecido em modo de teste** há 3+ dias (só o gestor vê). Sem o módulo assistente, ignorado.
- a cada hora, apaga avisos resolvidos há mais de 90 dias.

Agende `node scripts/vigia-worker.mjs` a cada 5 minutos, com `SUPABASE_URL` e `VIGIA_SEGREDO` no ambiente
do agendador. Sem o agendamento esses avisos não aparecem. Testes: `npm run test:vigia` (lógica) e
`npm run test:conversas` (a rota).
