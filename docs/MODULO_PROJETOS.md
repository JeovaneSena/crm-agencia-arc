# Módulo projetos

Liga com `VITE_MODULOS=projetos` (build). Entrega pós-venda: cada oportunidade **ganha**
gera exatamente um projeto, que a equipe acompanha num quadro por etapa.

## Banco (`database/base/0008_modulo_projetos.sql`)
- `projetos` — `contato_id`, `oportunidade_id` (UNIQUE: uma venda, um projeto), `nome`,
  `etapa` (`planejamento|andamento|revisao|entregue`), `prazo`, `escopo`, `responsavel_id`
  (→ `profissionais`, vira nulo se a pessoa for apagada). Apagar o contato ou a venda leva o
  projeto junto.
- Gatilho `projetos_da_venda` em `oportunidades`: ao virar `ganho`, cria o projeto
  (idempotente). Sem este módulo aplicado, ganhar uma venda não cria nada. Ao aplicar o
  módulo numa instalação com vendas já ganhas, a migração cria os projetos que faltam.
- Venda cancelada (ganho → perdido) **mantém** o projeto; a tela avisa para revisar.
- A equipe só lê e altera `nome, etapa, prazo, escopo, responsavel_id`; criar, apagar e mexer
  no vínculo é do gatilho/service_role. `updated_at` muda a cada gravação e a tela o usa como
  trava otimista (edição concorrente é recusada).
- Realtime em `projetos`.

## Tela
`/projetos` (e `/projetos?oportunidade=<id>` a partir da venda). Etapas e rótulos fixos no
código (`ETAPAS` em `src/pages/Projetos.tsx`); torná-las editáveis é possível depois, como
foi feito com `etapas_funil`.

## Testes
`npm run test:ui:projetos` (tela, API simulada) · banco: `test:projetos:db:rehearsal` e
`:apply` (exigem `SUPABASE_PROJECT_REF` e `SUPABASE_ACCESS_TOKEN` de um projeto descartável
que já tenha 0001–0006).
