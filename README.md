# CRM Base

Base mestre para criar um CRM isolado por cliente. Cada instalação tem seu próprio repositório, projeto Supabase, domínio, Storage e integrações. O núcleo inclui equipe, contatos, oportunidades, funil, agenda e dashboard. Os módulos opcionais são `conversas`, `projetos`, `assistente` e `campanhas`; assistente e campanhas exigem conversas.

> **Estado:** base em validação. O código e as dez migrações passaram em ensaio local, mas ainda faltam duas instalações vazias em projetos Supabase distintos e os testes reais das integrações antes de declarar a base pronta para produção.

## Gerar uma instalação

Use Node.js 22+ e npm. Depois de clonar este repositório:

```bash
npm ci
npm run preflight
npm run gerar -- /caminho/fora/crm-base/meu-cliente --slug meu-cliente --nome "Meu Cliente" --dominio crm.exemplo.com.br --modulos conversas,assistente --fuso America/Sao_Paulo
```

Omita `--modulos` para instalar só o núcleo. As opções possíveis são `conversas`, `projetos`, `assistente` e `campanhas` (separadas por vírgula). O gerador cria um Git próprio, `instalacao.json`, `.env.example` e um README com as migrações, funções e integrações exatas daquela instalação. Ele recusa destino dentro da base, pasta preenchida e identificadores ou credenciais de clientes conhecidos.

Leia o [processo de instalação](docs/INSTALACAO.md) antes de conectar o Supabase. A [arquitetura e o estado da validação](PLANO_BASE.md) estão no plano da base. Segredos nunca entram no Git; `.env` é ignorado.

## Verificação local

```bash
npm run preflight
npm run test:db:local
npm run build
npm run lint
```

Os testes de função e de interface estão em `package.json`. Nenhum comando deste repositório publica ou aplica alterações remotas por padrão. Os scripts de banco e de Auth exigem um projeto explícito, credenciais por variável de ambiente e `--confirm` para aplicar.

As migrações 0001–0010 estão em `database/base`; o gerador copia apenas as necessárias. As migrações antigas em `legacy/migrations` são referência histórica e não devem ser aplicadas numa instalação nova.
