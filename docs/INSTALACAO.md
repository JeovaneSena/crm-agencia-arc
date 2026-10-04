# Instalação de um cliente

Este é o processo para uma instalação gerada pelo CRM Base. O README dentro da pasta gerada contém os comandos exatos para os módulos escolhidos.

1. **Gere o repositório do cliente** com `npm run gerar -- <pasta> --slug <slug> --nome "<nome>" --dominio <host> [--modulos <lista>]`. O destino deve ficar fora da base mestre. Confira `instalacao.json` e rode `npm run preflight` na pasta nova.
2. **Crie um Supabase vazio e exclusivo** para esse cliente. No terminal da instalação, informe `SUPABASE_PROJECT_REF` e `SUPABASE_ACCESS_TOKEN` por variáveis de ambiente, sem salvá-los em arquivos do Git. Rode as migrações na ordem indicada: ensaio (`rehearse`) e aplicação (`apply`) de cada uma. A 0001 verifica que o esquema público está vazio. O ensaio local `npm run test:db:local` não substitui essa prova no Supabase.
3. **Configure o Auth** com `npm run auth:config` e `npm run auth:aplicar`. Isso fecha o cadastro público, ajusta o domínio e a política de senha. Publique o site antes de enviar o primeiro convite, para que o link abra no domínio correto. A primeira conta criada pelo Auth após as migrações vira gestora.
4. **Publique as Edge Functions** listadas no README gerado, apontando explicitamente para o ref do cliente. A função `equipe` precisa de `APP_URL=https://<dominio>` em Edge Functions → Secrets. Conversas acrescenta o webhook e as chaves da uazapi; assistente acrescenta a chave do modelo; campanhas acrescenta as chaves da Meta, webhook e um agendador para o trabalhador da fila. Configure cada segredo no projeto do cliente, nunca no repositório. As funções validam a própria sessão, o segredo do trabalhador ou a assinatura do webhook; os comandos de publicação incluem `--no-verify-jwt` para que essas requisições cheguem ao código.
5. **Publique o frontend** com `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e `VITE_MODULOS` do cliente. A chave `service_role` não vai para variáveis `VITE_`. O `vercel.json` já cobre as rotas do app em hospedagem Vercel; em outra hospedagem, configure fallback para `index.html`.
6. **Convide e teste o gestor.** Verifique login, papéis e RLS com uma segunda conta, contatos, oportunidade, funil, agenda e módulos ligados. Para WhatsApp, Meta ou IA, teste conexão e mensagens reais antes de ativar automações. Registre a revisão da base (`base_revisao` em `instalacao.json`) junto ao resultado.

Para publicar a **base mestre** no GitHub, rode `npm run preflight`, `npm run test:db:local`, `npm run build` e `npm run lint`, confira `git status` e faça revisão dos arquivos rastreados. Mantenha o repositório como base em validação até duas instalações vazias passarem por todo o processo. Publique cada cliente em um repositório separado e sem `.env`, tokens, dumps ou dados de produção.

Para um roteiro iniciante, com pré-requisitos e contas necessárias, veja [COMECANDO.md](COMECANDO.md).

Para lembretes e follow-up, consulte [Automações](AUTOMACOES.md). Em atualizações, aplique a migração 0024 antes de publicar os novos webhooks whatsapp/campanhas. Configure o worker somente na instalação derivada.
