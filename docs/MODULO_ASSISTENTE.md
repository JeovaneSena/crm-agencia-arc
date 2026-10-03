# Módulo assistente

Liga com `VITE_MODULOS=conversas,assistente` (exige `conversas`). Uma IA que responde o
WhatsApp, consulta serviços e horários e chama a equipe quando não sabe. **Nunca agenda
sozinha** e nunca grava nada além da própria resposta e do encaminhamento.

## Como a mensagem chega até ela
`whatsapp/index.ts` (módulo conversas) grava a mensagem e chama `aposReceber()` de
`_shared/gancho.ts`, em segundo plano (`EdgeRuntime.waitUntil`). Em instalação sem assistente
esse arquivo é vazio; o gerador troca-o por `gancho_assistente.ts`, que liga banco, modelo
(`llm.ts`) e uazapi à lógica de `assistente.ts`. Contato novo recebe `ia_ligada = true` só no
modo ao vivo (`camposDoContatoNovo`).

## As travas (todas no servidor, `assistente.ts`; a tela só mostra e grava o estado)
1. Modo `desligada` (padrão de fábrica): não responde ninguém.
2. Modo `teste`: só os números da lista, seja qual for a conversa. Lista vazia = ninguém.
3. Modo `ao_vivo`: só conversas com `ia_ligada`. Histórico e quem já falava com a equipe
   seguem desligados até alguém ligar.
4. Só texto (áudio, imagem etc. ficam para a equipe).
5. Conversa assumida por alguém da equipe (`assumido_por`): cala.
6. A equipe escreveu pelo CRM nas últimas 12 h: cala. Com a volta automática configurada (abaixo), a janela é
   o prazo do gestor em vez de 12 h.
7. Limite de respostas por conversa (`max_respostas`).
8. Uma resposta por mensagem (chave primária de `assistente_respostas`) e, numa rajada,
   só a última mensagem é respondida.
9. Quem pede para parar de receber mensagem não recebe resposta (regra única em `optout.ts`, a mesma das
   campanhas). Pedido claro ("pare de me mandar mensagem", "sair da lista", "SAIR") desliga a IA na conversa,
   revoga o consentimento de marketing (se houver o módulo campanhas) e abre um aviso na Central. Pedido
   ambíguo ("me deixa em paz", "chega", "cancelar", "não tenho interesse", "isso é spam") só desliga a IA e
   avisa a equipe, que decide. Perguntas comuns com as mesmas palavras ("tem como parar a dor?") não contam.
As travas 5 a 7 são reavaliadas ao receber, depois da espera e imediatamente antes de enviar.
Depois de `chamar_equipe` a trava "IA ligada na conversa" é dispensada só para enviar a
frase de despedida; todas as outras seguem valendo.

## Volta automática ao assistente (migração 0022)
Quando o assistente chama a equipe, ele se cala na conversa e espera. Se ninguém aparece, o cliente que escreve
de novo fica sem resposta. Em **Assistente → "Se a equipe não responder, o assistente volta a atender depois de"**
o gestor define um prazo de 5 a 1440 minutos; em branco (o padrão), nada muda e a IA só volta quando a equipe a liga.

Com prazo definido, a cada rodada do vigia (`conversas_devolver_ao_assistente`, no máximo 3 conversas por vez):
- **Volta** a conversa que o assistente encaminhou (`ia_encaminhada_motivo = 'equipe'`), com a IA desligada, sem
  dono e não adiada, **só no modo ao vivo**, e que ficou o prazo inteiro sem nenhum sinal da equipe. Sinal = o mais
  recente entre o encaminhamento, uma mensagem escrita pelo CRM e um assumir/transferir/devolver. A contagem sai do
  último sinal, não do encaminhamento: não corta no meio um atendimento em andamento.
- A IA é religada na conversa, o encaminhamento é limpo, o histórico ganha "O assistente voltou a atender" e a Central
  abre um aviso informativo (`assistente_reassumiu`) dizendo há quanto tempo ninguém respondeu e que "Eu cuido" retoma.
- Se a **última** mensagem da conversa é do cliente, é texto e tem até 24 h, o assistente a responde na hora (pelo
  mesmo caminho da mensagem recebida: todas as travas valem, inclusive o limite de respostas). Mais velha que isso,
  não: responder de repente parece engano.
