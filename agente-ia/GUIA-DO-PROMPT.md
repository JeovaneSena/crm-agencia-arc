# Guia do prompt — como escrever o da sua clínica

Este guia é para quem vai **levar este sistema para outra clínica** — a sua ou a
de um cliente.

O [`prompt.md`](prompt.md) desta pasta não é um modelo em branco: é um prompt
**em produção**, de uma clínica odontológica real, com regras que só existem
porque alguma coisa deu errado antes. Leia ele junto com este guia. O que está
aqui é como escrever o seu; o que está lá é o exemplo funcionando.

> **Este arquivo é para gente.** O `prompt.md` é o contrário: tudo o que estiver
> dentro dele, o modelo lê como ordem. Nunca escreva explicação, comentário ou
> anotação lá.

---

## 1. A primeira instrução: peça para a IA escrever

**Não edite o prompt à mão, e não escreva ele num chat solto.** Abra o projeto
no Claude Code, no Codex, ou na IDE com IA que você usar, e peça a mudança em
português.

O motivo não é preguiça — é que **o prompt está acoplado ao código**. Quem
escreve precisa saber:

- quais ferramentas existem de verdade (são nove, e estão em
  [`_shared/ferramentas.ts`](../supabase/functions/_shared/ferramentas.ts));
- o que cada `{{marcador}}` vai virar quando o sistema preencher;
- por que a data e a ficha ficam **no fim** do arquivo, e não no começo;
- o que a função SQL já recusa sozinha, e portanto não precisa virar regra.

Nada disso é adivinhável. Mas está tudo escrito no repositório —
[`CLAUDE.md`](../CLAUDE.md), [`DATABASE.md`](../DATABASE.md) e o
[`README.md`](README.md) desta pasta —, e a IA lê antes de escrever.

**Um prompt vindo de um chat que não conhece este sistema chega bonito e
quebrado:** inventa ferramenta que não existe, descreve um fluxo que o código
não suporta, apaga um marcador, ou sobe a data para o topo e joga fora o
desconto de cache de todas as conversas de uma vez.

### Como pedir

Peça o **efeito**, não o texto. A IA cuida de onde a mudança encaixa.

| Ruim | Bom |
|---|---|
| "Reescreve o prompt" | "A clínica agora atende convênio. Ela precisa saber disso e perguntar qual é, na Etapa 2" |
| "Coloca uma regra de preço" | "Nunca fale valor de implante, mesmo se estiver no catálogo — esse é o único que o dentista fecha pessoalmente" |
| "Muda o tom" | "Está formal demais. Quero mais próximo, mas sem gíria" |
| "Adiciona uma ferramenta" | "Ela precisa conseguir X" — e deixe a IA dizer se dá, e o que muda no código |

E peça também o que vem junto: **regenerar, publicar e atualizar a
documentação**. É a regra 1 do [`CLAUDE.md`](../CLAUDE.md) — mudança sem
documentação não está pronta.

### A tela mostra o prompt; ela não edita

A página **Secretária de IA** tem um bloco "Ver o prompt". Ele **só lê** — busca
o texto que está publicado na Edge Function e diz qual dos dois está no ar.

Editar por ali existiu e foi removido em 01/09/2026, de propósito: o que se
escrevia na tela gravava no banco e **não ia para o Git**. No dia em que alguém
precisasse entender por que a Gabriela mudou de comportamento, não haveria
histórico nenhum — e o `prompt.md` continuaria descrevendo uma agente que não
existe mais.

O caminho é sempre o mesmo: mude o arquivo pela IA da IDE, `npm run
agente:deploy`, e teste no WhatsApp com o modo teste ligado.

---

## 2. As três camadas do arquivo

Nem toda seção do `prompt.md` tem o mesmo peso. Algumas são a sua clínica — troque
à vontade. Outras são **contrato com o código**: mudar quebra, e não aparece erro
nenhum.

### 🟢 Reescreva — é a sua clínica

| Seção | O que muda |
|---|---|
| `# IDENTIDADE` | O nome dela, o ramo do negócio, como ela se apresenta, e se assume ser IA quando perguntam |
| `# COMO VOCÊ FALA` | Tom, tamanho da resposta, palavras que evita e prefere, frases-exemplo |
| `# FLUXO DE ATENDIMENTO` | As etapas, na ordem que o negócio atende |
| `# QUANDO PASSAR PARA UMA PESSOA` | O que é urgência ou negociação **neste** negócio |
| `# PREÇO, PRAZO E PROPOSTA` | O que ela pode dizer de valor, e o que é decisão da equipe |

