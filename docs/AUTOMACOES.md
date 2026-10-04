# Recuperação de faltas, lembretes e follow-up v1

Implementação local de 04/10/2026. Migrações 0023 (núcleo) e 0024 (conversas).
Não aplicada em Supabase real. Os envios precisam de teste de ponta a ponta nos dois provedores.

## Recuperação de falta

Marcar uma reunião como `faltou` cria uma tarefa do sistema com prazo de duas horas.
O responsável é o do negócio se estiver ativo; senão, quem registrou a falta.
Sem sessão, a tarefa pode ficar sem responsável. Registrar a mesma falta novamente não duplica a tarefa.
Não cria tarefa para um negócio encerrado, um contato já remarcado nem uma reunião inserida como histórico de falta.
Marcar outra reunião futura conclui automaticamente as tarefas abertas de recuperação daquele contato.
A tarefa aparece na lista e na ficha. Se vencer, o vigia existente avisa na Central (quando conversas estiver ativo).
Esta recuperação cria tarefa; não manda mensagem automaticamente.

## Configuração das mensagens

O gestor abre **Automações**, disponível nas instalações com conversas.

1. Registra a autorização de cada contato e sua origem. A autorização desta tela vale para lembretes e follow-up;
   ela é separada do consentimento de campanhas. Desmarcar a caixa registra o bloqueio.
2. Cria regras, todas inicialmente desligadas. Lembretes usam minutos antes do compromisso; follow-up usa minutos
   após a entrada na etapa aberta do negócio. Intervalo: 15 minutos a 7 dias. Para vários degraus, cria várias regras.
3. Escolhe WhatsApp conectado (uazapi, texto livre) ou Meta oficial (exige módulo campanhas).
4. Ativa cada regra depois de revisar. Pode desligar sem apagar o histórico.

Variáveis de texto: `{{nome}}`, `{{primeiro_nome}}`, `{{assunto}}`, `{{dia}}`, `{{hora}}`.
Datas e horas usam o fuso da empresa. Para lembretes, a referência é o início da reunião;
para follow-up, a entrada na etapa. Variável desconhecida ou valor vazio bloqueia a mensagem.

Na Meta, o envio usa sempre um modelo aprovado, inclusive dentro da janela de atendimento;
assim não depende de enviar texto livre fora da janela. Lembretes exigem categoria UTILITY.
O catálogo e a criação de modelos ficam em Campanhas → Modelos.
Parâmetros do modelo são listas por componente, por exemplo
`{"body":["{{nome}}","{{dia}}","{{hora}}"]}`. São suportados modelos de texto com parâmetros numéricos;
imagens e parâmetros nomeados não são aceitos. O texto efetivamente enviado vem do modelo da Meta.
Referência do protocolo: [coleção oficial da Meta](https://www.postman.com/meta/whatsapp-business-platform/request/lwtlz1k/send-message-template-interactive).

## Regras de interrupção e repetição

- Lembrete só sai com reunião futura agendada, no horário que gerou a fila. Cancelamento e remarcação
  invalidam a reserva antiga. Janela de tolerância: 15 minutos após o prazo; não manda lembrete atrasado.
- Follow-up só sai com negócio aberto na mesma etapa e mesma passagem. Resposta do cliente, mensagem
  escrita pela equipe no CRM, conversa assumida/adiada e reunião futura impedem o envio.
  Mensagens automáticas não contam como resposta humana. O prazo de tolerância do follow-up é 24 horas.
- Pedido de parada detectado nos webhooks dos DOIS provedores bloqueia a autorização de automações,
  mesmo sem assistente ativo e mesmo com webhook repetido. Pedido inequívoco também revoga marketing,
  quando campanhas existe. Pedido ambíguo bloqueia automações para revisão, sem revogar marketing.
- Cada regra dispara uma vez por reunião/horário ou por passagem do negócio pela etapa. Uma nova
  passagem ou remarcação é um novo evento. Regras desligadas não retomam envios já cancelados.
- Há no máximo uma mensagem por contato por rodada e um intervalo de uma hora após envio confirmado.
- Reservas são atômicas, com token e `FOR UPDATE SKIP LOCKED`. Antes do HTTP, o banco confere novamente
  a elegibilidade, o número e a configuração da regra. Mudanças durante a preparação cancelam o envio.
- Timeout, resposta sem identificador ou interrupção após iniciar a chamada viram `incerto`; não há reenvio
  automático. Falhas e incertezas aparecem no histórico e na Central. Reservas abandonadas antes de iniciar
  o HTTP podem voltar à fila; chamadas iniciadas abandonadas viram incertas após cinco minutos.

## Instalação e atualização

Aplique 0023 e seu check nas instalações com núcleo; 0024 e seu check nas que têm conversas.
Em uma instalação existente, **aplique 0024 antes de publicar as novas funções whatsapp/campanhas**,
pois os webhooks usam `automacao_bloquear`. Publique também `automacoes` com `--no-verify-jwt`;
a função verifica seu próprio segredo e aceita somente POST em `/processar`.

Configure `AUTOMACOES_SEGREDO` (24+ caracteres) nas secrets das Edge Functions.
Agende `node scripts/automacoes-worker.mjs` a cada cinco minutos, com `SUPABASE_URL` e
`AUTOMACOES_SEGREDO` no ambiente do agendador. O gerador inclui arquivos, migrações e instruções.
Sem agendamento, nada envia. Nenhum cron ou integração foi ativado na base mestre.

## Limites e aceite real pendente

- Respostas e alterações feitas somente no celular não são vistas pelo CRM. A equipe deve assumir a conversa.
- Não há sincronização transacional entre HTTP externo e banco; um evento que chega depois da conferência
  final pode coincidir com uma mensagem já em envio. Uma chamada incerta exige revisão, nunca repetição.
- A primeira versão permite criar e ligar/desligar regras; para alterar texto/prazo, desligue a antiga e crie outra.
- A seleção de autorização mostra até 500 contatos. O histórico mostra os últimos 50 envios ao abrir/recarregar.
- Follow-up v1 é uma régua de texto/modelo por etapa, sem IA. A tarefa de recuperação de falta é independente.
- Modelos MARKETING no follow-up exigem também consentimento de campanhas ativo, conferido na preparação e novamente no banco antes do envio.
- Testes locais com banco, funções simuladas, interface e instalações geradas complementam o aceite real;
  faltam dois projetos Supabase novos/vazios e números de teste uazapi/Meta. Começar com regras desligadas.
