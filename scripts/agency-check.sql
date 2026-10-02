do $$ declare v_lead uuid; v_meeting uuid; v_status text; v_count int; begin
 insert into public.crm_clinica(nome_lead,empresa,email,valor_proposta,status,inicio_atendimento,procedimentos_interesse)
 values ('ARC Migration Test','Empresa de teste','teste@example.invalid',1250,'novo_lead',now(),array['CRM personalizado']) returning id into v_lead;
 insert into public.consultas(lead_id,procedimento,data_consulta,duracao_minutos,status,origem)
 values (v_lead,'Diagnóstico de negócio','2020-01-02 10:00:00+00',30,'realizada','equipe') returning id into v_meeting;
 select status into v_status from public.crm_clinica where id=v_lead;
 if v_status <> 'diagnostico' then raise exception 'Meeting must qualify as diagnosis, got %',v_status; end if;
 if exists(select 1 from public.projetos where lead_id=v_lead) then raise exception 'Meeting created project'; end if;
 insert into public.consultas(lead_id,procedimento,data_consulta,duracao_minutos,status,origem)
 values (v_lead,'Diagnóstico de negócio','2020-01-03 10:00:00+00',30,'realizada','equipe');
 if exists(select 1 from public.crm_clinica where id=v_lead and status='ganho') then raise exception 'Repeat meeting became sale'; end if;
 update public.crm_clinica set status='proposta' where id=v_lead;
 update public.crm_clinica set status='negociacao' where id=v_lead;
 update public.crm_clinica set status='ganho' where id=v_lead;
 if not exists(select 1 from public.crm_clinica where id=v_lead and fechado_em is not null) then raise exception 'Missing closing date'; end if;
 select count(*) into v_count from public.projetos where lead_id=v_lead and etapa='briefing';
 if v_count <> 1 then raise exception 'Expected one delivery project'; end if;
 update public.consultas set status='cancelada' where id=v_meeting;
 if not exists(select 1 from public.crm_clinica where id=v_lead and status='ganho') then raise exception 'Meeting cancellation undid sale'; end if;
 update public.crm_clinica set status='negociacao' where id=v_lead;
 update public.crm_clinica set status='ganho' where id=v_lead;
 select count(*) into v_count from public.projetos where lead_id=v_lead;
 if v_count <> 1 then raise exception 'Reclosing duplicated project'; end if;
 update public.projetos set etapa='desenvolvimento' where lead_id=v_lead;
 update public.projetos set etapa='validacao' where lead_id=v_lead;
 update public.projetos set etapa='entregue' where lead_id=v_lead;
 if not exists(select 1 from public.arc_dashboard(now()-interval '1 day',now()+interval '1 day') where vendas_ganhas>=1 and valor_fechado>=1250 and conversao>0) then raise exception 'Invalid sales dashboard'; end if;
 if not exists(select 1 from public.dashboard_procedimentos(now()-interval '1 day',now()+interval '1 day') where procedimento='CRM personalizado' and realizado>=1) then raise exception 'Missing sold service'; end if;
 if (select count(*) from public.servicos_clinica where ativo and not e_avaliacao and not arquivado) <> 6 then raise exception 'Expected six agency services'; end if;
 if has_table_privilege('anon','public.projetos','SELECT') then raise exception 'Anonymous project access'; end if;
 if (select is_updatable from information_schema.views where table_schema='public' and table_name='crm_clinica') <> 'YES' then raise exception 'CRM view lost write access'; end if;
end $$;
select 'PASS: commercial pipeline, meetings, project lifecycle, sales metrics, catalog and access restrictions' as agency_checks;