### 🟡 Adapte com cuidado — a regra é sua, o mecanismo não

| Seção | O que é seu | O que não é |
|---|---|---|
| `# A AGÊNCIA` | Nada, os dados vêm do banco | Os três marcadores e o texto que explica o formato do catálogo |
| `# PREÇO, PRAZO E PROPOSTA` | Se o negócio fala valor, e quais | O `preco_a_partir_de` é quem decide o que aparece no catálogo |
| `# O DIAGNÓSTICO É A PORTA DE ENTRADA` | O nome e o papel da reunião de entrada | A recusa é da função SQL. O prompt só explica o que fazer com ela |
| `# ÁUDIO, FOTO E VÍDEO` | O que ela faz com uma foto | Que ela **recebe** os três, isso é código. E `não consegui abrir esta foto` é **literal**, escrita pelo `index.ts` |
| `# REGRAS INEGOCIÁVEIS` | As regras da sua clínica | Ver o aviso abaixo |

> ⚠️ **As regras inegociáveis não são enfeite.** Quase toda linha de lá é a
> cicatriz de um teste real: ela ofereceu horário a quem já tinha consulta, ela
> prometeu o tratamento quando marcou a avaliação, ela parou de gravar a ficha e
> esqueceu o paciente. Acrescente as suas — mas antes de **apagar** uma, procure
> no [`README.md`](README.md) por que ela nasceu.

### 🔴 Não encoste — quebra em silêncio

| O que | Se mexer |
|---|---|
| Os seis `{{MARCADORES}}` | Apagou? O sistema não substitui, e o modelo lê `{{PROCEDIMENTOS}}` como se fosse o catálogo. Ela inventa procedimento. São `{{NOME_AGENTE}}`, `{{INFORMACOES_CLINICA}}`, `{{PROCEDIMENTOS}}`, `{{PROFISSIONAIS}}`, `{{DATA_HOJE}}` e `{{FICHA_DO_PACIENTE}}` |
| **`# HOJE` e `# QUEM ESTÁ FALANDO COM VOCÊ` no fim do arquivo** | Subiu? O cache de prompt reaproveita o começo igual entre as chamadas. Dado volátil no topo joga fora o desconto do texto inteiro — de todas as conversas |
| `# SUAS FERRAMENTAS` | As oito existem no código de qualquer jeito. Apagar do prompt não desliga: faz ela usar errado, ou não usar |
| Os nomes das ferramentas e dos campos | `marcar_consulta`, `interesse`, `nome_completo` — são a chamada de verdade. Nome trocado é ferramenta que não roda |

---

## 3. Os tópicos que todo prompt precisa

Estes sete. Faltando um, o buraco aparece em produção — e sempre no pior dia.

**1. Identidade e função, juntas.** Quem ela é, onde atende, e **o que ela não
faz**. A metade negativa é a que muda comportamento: não diagnostica, não decide
tratamento, não fala valor que não esteja no catálogo. A metade positiva o modelo
já chuta sozinho.

> Separar "Identidade" de "Função" em duas seções dá dois lugares para dizer a
> mesma coisa. Um dia eles discordam, e você não descobre lendo — descobre pela
> resposta estranha.

**2. Como ela fala.** Tom, tamanho, ritmo. Seja concreto: *"máximo de 50
palavras, em 2 ou 3 mensagens curtas"* funciona; *"seja objetiva"* não quer dizer
nada. Liste as palavras que ela **evita** e as que **prefere** — é o que mais
rápido tira o cheiro de robô.

**3. A clínica.** Não escreva os dados aqui. Eles vêm do banco pelos marcadores e
mudam quando a equipe edita a tela — sem deploy, sem tocar no prompt. O que você
escreve nesta seção é só **como ler** o que vai chegar.

**4. O fluxo de atendimento.** O mais importante, e o que menos se escreve do
zero: copie o que está no `prompt.md` e troque as etapas. Duas coisas que todo
fluxo precisa dizer, e quase nenhum diz:

- **"se o paciente já respondeu uma etapa, pule ela"** — sem isso ela pergunta o
  nome três vezes;
- o que fazer quando a pessoa **não** segue o roteiro.

**5. Regras inegociáveis.** Curtas, uma por linha, começando por "Nunca". E toda
proibição precisa dizer **o que fazer no lugar** — "nunca dê diagnóstico" sozinho
deixa a IA muda na frente de uma foto.

**6. Quando passar para uma pessoa.** Dor forte, trauma, sangramento, reclamação,
pedido explícito. Sem isso ela tenta agendar avaliação para quem está com o rosto
inchado às onze da noite.

