# Validação de 06/10/2026

Revisão do código: `c070f2b`. Estado: implementação validada localmente,
com aceite real de Supabase, integrações e restauração pendente.

## Resultados locais

- `npm run preflight`: aprovado; isolamento da base conferido.
- `npm run build` e `npm run lint`: aprovados. O build tem avisos de tamanho
  dos bundles e de imports mistos de jsPDF; não há erro de compilação.
- `npm run test:db:local`: 40 migrações ensaiadas e aplicadas em PGlite,
  incluindo checks de permissões, Storage, auditoria, privacidade e sessão.
- `npm run test:backup`: aprovado; valida parâmetros, integridade dos arquivos,
  proteção da senha e recusa de restauração na origem ou com host incorreto.
- `npm run test:gestao`: oito testes aprovados.
- `npm run test:ui:gestao`: aprovado com APIs simuladas; login, 16 rotas,
  relatórios, distribuição, regras, proposta/PDF, papéis e desafio MFA,
  sem exceções no navegador.
- Suíte Deno em `supabase/functions/_shared`: 161 testes aprovados, zero falhas;
  inclui equipe, conversas, assistente, campanhas, automações, Meta e gestão.
  Executada com o binário Deno já disponível no cache local.

## Dependências dos testes reais

A configuração antiga da instalação de teste foi localizada fora da base mestre.
A tentativa de acesso falhou antes do login: o endereço do projeto não resolve no
DNS, enquanto o endereço da Management API do Supabase resolve normalmente.
O projeto pode ter sido excluído, segundo informação do responsável; seu estado
não foi confirmado pelo painel. Nenhuma credencial ou referência de projeto foi
copiada para a base mestre.

Para continuar o aceite real, é necessário um ambiente Supabase acessível,
credenciais de teste e números dos provedores uazapi/Meta, além de acesso ao modelo
para testar IA. Login, convites, RLS, Storage e TOTP precisam ser exercitados nessa
instalação. A restauração exige outro projeto vazio, ferramentas PostgreSQL
compatíveis e procedimento separado para Auth e configuração da plataforma.

Não houve alteração de dados remotos, publicação de site ou funções, envio real
ou restauração nesta sessão. A publicação do código no Git não encerra o aceite
real. A criação das duas instalações de homologação foi dispensada neste momento;
essa decisão não equivale à aprovação dos testes reais.
