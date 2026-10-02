-- Select the already configured provider only while automatic attendance is off.
begin;
update public.configuracoes_agente set provedor_whatsapp='uazapi'
where not ativo and provedor_whatsapp='meta';
select provedor_whatsapp,ativo,modo_teste from public.configuracoes_agente;
commit;
