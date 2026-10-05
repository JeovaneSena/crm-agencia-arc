# Gestão e privacidade

Migrações 0033–0040. A 0036 é opcional (`propostas`); as outras fazem parte do
núcleo. Aplique as escolhidas em ordem antes do frontend e das funções atualizadas.
Nenhuma regra ou distribuição vem ativa. As telas de gestão exigem gestor.

## Relatórios

Em `/gestao`, escolha até 366 dias. O fim é exclusivo no banco; a tela inclui o dia
final inteiro em UTC. Ganhos e receita consideram vendas atualmente ganhas e a data
de encerramento; cancelamentos saem do resultado. A atribuição usa o responsável
atual, não uma fotografia de quem era responsável no encerramento. Perdas por pessoa
contam transições para Perdido; o painel de motivos reúne oportunidades atualmente
perdidas que têm evento de perda no período. Reabrir pode alterar esses números.

Conversas só são consultadas quando o módulo existe: contatos distintos com envio
humano confirmado. Primeira resposta é o primeiro envio humano após a primeira
mensagem recebida de cada contato dentro do período. Sem resposta no período não
entra na média; a tela mostra a quantidade de amostras. Enviado, entregue e lido
contam como confirmação; IA, envio pendente e incerto ficam de fora.

Na oportunidade, informe **Fechamento previsto**. Configure a probabilidade de cada
etapa aberta em Configurações → Funil. A previsão soma apenas negociações abertas
com data no intervalo e pondera valor × probabilidade / 100. Probabilidades abertas
começam em zero para a operação definir suas próprias estimativas. Negócios sem
data são contados separadamente. A estimativa não entra na receita contratada.

## Auditoria e diagnóstico

A auditoria registra operação, autor, registro, data e nomes dos campos alterados.
Não copia valores, textos de mensagens ou dados pessoais. As alterações e a auditoria
participam da mesma transação. Os papéis da aplicação não podem inserir, atualizar,
apagar ou truncar a trilha; os triggers também recusam atualização/exclusão/truncate.
Um administrador do banco ainda pode alterar o esquema: a trilha não é um arquivo
externo inviolável. A migração 0039 cobre as tabelas dos módulos instalados; novos
módulos devem acrescentar auditoria e a policy restritiva de sessão.

O diagnóstico verifica RLS, cobertura de auditoria, proteção de segundo fator,
pre-request da API, gestores ativos e filas. Checks da 0040 retiram deliberadamente
essas proteções numa transação revertida e exigem que a falha seja identificada.

## Exportação, remoção e anonimização

Na ficha, o gestor baixa JSON com o contato e seus descendentes pelas FKs públicas,
incluindo módulos instalados. O export não contém credenciais nem tabelas de
configuração. Os caminhos de mídia aparecem nas mensagens; os binários devem ser
obtidos separadamente pelo Storage. O JSON é dado pessoal e fica fora do repositório.

A exclusão remove os registros individuais em cascata. **Anonimizar histórico** faz
a mesma remoção, preservando somente ganhos, perdas e receita agregados por mês em
`resultados_anonimos`, sem contato, oportunidade, pessoa responsável ou textos.
Esses totais aparecem separadamente nos relatórios; meses parciais incluem o mês
inteiro. O histórico individual de propostas/vendas deixa de existir. A confirmação
de anonimização exige digitar `ANONIMIZAR DADOS`; a decisão de retenção é da operação.

O servidor prepara a remoção antes de apagar mídia. Recusa contatos com envios em
curso ou aguardando confirmação e bloqueia novos vínculos/reservas durante a
limpeza. Uma falha na mídia conserva a ficha bloqueada para tentar novamente.
Arquivos são removidos antes da ficha; SQL recusa a remoção enquanto ainda há
objetos no bucket. Evidências aprovadas do assistente e versões descendentes são
esvaziadas por uma autorização privada da transação; fora dela continuam imutáveis.

Auditoria conserva IDs técnicos e metadados, sem os valores removidos. Backups,
exports, cópias no provedor e informações copiadas manualmente para textos globais
não são eliminados automaticamente por essa cascata. Confira esses destinos no
procedimento da operação. Totais agregados não são uma certificação de anonimização.

## Distribuição

Em `/gestao`, selecione pessoas ativas e ative o rodízio. A fila é protegida por
lock no banco. Novas oportunidades sem responsável informado percorrem a lista;
atribuições explícitas são preservadas. Contas desligadas são ignoradas. Sem fila
ativa, vale o responsável padrão de quem criou. Não redistribui negócios existentes.

## Regras QUANDO / SE / ENTÃO

