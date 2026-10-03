# Central de avisos (núcleo)

Tela `/avisos` e contador na barra lateral. É o lugar onde o sistema diz à equipe o que precisa de
gente: conexão caída, mensagem que não saiu, assistente esquecido em teste, contato que pediu para
parar. Regra de ouro: nenhum trabalhador termina num `return` mudo.

## Como funciona (`database/base/0011_central_de_avisos.sql`)
- Um aviso **aberto** por `(tipo, chave)`. O mesmo problema repetido não vira cem linhas: só aumenta
  `ocorrencias` e `ultima_em`. A gravidade (`info`, `atencao`, `critico`) sobe e nunca desce.
- Quem abre e fecha é o servidor (`aviso_abrir`, `aviso_resolver_auto`, só `service_role`). Ajudante
  pronto para as funções: `supabase/functions/_shared/avisos.ts` (nunca lança).
- A equipe lê (`avisos`, em tempo real) e **dispensa** (`aviso_dispensar`). Dispensar silencia o mesmo
  aviso por 6 horas (configurável por quem abre); depois disso, se o problema persiste, ele volta.
- `somente_gestor`: o consultor não vê o aviso (policy do banco).
- `rota` é sempre um caminho interno; qualquer outra coisa é rejeitada pelo banco e ignorada pela tela.
- `avisos_expurgar(dias)` apaga os resolvidos antigos (mínimo 30 dias); o vigia chama com 90.

## Tipos hoje
| tipo | quem abre | fecha quando |
|---|---|---|
| `mensagem_presa` | vigia | a equipe dispensa |
| `conexao_caida` | vigia | a conexão volta |
| `assistente_em_teste` | vigia | o modo deixa de ser teste |
| `tarefas_vencidas` | vigia (um por pessoa; `sem_responsavel` para as sem dono) | a pessoa zera as vencidas, ou a equipe dispensa |
| `radar_critico` | vigia (um por pessoa; `sem_responsavel` para os sem dono) | a pessoa não tem mais negócio crítico, ou a equipe dispensa |
| `pediu_para_parar` | assistente | a equipe dispensa |

Para um aviso novo: escolha o `tipo` (minúsculas e `_`), a `chave` que distingue um problema do outro
(um contato, um número) e chame `abrirAviso`. Se a causa pode sumir sozinha, chame `resolverAviso`
quando ela sumir. Quando o aviso é "um por pessoa" e o vigia olha todas de uma vez, abra os de quem tem o
problema e chame `resolverAvisosExceto(tipo, chaves)` (migração 0020): fecha o aviso de quem não está mais na lista.