**7. O que fazer com áudio, foto e vídeo.** O paciente brasileiro manda áudio na
primeira mensagem e foto na terceira. O sistema entrega os dois; se o prompt não
disser o que fazer, ela improvisa — e improvisar na frente de uma foto de boca é
como se dá diagnóstico sem querer.

> ⚠️ **Ela NÃO vê a foto — ela lê uma descrição.** Um modelo de visão olha a
> imagem antes e escreve uma linha; é essa linha que chega até ela, do mesmo
> jeito que o áudio chega transcrito. Um prompt que promete "você consegue ver
> a imagem" faz ela falar como quem viu, e transforma qualquer falha em
> encenação: ela acolhe a dor, imagina o incômodo e recusa o diagnóstico de uma
> foto que nunca chegou. Aconteceu, e não foi alucinação — foi o roteiro sendo
> seguido à risca sobre um dado ausente.
>
> A frase abaixo é escrita pelo código, e o prompt precisa reconhecê-la **por
> essas palavras**:
>
> | A descrição começa com | O que ela faz |
> |---|---|
> | `não consegui abrir esta foto` | Não recebeu nada. Não inventa o que havia na imagem, e pede para mandar de novo |

---

## 4. Como escrever cada linha

O formato não é estilo. É o que o modelo obedece.

**Uma ordem por linha, com `-` na frente, no imperativo.** Parágrafo o modelo
resume, e o resumo dele de seis frases é "seja gentil". Linha curta ele executa.

```
❌  É importante que a Gabriela sempre confira a disponibilidade antes de
    confirmar qualquer horário com o paciente, pois ela não tem acesso direto
    à agenda e pode acabar confirmando algo que já está ocupado.

✅  -   Nunca confirme um horário sem ter usado `ver_horarios_livres`.
```

**Negrito no que não pode passar.** Poucas palavras por seção — negrito em tudo é
negrito em nada.

**Exemplo literal onde o tom importa.** Uma frase pronta entre aspas ensina mais
rápido que três linhas descrevendo o tom. Mas cuidado: o modelo copia o exemplo
quase palavra por palavra. Escreva o exemplo como você quer ouvir.

**Detalhe pequeno vira regra própria.** Coisas como *"nunca use travessão"* ou
*"nunca repita o nome do paciente"* parecem mesquinhas escritas assim. São elas
que entregam o atendimento automático.

**Regra colada no dado pesa mais.** Se uma regra depende de uma informação, repita
ela **junto** da informação, no fim do arquivo — não só na seção de regras, dez
telas acima. Parece redundância e não é: neste projeto a agente ofereceu
agendamento a quem tinha consulta no dia seguinte, com o dado na frente dela, e
só parou quando a ordem foi colada no dado.

---

## 5. Depois de editar

```bash
npm run agente:deploy   # regera o prompt E publica a função
```

> Um comando só: o `agente:deploy` já roda o `npm run prompt` antes. Rodar os
> dois não faz mal — só é redundante.

Não pulou nenhum passo? Então:

1. Ligue o **modo teste** e ponha o seu número na lista, na página Secretária de
   IA. Sem isso, o primeiro teste responde a paciente de verdade.
2. Converse com ela pelo WhatsApp como um paciente conversaria — inclusive
   torto: mandando áudio, mudando de ideia, perguntando preço três vezes.
3. Leia a conversa na tela **Conversas**, do lado da equipe.

> **Nenhum prompt nasce pronto.** Este aqui foi para produção parecendo ótimo, e
> o primeiro teste real derrubou seis coisas em uma tarde. Reserve os primeiros
> dias para ajustar — é trabalho previsto, não sinal de que deu errado.

---

## 6. O que este guia não repete

De propósito:

| Onde | O que está lá |
|---|---|
| [`prompt.md`](prompt.md) | O prompt inteiro, funcionando. É o exemplo |
| [`README.md`](README.md) § Como ela escreve | As decisões de tom, e por que a camada de tom precisou ser reescrita |
| [`_shared/ferramentas.ts`](../supabase/functions/_shared/ferramentas.ts) | As nove ferramentas, uma a uma, como o modelo as recebe |
| [`DATABASE.md`](../DATABASE.md) § 8 | Tudo o que o agente lê e grava no banco |
| [`CLAUDE.md`](../CLAUDE.md) | As regras do projeto inteiro |

Se uma regra estiver escrita aqui **e** lá, um dia as duas discordam. Este guia
ensina a escrever; os outros contam o que já está escrito.
