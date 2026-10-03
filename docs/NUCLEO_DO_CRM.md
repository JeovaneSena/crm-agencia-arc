# Núcleo do CRM: etiquetas, responsável, lote, importação e linha do tempo

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

## Linha do tempo (ficha do contato)
Junta, do mais novo ao mais velho: mudanças de etapa de todas as oportunidades, reuniões, avisos da Central e a última
mensagem do cliente; com o módulo conversas, também as notas internas e as passagens de conversa (quem assumiu,
transferiu ou devolveu).

## Testes
`npm run test:lib` (regras de etiquetas, importação, anexos, adiar, respostas rápidas e linha do tempo) e os de banco
`test:etiquetas|responsavel|importar:db:rehearsal` (e `:apply` num projeto descartável).
