# Cópia de segurança e restauração

Execute somente numa instalação derivada, com recursos próprios. O comando copia
os esquemas `public` e `crm_base_private` por `pg_dump` e os binários de todos os
buckets por Storage API. Não é um backup integral da plataforma: **contas/fatores
Auth, secrets, funções publicadas, domínio, agendadores e configurações da plataforma
exigem procedimentos separados**. O destino precisa ter Supabase compatível e Auth
com os mesmos IDs antes de restaurar a aplicação; ausência de usuários faz as FKs
recusarem a restauração. Mantenha o procedimento Auth da plataforma junto ao backup.

São necessários Node.js 22+, `pg_dump`, `pg_restore`, `psql` compatíveis com a versão
do servidor e acesso aos arquivos do Storage. Use conexão direta ou pooler em modo
session; não use pooler em modo transaction. Pausar os trabalhadores e a escrita
durante a cópia é necessário para alinhar o dump com os binários. Segredos entram
no ambiente por terminal/gerenciador de segredos, nunca no Git ou frontend.

## Copiar

Configure `BACKUP_DATABASE_URL`, `BACKUP_SUPABASE_URL` e `BACKUP_SERVICE_ROLE_KEY`.
Use `read -r -s` para receber valores secretos sem gravá-los no histórico do shell.
Escolha uma pasta nova, fora de qualquer repositório:

```bash
node scripts/backup-base.mjs copiar /pasta-protegida/copia-2026-10-05
```

A pasta nasce com modo 0700 e os arquivos com 0600. A senha de banco passa ao
`pg_dump` pelo ambiente, sem aparecer nos argumentos. `manifesto.json` registra
origem sem senha, hashes SHA-256, buckets e correspondência dos objetos. Binários
usam nomes aleatórios locais, para nomes remotos não escaparem da pasta. Uma cópia
sem manifesto final é incompleta e não pode ser restaurada. Guarde-a em destino
externo protegido/encriptado conforme o procedimento da operação; os hashes
verificam integridade, não autenticidade da origem.

## Restaurar

Prepare **outro projeto**, compatível e com Auth previamente restaurado, esquemas da
aplicação vazios e Storage sem buckets. Configure `RESTORE_DATABASE_URL`,
`RESTORE_SUPABASE_URL`, `RESTORE_SERVICE_ROLE_KEY`. O primeiro comando só mostra o
plano e confere os arquivos:

```bash
node scripts/backup-base.mjs restaurar /pasta-protegida/copia-2026-10-05
```

Depois de conferir o projeto, use `--confirmar-destino` com o host exato mostrado.
O script recusa a origem e destinos preenchidos; não apaga tabelas para abrir espaço.
Banco restaura com `--single-transaction --exit-on-error` e preserva grants/RLS,
sem importar owners. Reconfigura o pre-request da sessão e recarrega a API.

O Storage é restaurado após o banco. Uma falha nessa etapa não reverte o banco;
revise ou prepare outro destino vazio antes de repetir. Não reative os trabalhadores
em um destino parcial. Confira diagnóstico, usuários e fatores Auth, campos,
relatórios, propostas/PDF, contagem e leitura dos arquivos. Republique as Edge
Functions da revisão correspondente, configure secrets e agendadores do destino e
faça o aceite real das integrações antes de reabrir a escrita.

O ensaio local usa PGlite e mocks de API; não substitui restauração real. Nesta base
não há credencial de cliente nem ferramentas PostgreSQL instaladas para uma prova
de dump/restore completo. Os testes locais conferem parâmetros, senha no ambiente,
checksums e rejeição de caminhos externos. A prova ponta a ponta é um item de aceite
em projeto descartável.

Referências: [backups Supabase](https://supabase.com/docs/guides/platform/backups),
[backup/restore com CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
e [limites de Storage na restauração](https://supabase.com/docs/guides/platform/clone-project).
