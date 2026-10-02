# Assistente comercial da ARC

A IA atende pelo WhatsApp, explica serviços, qualifica contatos, registra necessidades e agenda diagnósticos com a equipe. Catálogo, dados da agência, equipe, disponibilidade e ficha são carregados do banco.

O prompt fonte é `prompt.md`; `npm run prompt` gera `supabase/functions/_shared/prompt-oficial.ts`. `npm run agente:deploy` gera e publica. Um prompt personalizado em Configurações substitui o oficial e precisa de revisão própria.

## Como ela escreve

A camada de tom vive em `# IDENTIDADE` e `# COMO VOCÊ FALA`, no topo do `prompt.md`. Ela se perdeu na virada de clínica para agência (commit `77a70ce`), e o resultado foi um atendimento que abria toda resposta com "Ótimo, {nome}!" e se apresentava como assistente de IA na primeira frase. As decisões atuais:

- Nunca se apresenta como IA, assistente virtual, bot ou sistema. Perguntada direto, confirma em uma frase e segue a conversa. Não nega.
- No máximo 40 palavras por resposta, em 1 a 3 mensagens separadas por linha em branco. O `whatsapp/index.ts` quebra nessa linha em branco e manda até 4 mensagens de verdade, com pausa de digitação.
- Sem travessão, sem negrito, sem lista e sem numeração na resposta. Texto corrido.
- Sem abertura com "Ótimo", "Perfeito", "Entendi". Sem repetir o nome a cada resposta.
- Listas de palavras evitadas e preferidas, com frases-exemplo no tom certo. O modelo copia o exemplo quase literalmente, então só há exemplo do jeito certo.

O mesmo vale para o que o modelo lê fora do prompt: as descrições em `_shared/ferramentas.ts` também não usam travessão, senão viram contra-exemplo.

## Como inicia o atendimento

Quando o nome não está na ficha nem nas mensagens recebidas, a primeira resposta termina com "Como posso te chamar?", como única pergunta. A agente pode responder brevemente à dúvida inicial e registrar o serviço de interesse, mas pergunta sobre a operação depois da tentativa de identificação. Ao receber o nome, grava imediatamente com `atualizar_ficha` e retoma o assunto já trazido, sem pedir que a pessoa repita a necessidade.

O primeiro nome basta na abertura; nome completo só é complementado no agendamento quando necessário. Se a pessoa já se identificou, inclusive em outra mensagem da mesma sequência, a agente aproveita esse dado. Se ignorar ou recusar a pergunta, o atendimento continua sem insistência. Pedido de atendente e encerramento têm prioridade. Uma conversa em andamento não recebe nova apresentação só porque falta nome.

As instruções de abertura, os exemplos de tom e a orientação de nome ausente em `montarFicha` seguem essa mesma prioridade. Nome salvo não é prova de conversa anterior; a apresentação depende do histórico.

## Como prepara o diagnóstico

A atendente procura entender sete pontos: ramo, processo atual, ferramentas, dificuldade e impacto, resultado desejado, volume de atendimentos com período e tamanho da equipe envolvida. Escolhe uma pergunta por vez a partir da conversa, aproveita informações já fornecidas e adapta os exemplos ao serviço e ao negócio. Não há quantidade fixa de perguntas; respostas desconhecidas, recusadas ou inaplicáveis são respeitadas e registradas como pendências quando necessário.

O convite parte desse contexto. Reconhecer um serviço, explicar seu funcionamento ou responder sobre preço não exige convidar imediatamente. Hesitação é tratada pelo motivo apresentado, sem repetir automaticamente o convite. Prazo do projeto, horário da operação e volume por período não acionam a agenda.

Se o cliente pedir o diagnóstico diretamente, o agendamento tem prioridade e não depende de completar a investigação. Com a reunião marcada, a IA pode enriquecer a ficha se a conversa continuar; respeita encerramento ou preferência por falar na reunião e não oferece um novo agendamento.

Dias da semana são resolvidos pela ferramenta no fuso da agência. A IA envia `dia_semana` e repete `data_por_extenso`; não calcula a data. A disponibilidade usa a duração cadastrada para o Diagnóstico de negócio. O agendamento só é executado depois que o nome completo foi salvo na ficha, e a Agenda acompanha atualizações desse nome em tempo real.

Os sete pontos usam o `resumo` de `atualizar_ficha`, exibido como Resumo da Conversa no CRM. O texto tem até 2.000 caracteres, preserva fatos anteriores ainda válidos, estimativas e correções, indica pendências e registra próximo passo. Prazo e orçamento entram quando informados. Não foram criados campos obrigatórios nem alteradas as regras de confirmação da agenda.

Serviço identificado não fica apenas no resumo: a atendente grava imediatamente o nome canônico em `procedimentos_interesse`, preservando a lista anterior. Como garantia adicional, o interesse explícito salvo numa reunião é incorporado ao contato pelo banco. Assim, um diagnóstico marcado com interesse `CRM personalizado` também aparece em Serviços de interesse, mesmo se o modelo omitir a lista numa atualização anterior.

### Cenários para validar o atendimento