- **Nunca volta**: quem pediu para parar de receber mensagem (`ia_encaminhada_motivo = 'parar'`); conversa que alguém
  assumiu; conversa que a equipe desligou à mão; conversa adiada.
- A trava 6 passa a usar o mesmo prazo, senão a conversa voltaria e a IA continuaria calada por até 12 h.
- Conversas encaminhadas **antes** desta migração têm motivo vazio e não voltam sozinhas (não dá para saber se
  foram pedido de parar). Só as encaminhadas depois dela entram.

## Rascunho para a equipe
O botão de faíscas ao lado da caixa ("Sugerir resposta com IA") pede à IA a próxima mensagem; **ela só preenche a
caixa, nunca envia**, e a pessoa lê e ajusta antes. Vale com o assistente desligado (quem pede é a equipe, olhando
a conversa), usa só as ferramentas de leitura (serviços e horários) e não chama a equipe. Só funciona com a caixa
vazia, para não apagar o que a pessoa já escreveu. Rota `POST /whatsapp/rascunho`.

## Banco (`database/base/0009_modulo_assistente.sql`)
- `assistente_config` (uma linha): modo, nome, modelo, informações do negócio (`instrucoes`),
  números de teste, limite e espera. Só se altera por `assistente_salvar_config` (gestor;
  normaliza números com o 55; teste exige número; ao vivo exige informações com 40+ letras).
- `contatos_dados.ia_ligada / ia_encaminhada_em / ia_resumo`; `conversas_lista` ganha as três.
- `assistente_respostas`: uma linha por mensagem tentada, com estado e motivo (só o gestor lê).

## Banco: volta automática (`database/base/0022_volta_ao_assistente.sql`)
- `assistente_config.devolver_apos_minutos` (vazio = nunca) e `assistente_salvar_config` com o parâmetro novo
  `p_devolver_apos` (padrão vazio; a chamada antiga de 7 argumentos continua valendo e deixa o prazo vazio).
- `contatos_dados.ia_encaminhada_motivo` (`equipe` ou `parar`), limpo por gatilho quando o encaminhamento é concluído.
- `conversa_eventos.tipo` ganha `voltou_ao_assistente`.
- `conversas_devolver_ao_assistente(limite)`: só o servidor (vigia) chama; `skip locked` impede devolver a mesma
  conversa duas vezes em rodadas simultâneas.

## Persona (política da casa)
Nunca se anuncia como IA, mas confirma em uma frase se for perguntada diretamente e nunca
nega; até 40 palavras; informal sem gíria; sem travessão, markdown, lista ou emoji. Está em
`assistente_prompt.ts` e é conferida por teste. O gestor edita só as informações do negócio.

## Segredos da função (nunca em arquivo do repositório)
`ANTHROPIC_API_KEY` (modelos `claude-…`) ou `OPENAI_API_KEY` (`gpt-…`), além dos do módulo
conversas. Sem a chave, cada tentativa aparece na tela como "erro (confira a chave do modelo)".

## Limites conhecidos
- O que a equipe responde pelo celular o CRM não enxerga (vale para a trava 6 e para a volta automática): quem
  atende pelo celular e quer a IA fora da conversa deve usar "Eu cuido", que a volta automática respeita.
- O webhook ignora o que o próprio número envia (`fromMe`). Se alguém da equipe responder
  direto no celular, a IA **não** sabe; a trava de 12 h só enxerga o que sai pelo CRM. Use
  "Assumir conversa" ou desligue o assistente na conversa antes de falar pelo celular.
- Não há fila de suporte, revisão assistida de melhorias nem token de API para agente
  externo: as telas e libs herdadas dependiam de tabelas legadas e ficaram fora da base.
  O encaminhamento daqui é simples: aviso na conversa + filtro "Equipe" na lista.
- Agendar pela IA não existe; só sugere horários livres (`agenda_horarios_disponiveis`).

## Testes
`npm run test:assistente` (lógica, sem rede) · `test:ui:assistente` (telas, API
simulada) · banco: `test:assistente:db:rehearsal` e `:apply` (projeto descartável com
0001–0007) e, para a volta automática, `test:volta:db:rehearsal` e `:apply` (0022). A volta automática também é
ensaiada localmente (`npm run test:db:local`) e coberta por `test:vigia`. Não exercitado ainda: banco real, modelo real, uazapi real.
