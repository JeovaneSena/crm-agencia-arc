-- Only injected inside the migration rehearsal transaction, rolled back.
insert into public.crm_clinica(nome_lead,status,valor_proposta,procedimentos_interesse)
values('ARC migration fixture','ganho',420,array['CRM personalizado','Sites e landing pages']);
