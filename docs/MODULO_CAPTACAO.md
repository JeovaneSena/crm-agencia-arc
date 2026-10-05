# Captação e origem dos contatos — fase 4

Implementação local de 05/10/2026. O módulo opcional `captacao` reúne formulários,
códigos de landing pages e o relatório por origem. Funciona com o núcleo;
referências do WhatsApp exigem `conversas`, e anúncios da Meta exigem `campanhas`.
Esses módulos continuam opcionais e cada instalação conserva suas próprias chaves.

## Formulários

Em **Leads recebidos**, o gestor cria uma fonte. Ela nasce desligada. O segredo
aparece na sessão de criação/renovação; o banco guarda apenas SHA-256 e o
navegador não pode ler o hash. Guarde o segredo somente no servidor do site.
Renovar invalida o anterior. Configure o envio, revise e então ative a fonte.

O servidor do site envia POST para o endereço exibido:

```text
https://<ref>.supabase.co/functions/v1/captacao/receber/<uuid-da-fonte>
Content-Type: application/json
X-Captacao-Segredo: <segredo-da-fonte>
```

```json
{
  "id_externo": "envio-unico-001",
  "nome": "Ana",
  "whatsapp": "5511999999999",
  "email": "ana@example.invalid",
  "empresa": "Exemplo",
  "utm_source": "google",
  "utm_medium": "cpc",
  "utm_campaign": "outubro",
  "utm_content": "anuncio-a",
  "utm_term": "servico"
}
```

Também aceita `application/x-www-form-urlencoded`, campos planos. Telefone é
obrigatório; nomes alternativos: telefone, phone, celular e tel. Telefones
brasileiros com DDD e 10/11 dígitos recebem 55. Nesta versão de formulários, o
telefone normalizado deve ter 12–15 dígitos; números internacionais mais curtos
não são aceitos. Email, nome e empresa são opcionais. Campos desconhecidos,
autorizações e dados adicionais são descartados. A captação não concede
consentimento para campanhas ou automações.

Use um `id_externo` único de até 120 caracteres por envio e mantenha o mesmo em
reenvios. Retorna `criado`, `existente` ou `recusado`, com `repetido`. Não retorna
nome, telefone ou ID do contato ao site. Sem ID de evento, o telefone ainda
impede duplicar o contato, mas cada recebimento ganha um registro.

HTTP: 200 aceito/repetido, 422 campos recusados, 401 fonte desligada/segredo
incorreto, 429 limite de 120 recebimentos por fonte/minuto, 413 corpo acima de
16 KB, 415 tipo não suportado, 503 falha de registro. Em 503, reenvie com o mesmo
ID; em 429, aguarde um minuto. Erros de estrutura JSON/tipo/corpo não são
registrados como recebimentos. Recusas de campos geram aviso na Central.

## Landing page para WhatsApp

Abra **Origem da landing page** da fonte, escolha um código único de 3–64
caracteres (letras, números, hífen e sublinhado) e as cinco UTMs. Salve e ative.
O código é público; o segredo dos formulários continua no servidor.

Inclua o código na mensagem predefinida do botão da landing page:

```text
Olá! Quero saber mais. [ref:landing-outubro]
```

Exemplo de link, substituindo o número pelo da instalação:

```text
https://wa.me/5511999999999?text=Ol%C3%A1%21%20Quero%20saber%20mais.%20%5Bref%3Alanding-outubro%5D
```

O contato precisa enviar essa mensagem. Se remover o código, ou a fonte estiver
desligada, o contato entra sem origem. A atribuição usa as UTMs configuradas na
fonte no momento do primeiro recebimento. Mudanças posteriores não alteram as
atribuições existentes. O código sinaliza origem; não prova que houve clique e
não é uma credencial.

## Anúncios da Meta que abrem WhatsApp

O webhook assinado da Meta encaminha `messages[].referral`. Somente a conta e o
número configurados são aceitos. Guarda `source_type` (ad/post), `source_id` e,
quando presente e válido, `ctwa_clid`. Não armazena corpo do anúncio, mídia ou
URLs externas. Origem Meta tem precedência sobre um `[ref:]` na mesma mensagem.
Sem referral, não inventa atribuição. O ID do anúncio aparece na ficha e na
coluna conteúdo do relatório; nomes, gasto, ROAS e Conversions API ficam fora
desta fase. Contrato consultado: [documentação da Meta no Postman](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api).

## Primeira origem e relatório

A ficha mostra a primeira origem. A criação do contato e a atribuição ocorrem
na mesma transação com trava por telefone. Reenvios e entradas de outra fonte
não duplicam o contato nem substituem seus dados/origem. Contatos que já
existiam continuam sem atribuição nova, inclusive se a primeira mensagem não
tinha código. O novo contato cria a oportunidade inicial pelo núcleo.

**Relatório por origem** agrupa canal, fonte, UTM source, campanha e conteúdo.
Escolha até 366 dias. O período é a data de criação dos contatos, com início
inclusivo e fim exclusivo no banco; a tela inclui o último dia e usa o fuso do
navegador. Leads são contatos distintos; ganhos são a quantidade atual de
negócios ganhos desses contatos e valores são propostas ganhas, não pagamentos.
Uma pessoa com dois negócios gera um lead e dois ganhos. Inclui **Sem origem
registrada**; formulários de contatos existentes não contam como leads novos.

Equipe ativa pode consultar; somente gestor configura fontes e referências.
Usuários desligados e acesso anônimo não leem os dados. Apenas service_role
pode receber formulários e registrar origem via WhatsApp. Excluir o contato
remove atribuições e recebimentos associados por cascata.

## Instalação e aceite

Gere uma instalação com `--modulos captacao` ou
`--modulos captacao,conversas,assistente,campanhas,projetos`. Aplique 0025 e 0026
com seus checks antes de publicar os novos webhooks. Publique `captacao` com
`--no-verify-jwt`; a função exige o segredo da fonte. O gerador liga o gancho de
origem apenas quando captação foi selecionada. Sem esse módulo, conversas e
campanhas não consultam tabelas de captação.

Verificações locais: preflight, build, lint, ensaio PGlite, testes Deno da
captação/webhooks, telas com APIs simuladas e instalações geradas (núcleo,
captação isolada e todos os módulos). Evidências em `ACEITE_FASE_4.md`.

O aceite em Supabase e tráfego real continuam pendentes. No ambiente descartável,
prove: fonte desligada/ligada, segredo inválido/renovado, envio/reenvio, contato
existente, referência válida/removida/desligada, referral assinado Meta,
consultor/gestor/inativo, relatório com dois negócios por contato, exclusão e
corrida entre dois envios. Registre revisão, projeto, data e resultados sem
segredos antes de preparar a atualização de um CRM em uso.
