# Núcleo do CRM: etiquetas, responsável, lote, importação, tarefas, radar e linha do tempo

Funções que valem para qualquer instalação, com ou sem módulos.

## Etiquetas (migração 0017)
Um vocabulário da empresa para marcar contatos ("quente", "indicação"). Na ficha do contato, escrever um nome que já
existe só marca; um nome novo cria a etiqueta e marca (qualquer pessoa da equipe). **Configurações → Etiquetas**
(gestor): renomear, trocar a cor, juntar duas em uma (quem tinha a primeira passa a ter a segunda) e excluir. O nome
é único sem diferenciar caixa nem espaços repetidos; um contato leva até 20. As listas de contatos e de conversas
têm filtro por etiqueta.

## Responsável pela oportunidade e ações em lote (migração 0018)
Cada oportunidade tem um responsável: nasce com quem a criou, qualquer pessoa ativa troca, e tem que ser alguém ativo.
O quadro do CRM mostra o responsável no cartão e filtra por "Minhas", "Sem responsável" ou por pessoa.
**Selecionar várias** (até 50) permite mover de etapa ou trocar o responsável de uma vez. O lote é tudo ou nada: se
uma oportunidade já foi encerrada ou não existe, nenhuma muda. Ganho e Perdido ficam de fora do lote, porque cada um
exige valor, serviços ou motivo próprios.

## Importar planilha (migração 0019)
**Contatos → Importar planilha.** Aceita CSV (vírgula ou ponto e vírgula, com aspas e acentos); Excel e Planilhas
exportam CSV em dois cliques. O arquivo é lido no navegador, a tela mostra quantos estão prontos e **por que cada
linha ficou de fora** (sem DDD, e-mail inválido…) antes de gravar. Até 500 por vez, numa transação. Telefone que já
existe **não é alterado**. Importar **não registra consentimento de marketing**. Opcionalmente marca o lote com uma
etiqueta. Só CSV, de propósito: ler .xlsx no navegador exigiria uma biblioteca com falha de segurança conhecida.

## Tarefas (migração 0020)
O próximo passo de cada contato, com prazo e responsável ("ligar para confirmar a proposta na quinta"). Nasce na seção
**Tarefas** da ficha do contato (já ligada à pessoa) ou na tela **Tarefas** do menu. Quem cria é o responsável, se não
escolher outra pessoa; o responsável tem que estar ativo (desligar alguém deixa a tarefa "sem responsável", não a apaga).
A tela separa **Vencidas, Hoje e Próximas** (a mais urgente primeiro), filtra por **Minhas / Todas / Sem responsável** e
mantém as concluídas por uma semana, para desfazer um clique. Prazos rápidos: hoje 18h, amanhã 9h, em 3 dias, semana que
vem; "Adiar…" muda o prazo sem abrir formulário.
- Qualquer pessoa da equipe cria, edita, conclui e reabre. Apaga quem criou, o responsável ou o gestor.
- A origem (`manual` ou `sistema`) e a autoria são do banco: o navegador não escolhe. As fases seguintes (follow-up,
  falta à reunião, radar) criam tarefas "do sistema" na mesma tabela.
- Concluir passa por `tarefa_concluir`, que guarda quem concluiu e quando; a tarefa concluída entra na linha do tempo.
- **Vencida** = aberta com prazo no passado. O vigia (ver `MODULO_CONVERSAS.md`) abre um aviso por pessoa na Central e o
  fecha quando ela zera as vencidas. **Limite:** o vigia mora no módulo conversas; numa instalação só com o núcleo a tela
  Tarefas funciona, mas a Central não avisa.

## Radar de quem esfriou (migração 0021)
**Radar** no menu: os negócios abertos que ficaram parados. Um negócio sem próximo passo morre sem ninguém ver; o radar o
torna visível e a ação ao lado ("Combinar próximo passo") já cria uma tarefa ligada ao contato e ao negócio.
- **Última atividade** = o mais recente entre criação do negócio, mudança de etapa, última mensagem do contato, reunião
  marcada ou já passada e tarefa concluída.
- **Janela de esfriamento por etapa** (Configurações → Funil, coluna numérica; vazio = 48 h). "Sem resposta há 3 dias" é
  normal numa negociação e é abandono num diagnóstico. **Crítico = 3 vezes a janela.**
- **Em voo**: passou da janela mas tem próximo passo à frente — tarefa com prazo no futuro, reunião marcada ou "retomar
  em" depois de hoje. **Tarefa vencida não protege**: prazo estourado é a mesma morte, com data.
- Faixas: **Críticos**, **Em risco** (sem próximo passo) e **Em voo**; dentro de cada uma, o mais frio primeiro. Filtro
  Meus / Todos / Sem responsável, e o valor das propostas que estão esfriando.
- A regra mora no banco (`radar_negocios`), num lugar só: a tela e o vigia não discordam. O vigia abre um aviso por pessoa
  com negócios críticos e o fecha quando ela não tem mais nenhum (mesmos limites das tarefas vencidas: depende do vigia,
  que mora no módulo conversas).
- Todo contato novo nasce com uma "oportunidade inicial" (gatilho da base), então um contato que ninguém atende entra no
  radar depois de 48 h.

## Linha do tempo (ficha do contato)
Junta, do mais novo ao mais velho: mudanças de etapa de todas as oportunidades, reuniões, avisos da Central, tarefas
concluídas e a última mensagem do cliente; com o módulo conversas, também as notas internas e as passagens de conversa (quem assumiu,
transferiu ou devolveu).

## Testes
`npm run test:lib` (regras de etiquetas, importação, anexos, adiar, respostas rápidas e linha do tempo) e os de banco
`test:etiquetas|responsavel|importar|tarefas|radar:db:rehearsal` (e `:apply` num projeto descartável).

## Recuperação de faltas

A migração 0023 cria uma tarefa ao registrar uma falta e conclui a recuperação quando houver outra reunião futura. Ver [automações](AUTOMACOES.md) para regras e limites.
