# CRM base

Este projeto é a base mestre para novas instalações de CRM, isolada de qualquer cliente.
Nunca use credenciais, domínio, dados, projeto Supabase ou conta WhatsApp de um cliente nesta pasta.

O código herdado ainda contém regras de agência e de clínica. Até concluir a base
genérica e validar uma instalação vazia, não execute `scripts/database.mjs`,
`agente-ia/publicar.mjs`, trabalhadores de WhatsApp ou deploys a partir daqui.
`npm run preflight` confere a ausência de credenciais locais e destinos de publicação.

Cada cliente deve ter repositório derivado, projeto Supabase, chaves, domínio,
Storage e integrações próprios. Mudanças comuns voltam para esta base; dados e
customizações de um cliente não voltam.