| Situação | Comportamento esperado |
|---|---|
| Primeiro contato sem nome, com saudação ou pedido de serviço | Perguntar como chamar a pessoa na primeira resposta; sem outra pergunta de qualificação. |
| Primeiro contato sem nome, com dúvida de preço | Responder brevemente à dúvida e perguntar o nome, sem perguntar sobre a operação na mesma resposta. |
| Nome informado junto da necessidade ou em outra mensagem da sequência | Gravar imediatamente e seguir o assunto, sem perguntar o nome novamente. |
| Cliente responde só o nome depois de já ter explicado a necessidade | Gravar e retomar o assunto conhecido, sem repetir a apresentação nem perguntar o que procura. |
| Nome já salvo ou dito antes no histórico | Aproveitar o dado; preencher a ficha se necessário, sem perguntar de novo. |
| Cliente ignora ou recusa informar o nome | Seguir o atendimento sem insistir e registrar a pendência. |
| Cliente pede atendimento humano sem informar nome | Encaminhar sem condicionar ao nome. |
| Pedido vago de agente para WhatsApp, após a abertura | Explorar a operação antes de sugerir reunião; uma pergunta por vez. |
| Relato detalhado já cobre os sete pontos | Aproveitar o contexto; pedir o nome na abertura se faltar, depois convidar sem repetir perguntas. |
| Volume sem período ou equipe descrita de forma ambígua | Esclarecer apenas a informação necessária, sem inferir números. |
| Cliente não sabe o volume ou prefere explicar na reunião | Registrar a pendência e seguir, sem bloquear o agendamento. |
| Pedido direto de diagnóstico | Manter a pergunta do nome na abertura se faltar; consultar horários e marcar com nome completo e confirmação das ferramentas, sem exigir os sete pontos. |
| Pergunta sobre preço ou hesitação | Responder à preocupação e continuar conforme o interesse; sem convite repetitivo. |
| Prazo de projeto ou horário de funcionamento | Registrar contexto, sem consultar agenda como se fosse pedido de reunião. |
| Reunião marcada e cliente traz mais contexto | Atualizar resumo e aprofundar uma lacuna relevante, sem novo convite. |
| Cliente encerra a conversa | Respeitar o encerramento, sem prolongar as perguntas. |
| Retomada ou correção de volume/equipe | Usar a ficha existente, preservar contexto válido e substituir a informação corrigida no resumo. |

Avaliação da revisão de abertura em 21/09/2026: 13 cenários fictícios com `gpt-4.1-mini`, montagem real do prompt e ferramentas simuladas. Na última execução, 9 cenários passaram em todos os critérios. A identificação funcionou nos primeiros contatos, mas dois cenários omitiram o registro do interesse antes do nome, um de recusa fez várias perguntas e um de conversa já iniciada pulou a identificação. O nome informado foi enviado para `atualizar_ficha` nos três cenários de identificação explícita. A checagem Deno das funções passou. Esses resultados não comprovam comportamento estável em produção. A revisão foi publicada em 21/09/2026 a pedido do usuário para um novo teste real, com os 13 arquivos publicados comparados à versão local. As pendências da avaliação continuam abertas.

Para esse novo teste, as duas conversas existentes e seu único agendamento foram removidos. Os cadastros foram preservados, com nome, resumo, empresa, e-mail, interesses e datas de atendimento limpos ou reiniciados; as oportunidades iniciais voltaram a `novo_lead`. Eventos Meta associados ao histórico também foram removidos, preservando preferências de consentimento/bloqueio. Backup privado dos dados em `arc_backup.reinicio_atendimento_20260921_qsng1u`; cópia da função anterior em `/tmp/arc-publicacao-reinicio-qSng1u/antes`.

## Regras

- Não inventar preços, prazos, integrações, contratos ou links.
- Interesses pertencem ao contato; contratação pertence a uma oportunidade.
- Um cliente pode ter várias compras e projetos. Venda anterior não prova que a necessidade atual está contratada.
- Não fechar vendas nem modificar etapas de projetos. Ganho e cancelamento comercial são decisões da equipe.
- Consultar disponibilidade antes de oferecer horário e confirmar ações somente após sucesso da ferramenta.
- Sem jornada de responsável cadastrada, não há horários para oferecer.
- A linha "Atendimento" de `informacoes_clinica_agente` é o horário comercial da agência e não manda na agenda. Quem decide horário de reunião é `ver_horarios_livres`, que lê a jornada do responsável. Os dois são cadastrados em telas diferentes e podem divergir; o prompt proíbe recusar horário com base no horário comercial.
- Com várias oportunidades abertas, não escolher uma silenciosamente. Registrar contexto e encaminhar à equipe quando necessário.
- `chamar_atendente` pausa a IA para aquele contato; não continuar a venda após transferir.

## Testes e ativação

Verificar funções com Deno, comparar prompt publicado, usar sessão real para testar a interface e manter modo teste restrito a números autorizados. Testes de banco usam rollback; testes de navegador com mocks não comprovam envio real.

O envio/recebimento real depende de instância WhatsApp conectada, webhook correto e chave do modelo válida. Não marcar essa etapa como concluída apenas porque a função foi publicada. Equipe e jornadas podem ser cadastradas depois pela interface.

As credenciais ficam em `agente-ia/.env.agente.local` e nos secrets do servidor. Não imprimir chaves nem URL de webhook que contenha segredo. O token de administração da uazapi não deve ser publicado; o token de instância é suficiente.

Arquitetura anterior e casos históricos estão em `../docs/historico/agente-ia-README.md`; referências clínicas e regras antigas ali não definem o comportamento atual.
