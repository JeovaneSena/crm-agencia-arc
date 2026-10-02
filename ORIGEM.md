# Origem desta cópia

Fonte: `/root/arc-crm`, revisão Git `588de20` com alterações locais ainda não
consolidadas em 27/09/2026. A cópia contém o estado dos arquivos naquele
momento; não depende do histórico Git ou do remoto da ARC.

Foram copiados código, recursos estáticos, funções, migrações e testes. Não
foram copiados `.git`, `node_modules`, `dist`, `.env`, `.supabase-token.local`,
credenciais do agente, backups, documentação de implantação da ARC nem
configurações Nginx. As migrações históricas foram movidas para
`legacy/migrations` para evitar aplicação acidental numa instalação nova.

Esta cópia não recebe alterações automáticas da ARC. Antes de trazer melhorias
futuras, comparar o comportamento comum e remover dados/regras do cliente.
