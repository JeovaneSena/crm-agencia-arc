# CRM base

Este projeto é uma base para novas instalações, isolada de `/root/arc-crm`.
Nunca use credenciais, domínio, dados, projeto Supabase ou conta WhatsApp da ARC nesta pasta.

O código herdado ainda contém regras de agência e de clínica. Até concluir a base
genérica e validar uma instalação vazia, não execute `scripts/database.mjs`,
`agente-ia/publicar.mjs`, trabalhadores de WhatsApp ou deploys a partir daqui.
`npm run preflight` confere a ausência de credenciais locais e destinos de publicação.

Cada cliente deve ter repositório derivado, projeto Supabase, chaves, domínio,
Storage e integrações próprios. Mudanças comuns voltam para esta base; dados e
customizações de um cliente não voltam.
