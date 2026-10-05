# Casos e revisão do assistente

São opcionais do gerador: `--modulos conversas,assistente,casos,melhorias`. Pode escolher
só casos ou só melhorias, sempre com conversas e assistente. Sem esses módulos, o gancho
não consulta suas tabelas. Reimplementação genérica das referências legadas 0035/0036;
use apenas as novas migrações 0028/0029, nunca o SQL legado.

## Casos (0028)

O encaminhamento do assistente abre um caso com contato, motivo e resumo. Há no máximo
um caso aberto por contato; novos encaminhamentos atualizam seu contexto sem trocar
quem assumiu. Todo encaminhamento com fila instalada fica protegido contra volta
automática à IA. A tela mostra contexto, link para a conversa, responsável e estado.

A equipe ativa pode assumir o caso (e a conversa), registrar a solução e avaliar se o
encaminhamento era necessário ou desnecessário. Só responsável ou gestor finaliza.
Finalizar fecha o aviso de atraso; não religa a IA nem devolve a conversa. O vigia abre
um aviso para casos abertos há mais de duas horas. Não há notificações externas novas.

Testes: `test:casos:db:rehearsal`, `:apply`, `test:ui:casos` e `test:db:local`.

## Melhorias (0029)

Só o gestor acessa a revisão. Ele escolhe um contato como evidência, descreve o problema
e propõe instruções complementares. Uma proposta não altera a configuração ativa.
A comparação usa o mesmo recorte de histórico (até 20 mensagens) para gerar dois
rascunhos: instrução vigente e candidata. Consulta serviços/horários; não envia mensagens,
não agenda e não oferece ferramentas de escrita. As duas chamadas consomem orçamento.

A função `melhorias` valida a sessão e o papel, executa a comparação e registra o teste
no servidor. O navegador não grava resultados nem aprova sozinho. “Apto” significa que
a candidata passou pelas travas técnicas; o gestor ainda compara o conteúdo e decide.
Um replay não comprova melhora geral de qualidade, e não há treinamento automático.

A aprovação explícita exige teste apto da mesma proposta, com até sete dias, e mesma
configuração/versão ativa. Se a configuração ou versão mudar, compare novamente.
Versões e testes são imutáveis. Para mudar uma proposta, crie outra; é possível rejeitar
uma proposta ainda não aprovada. A restauração preserva o histórico criando uma nova
versão e exige que a versão atual continue sendo a que o gestor está vendo.
As instruções aprovadas complementam a configuração do assistente nos atendimentos.

Publique a função somente numa instalação isolada, depois da 0029, com os mesmos
segredos de banco/modelo do assistente. O README gerado contém o comando exato.
Testes: `test:melhorias:db:rehearsal`, `:apply`, `test:melhorias:rota`,
`test:seguranca:ia`, `test:ui:melhorias` e `test:db:local`.