Em `/regras`, crie desativada, revise e ative. Gatilhos: criação/mudança de negócio,
tempo na etapa ou sem mensagem recebida, data prevista, etiqueta, mensagem recebida,
envio falho e reunião criada/confirmada/remarcada/cancelada/com falta/realizada.
Condições no banco combinam etapa, etiqueta e responsável em AND. Eventos sem
oportunidade não satisfazem filtros de etapa ou responsável. A confirmação de presença
fica nos detalhes da agenda; remarcação apaga a confirmação anterior.

Ações: etiqueta, responsável, mover para etapa aberta, criar negócio, tarefa,
mensagem uazapi, mensagem gerada por IA, iniciar follow-up e webhook. Até 10 ações
por regra e 100 regras. Ganho e Perdido continuam exigindo decisão e dados individuais.
Follow-up aponta uma regra já configurada em Automações e conserva suas travas,
prazos e modelos Meta. Mensagens diretas usam uazapi; não enviam texto livre fora da
janela Meta. IA exige módulo, modo autorizado, consentimento, orçamento e saída
aprovada pelos detectores existentes; não executa ferramentas nessa ação.

Cada regra executa uma vez por raiz de eventos, com até cinco níveis. As ações internas
de uma regra são atômicas; uma falha desfaz essas ações e abre aviso. Condições são
avaliadas no estado atual, na hora do processamento. A fila não retroage eventos
anteriores à migração. Desativar impede ações pendentes; não desfaz ações concluídas.
Timers são deduplicados por regra, negócio e referência; uma nova atividade permite
novo disparo. O gatilho de silêncio usa a última mensagem recebida, não uma garantia
de que uma pergunta específica foi respondida.

Publique `gestao` na instalação derivada e configure `GESTAO_SEGREDO` (24+ caracteres).
Agende `node scripts/gestao-worker.mjs` a cada 5 minutos com `SUPABASE_URL` e o segredo
no ambiente do agendador. Com conversas, mantenha também o worker de Automações.
O gerador inclui adaptadores apenas para os módulos selecionados.

Webhooks usam nomes configurados em `GESTAO_WEBHOOKS`, um JSON **somente nos secrets**,
por exemplo `{"erp":"https://erp.example.invalid/eventos"}`. Só o operador configura
destinos HTTPS públicos confiáveis, sem credenciais na URL. Não há URL livre na tela
nem redirecionamento. O corpo contém IDs técnicos; `Idempotency-Key` é o ID da saída.
O receptor deve deduplicar essa chave. Timeout após início fica incerto, sem repetição
automática; a equipe confere o provedor. Saídas sem início expiram após 24 horas.

## Propostas opcionais

Gere com `--modulos propostas` (pode combinar outros módulos). `/propostas` permite
rascunho, edição, itens, modelos de termos, validade, emissão, resultado e PDF local.
O banco calcula valores decimais, arredondando cada subtotal a centavos. A emissão
aloca contador por ano sob lock e congela cliente, empresa e conteúdo na mesma
transação. Uma emissão repetida com versão velha é recusada. Uma proposta vencida
não pode ser aceita; o worker abre aviso de vencimento. Aceitar não marca a venda
Ganho automaticamente. Emitidas não têm edição de conteúdo; crie outra versão como
nova proposta. Numeração/validade usam a data UTC do banco. PDF não é link público,
assinatura eletrônica nem rastreamento de abertura.

## Verificação em duas etapas

Toda conta ativa abre `/seguranca`: cadastra TOTP, confirma QR/código, remove o fator
com confirmação e encerra outras sessões. Segredo e QR só ficam na tela durante a
configuração. Login com fator verificado exige desafio antes de montar o CRM.
TOTP é opt-in; não se torna obrigatório para quem ainda não o cadastrou.

O banco aplica policy restritiva às tabelas e Storage. O pre-request também protege
RPCs SECURITY DEFINER. Não sobrescreve outro pre-request: uma derivada que já tenha
um precisa integrar a verificação explicitamente. Funções chamadas pelo navegador
validam usuário no Auth, fator/AAL e perfil ativo antes de usar a chave de serviço.
Trabalhadores continuam usando seus próprios segredos. A revogação de outras sessões
não invalida imediatamente tokens de acesso já emitidos. Perda do autenticador exige
recuperação administrada no Auth da instalação, nunca um bypass no frontend.

APIs usadas: [TOTP](https://supabase.com/docs/guides/auth/auth-mfa/totp),
[MFA e RLS](https://supabase.com/docs/guides/auth/auth-mfa) e
[pre-request](https://supabase.com/docs/guides/api/securing-your-api).
Referências locais revisadas: DeskcommCRM (MIT, Rafael Melgaço), `lib/audit`,
`lib/lgpd/redact-cascade.ts`, `lib/automation/conditions.ts` e testes de numeração
de propostas. Implementação adaptada à instalação única e aos contratos desta base.
