# Configuração por nicho

A fase 6 pertence ao núcleo. As migrações 0030–0032 acrescentam personalização e
preparação a toda instalação, sem exigir WhatsApp, assistente ou outros módulos.

## Campos personalizados

Em Configurações → Personalização, o gestor cria até 50 campos no total, de contato
ou oportunidade: texto (até 2.000 caracteres), número finito (módulo até 10¹⁵), data,
lista de até 30 opções ou sim/não. A chave técnica tem 2–40 caracteres, começa com
letra minúscula e usa letras, números e sublinhado. Ela é única na instalação.
Chave, entidade, tipo e opções permanecem fixos; para outro formato, crie outro campo.
Nome, exigências e ativação podem mudar, com controle de versão contra edição antiga.

A ficha do contato permite salvar suas informações; a oportunidade permite salvar
seus próprios campos junto com a etapa, na mesma operação. Zero e “não” são respostas
válidas. Vazio, branco e nulo não satisfazem uma exigência. Valores são validados no
banco mesmo quando enviados fora da tela. Arquivar mantém os valores antigos e remove
o campo das exigências e dos formulários; não permite alterar ou remover seu valor
arquivado por uma chamada direta. As tabelas de definição são de leitura para a equipe
ativa; somente as RPCs de gestor configuram. Os gatilhos recusam alterações dos valores
por pessoas inativas, inclusive pela tabela.

## Exigências por etapa

O gestor marca em quais destinos o campo é obrigatório, incluindo ganho e perdido.
A etapa inicial não admite exigências: recebe a oportunidade automática de contatos
vindos de formulários, importação e WhatsApp. As demais etapas, inclusive as alcançadas
pela agenda, passam pela mesma regra no banco: criação, movimento, lote ou alteração
de campos da oportunidade conferem o destino. Sem exigências, o fluxo anterior continua.

Campo do contato deve ser preenchido na ficha antes de mover; campo da oportunidade
pode ser preenchido no editor junto com a mudança. O erro identifica o nome e onde
preencher. No quadro, abra o cartão para editar; no lote, preencha cada faltante e
repita. Se um item do lote falhar, todos permanecem na etapa anterior. Uma transição
automática da agenda também pode ser recusada; preencha os campos antes de registrar
a reunião. Uma nova exigência não reescreve negócios antigos e não impede edições de
outros dados sem movimento/alteração de campos. Não há exigência retroativa de todos os
campos do contato a cada edição da ficha. Campos de venda encerrada ficam preservados.

## Motivos de perda

Até 50 motivos, configurados pelo gestor na mesma aba. As seis chaves anteriores são
preservadas e os rótulos ficam editáveis. A chave técnica não muda; arquivar conserva
os registros e impede novas perdas com esse motivo. O editor permite escolher motivo
e, se exigido, data de retomada. “Não é o momento” continua exigindo essa data por
compatibilidade. Outros motivos podem adotar a mesma regra. Cancelamento de venda ganha
continua sendo uma ação própria de gestor, com justificativa, sem novo motivo comercial.
Rótulos de eventos já gravados não são reescritos; novas perdas usam o rótulo vigente.
Relatório analítico por motivo fica na fase 7.

## Modelos e gerador

`--nicho generico|servicos|imobiliario` escolhe um vocabulário inicial. O padrão é
genérico. A migração `0032_modelo_inicial` é reservada na base e fica sem alteração de
configuração no modelo genérico. Nos outros modelos, o gerador a substitui por
uma versão com os rótulos escolhidos na derivada; ela faz parte do README e de
`instalacao.json`. O catálogo de
modelos está em `src/lib/modelosNicho.json` e na 0031. São exemplos configuráveis, sem
dados de clientes, credenciais ou preços sugeridos.

Na tela Funil ou no guia, o gestor vê os oito nomes antes de aplicar e marca a
substituição explicitamente. Também pode manter o funil atual. Modelos mudam só os
rótulos, preservando cores, ordem, histórico, campos, regras e automações. As oito
chaves do núcleo continuam fixas, incluindo as etapas de reunião vinculadas à agenda;
não criam vários funis nem etapas novas. Ajustes de ordem/cor/nome continuam na aba Funil.

```bash
npm run gerar -- /tmp/exemplo-servicos --slug exemplo-servicos --nome "Exemplo Serviços" --dominio servicos.example.test --nicho servicos
npm run gerar -- /tmp/exemplo-imobiliario --slug exemplo-imobiliario --nome "Exemplo Imobiliário" --dominio imoveis.example.test --nicho imobiliario --modulos conversas,assistente
```

## Primeiro acesso guiado

Um aviso para gestor aparece enquanto a preparação não foi concluída, com link para
`/preparacao`. O acesso ao restante do CRM continua disponível. O guia acompanha dados
da empresa, serviço ativo no catálogo, jornada ativa e confirmação do funil; oferece
links para personalização, convite da equipe e primeiro teste. WhatsApp, assistente e
Meta só aparecem quando os módulos estão instalados. Configurações mantém um link para
reabrir o guia. Consultor não acessa a rota nem conclui preparação por RPC.

Concluir registra a preparação básica depois de conferir essas quatro condições no
banco. Não ativa integração, não muda o modo da IA e não certifica publicação ou
entrega de mensagens. O gestor deve testar equipe e integrações separadamente.
Aplicar um modelo pelo gerador não confirma o funil nem conclui o guia automaticamente.

Testes: `test:campos`, `test:ui:nicho`, `test:db:local`,
`test:nicho:db:rehearsal|apply` e `test:preparacao:db:rehearsal|apply`.
Roteiro externo: [ACEITE_FASE_6.md](ACEITE_FASE_6.md).
