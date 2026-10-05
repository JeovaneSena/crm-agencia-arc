# CRM Base

Base mestre para criar um CRM isolado por cliente. Cada instalação tem seu próprio repositório, projeto Supabase, domínio, Storage e integrações. O núcleo inclui equipe, contatos, oportunidades, funil, agenda e dashboard. Os módulos opcionais são `conversas`, `projetos`, `assistente`, `campanhas` e `captacao`; assistente e campanhas exigem conversas.

> **Estado:** base em validação. O código e as migrações passaram em ensaio local, mas ainda faltam duas instalações vazias em projetos Supabase distintos e os testes reais das integrações antes de declarar a base pronta para produção.

## Gerar uma instalação

Pré-requisitos (detalhes em [docs/COMECANDO.md](docs/COMECANDO.md)): Node.js 22+, npm, Git e uma conta no Supabase. Para publicar o site, uma hospedagem e um domínio; para WhatsApp, IA e campanhas, as contas de cada integração.

Você pode usar o botão **Use this template** do GitHub, mas ele só copia os arquivos da base. A instalação de um cliente é sempre gerada pelo comando abaixo.

Use Node.js 22+ e npm. Depois de clonar este repositório:

```bash
npm ci
npm run preflight
npm run gerar -- /caminho/fora/crm-base/meu-cliente --slug meu-cliente --nome "Meu Cliente" --dominio crm.exemplo.com.br --modulos conversas,assistente --fuso America/Sao_Paulo
```

Omita `--modulos` para instalar só o núcleo. As opções possíveis são `conversas`, `projetos`, `assistente`, `campanhas` e `captacao` (separadas por vírgula). O gerador cria um Git próprio, `instalacao.json`, `.env.example` e um README com as migrações, funções e integrações exatas daquela instalação. Ele recusa destino dentro da base, pasta preenchida e identificadores ou credenciais de clientes conhecidos.

Para o caminho completo, do zero até o primeiro login, siga o [passo a passo para começar](docs/COMECANDO.md). Leia também o [processo de instalação](docs/INSTALACAO.md) antes de conectar o Supabase. A [arquitetura e o estado da validação](PLANO_BASE.md) estão no plano da base. Segredos nunca entram no Git; `.env` é ignorado.

## Verificação local

```bash
npm run preflight
npm run test:db:local
npm run build
npm run lint
```

Os testes de função e de interface estão em `package.json`. Nenhum comando deste repositório publica ou aplica alterações remotas por padrão. Os scripts de banco e de Auth exigem um projeto explícito, credenciais por variável de ambiente e `--confirm` para aplicar.

As migrações 0001–0026 estão em `database/base`; o gerador copia apenas as necessárias. Use sempre as migrações de `database/base`; migrações de outras origens não fazem parte deste repositório e não devem ser aplicadas numa instalação nova.

## Módulos

[Conversas](docs/MODULO_CONVERSAS.md) · [Projetos](docs/MODULO_PROJETOS.md) · [Assistente](docs/MODULO_ASSISTENTE.md) · [Campanhas](docs/MODULO_CAMPANHAS.md) · [Captação e origens](docs/MODULO_CAPTACAO.md)

## Licença

[MIT](LICENSE). O software é entregue como está, sem garantia, e a base ainda está em validação.
