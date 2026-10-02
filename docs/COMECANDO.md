# Começando: do zero ao primeiro login

Este guia leva da primeira conta até o gestor entrando no CRM de um cliente. Ele resume e
organiza o que está em [INSTALACAO.md](INSTALACAO.md) e no README gerado dentro de cada
instalação, que traz os comandos exatos dos módulos escolhidos.

> **Aviso:** a base está em validação. O código e as 10 migrações passaram em ensaio local, mas
> as migrações 0008, 0009 e 0010 e as integrações (uazapi, modelo de IA, Meta) ainda não foram
> testadas em serviços reais. Faça a primeira instalação num projeto descartável.

## 1. O que você precisa antes

| Item | Para quê | Obrigatório |
|---|---|---|
| Node.js 22+, npm e Git | gerar e construir a instalação | sim |
| Conta no [Supabase](https://supabase.com) | banco, login, funções (um projeto **novo e vazio** por cliente) | sim |
| Token de acesso do Supabase (Account → Access Tokens) | aplicar migrações e configurar o Auth | sim |
| CLI do Supabase | publicar as funções | sim, se usar conversas, assistente ou campanhas |
| Hospedagem do site (ex.: Vercel) e um domínio | publicar o frontend | sim, para uso real |
| Servidor de e-mail (SMTP) | convites e recuperação de senha em volume | recomendado |
| uazapi (URL e token) | WhatsApp no módulo conversas | só com conversas |
| Chave de um modelo de IA (OpenAI ou Anthropic) | módulo assistente | só com assistente |
| Conta Meta Business com número da API oficial e modelos aprovados | módulo campanhas | só com campanhas |

## 2. Gerar a instalação

```bash
git clone https://github.com/JeovaneSena/crm-agencia-arc
cd crm-agencia-arc
npm ci
npm run preflight
npm run gerar -- ../meu-cliente --slug meu-cliente --nome "Meu Cliente" --dominio crm.exemplo.com.br --modulos conversas,assistente
```

- Escolha o destino **fora** da pasta da base. O gerador recusa pasta dentro da base ou já preenchida.
- `--modulos` aceita `conversas`, `projetos`, `assistente` e `campanhas` (assistente e campanhas exigem conversas). Sem a opção, só o núcleo é instalado.
- Entre em `../meu-cliente` e abra o `README.md` dele: é o roteiro com os comandos exatos.

## 3. Banco, Auth e funções (resumo)

Tudo com variáveis de ambiente, nunca em arquivo do Git:

```bash
export SUPABASE_PROJECT_REF=<ref do projeto novo>
export SUPABASE_ACCESS_TOKEN=<token de acesso>
```

1. **Banco:** rode as migrações na ordem do README gerado (`rehearsal` testa e reverte, `apply` grava).
2. **Auth:** `npm run auth:config` e `npm run auth:aplicar` fecham o cadastro público e ajustam domínio e senha. Cole os modelos de e-mail de `supabase/email-templates/` no painel.
3. **Funções:** publique as funções listadas no README gerado, defina `APP_URL=https://<dominio>` e os segredos de cada integração em Edge Functions → Secrets.

## 4. Site e primeiro login

1. Copie `.env.example` para `.env` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (valores públicos do projeto). **Nunca** coloque a chave `service_role` em variáveis `VITE_`.
2. `npm run build`, publique na hospedagem com as mesmas variáveis e aponte o domínio.
3. Só depois do site no ar, no painel do Supabase (Authentication → Users), convide o primeiro gestor. A **primeira conta criada após as migrações vira gestora**.
4. O gestor abre o convite, define a senha e entra. Convide uma segunda conta (consultora) e confirme que ela não vê o que é só do gestor.

## 5. Conferir

Contato, oportunidade, mudança de funil, agenda e apenas os módulos escolhidos. Para WhatsApp, IA ou Meta, teste conexão e mensagens reais antes de ativar qualquer automação. Rode `npm run preflight` de novo e registre o resultado.

## Se algo falhar

- Migração recusada na 0001: o projeto não está vazio. Use um projeto novo.
- Gerador recusou: leia a mensagem; ele bloqueia destino dentro da base, pasta preenchida e identificadores de clientes conhecidos.
- Problema que você achou na base: abra uma issue no repositório.
