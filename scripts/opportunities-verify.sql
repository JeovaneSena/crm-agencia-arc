begin;
do $$ declare lid uuid; oid uuid; second_id uuid; mid uuid; n int; before_total numeric; t timestamptz; project_id uuid; begin
 -- Populated legacy migration preserves a project and does not fabricate sales items.
 if exists(select 1 from crm_clinica_dados where nome_lead='ARC migration fixture') then
  if not exists(select 1 from projetos p join oportunidades o on p.oportunidade_id=o.id join crm_clinica_dados d on d.id=o.lead_id
    where d.nome_lead='ARC migration fixture' and o.valor_proposta=420 and o.servicos_contratados='{}' and d.cliente_desde is not null) then
   raise exception 'Legacy migration lost project/value or invented contracted items'; end if;
 end if;
 select valor_fechado into before_total from arc_dashboard(now()-interval '1 day',now()+interval '1 day');
 insert into crm_clinica(nome_lead,procedimentos_interesse) values('ARC invariant test',array['CRM personalizado','Sites e landing pages']) returning id into lid;
 select id into oid from oportunidades where lead_id=lid;
 if oid is null or (select count(*) from oportunidades where lead_id=lid)<>1 then raise exception 'Initial opportunity missing/duplicated'; end if;
 perform arc_qualificar_contato(lid);
 if not exists(select 1 from oportunidades where id=oid and status='qualificacao') then raise exception 'Qualification failed'; end if;
 insert into consultas(lead_id,procedimento,data_consulta,status,duracao_minutos,origem) values(lid,'Diagnóstico de negócio','2020-01-01 10:00+00','realizada',30,'equipe') returning id into mid;
 if not exists(select 1 from consultas where id=mid and oportunidade_id=oid) then raise exception 'Single opportunity not linked'; end if;
 if exists(select 1 from projetos where lead_id=lid) then raise exception 'Meeting became sale'; end if;
 begin update oportunidades set status='ganho' where id=oid; raise exception 'UNEXPECTED missing sale details accepted'; exception when others then if sqlerrm like 'UNEXPECTED%' then raise; end if; end;
 update oportunidades set nome='Site contratado',status='ganho',valor_proposta=1000,servicos_contratados=array['Sites e landing pages'] where id=oid;
 select fechado_em into t from oportunidades where id=oid;
 select id into project_id from projetos where oportunidade_id=oid;
 if project_id is null then raise exception 'Project missing'; end if;
 update oportunidades set status='ganho' where id=oid;
 if (select count(*) from projetos where oportunidade_id=oid)<>1 then raise exception 'Duplicate project'; end if;
 if (select realizado from dashboard_procedimentos(now()-interval '1 day',now()+interval '1 day') where procedimento='CRM personalizado')<>0 then raise exception 'Interests counted as sales'; end if;
 insert into oportunidades(lead_id,nome,status,valor_proposta,servicos_contratados) values(lid,'Segunda compra','negociacao',2000,array['CRM personalizado']) returning id into second_id;
 if not exists(select 1 from crm_clinica where id=lid and status='ganho' and cliente_desde is not null) then raise exception 'Customer disappeared'; end if;
 update oportunidades set status='ganho' where id=second_id;
 if (select count(*) from projetos where lead_id=lid)<>2 then raise exception 'Second sale did not create independent project'; end if;
 if not exists(select 1 from oportunidades where id=oid and fechado_em=t and valor_proposta=1000) then raise exception 'Second sale changed first'; end if;
 if (select valor_fechado from arc_dashboard(now()-interval '1 day',now()+interval '1 day'))<>before_total+3000 then raise exception 'Sales value wrong'; end if;
 begin update oportunidades set valor_proposta=5000 where id=oid; raise exception 'UNEXPECTED won value editable'; exception when others then if sqlerrm like 'UNEXPECTED%' then raise; end if; end;
 begin update oportunidades set status='negociacao' where id=oid; raise exception 'UNEXPECTED won reopening allowed'; exception when others then if sqlerrm like 'UNEXPECTED%' then raise; end if; end;
 update oportunidades set status='perdido',motivo_cancelamento='Cancelamento solicitado para teste' where id=oid;
 if not exists(select 1 from oportunidades where id=oid and cancelado_em is not null and fechado_em=t) then raise exception 'Cancellation history lost'; end if;
 if not exists(select 1 from projetos where id=project_id) then raise exception 'Cancellation removed delivery'; end if;
 if (select valor_fechado from arc_dashboard(now()-interval '1 day',now()+interval '1 day'))<>before_total+2000 then raise exception 'Cancellation metrics wrong'; end if;
 update consultas set status='cancelada' where id=mid;
 if not exists(select 1 from oportunidades where id=second_id and status='ganho') then raise exception 'Meeting cancelled sale'; end if;
 insert into oportunidades(lead_id,nome) values(lid,'Aberta A'),(lid,'Aberta B');
 perform arc_qualificar_contato(lid);
 if exists(select 1 from oportunidades where lead_id=lid and nome like 'Aberta%' and status<>'novo_lead') then raise exception 'Ambiguous qualification changed opportunity'; end if;
 insert into consultas(lead_id,procedimento,data_consulta,status,duracao_minutos,origem) values(lid,'Diagnóstico de negócio','2020-01-02 10:00+00','realizada',30,'equipe') returning id into mid;
 if exists(select 1 from consultas where id=mid and oportunidade_id is not null) then raise exception 'Ambiguous meeting linked'; end if;
 begin update crm_clinica set status='negociacao' where id=lid; raise exception 'UNEXPECTED legacy status writable'; exception when others then if sqlerrm like 'UNEXPECTED%' then raise; end if; end;
 if has_table_privilege('anon','oportunidades','SELECT') or has_table_privilege('anon','projetos','SELECT') then raise exception 'Anonymous access'; end if;
 if has_table_privilege('authenticated','oportunidade_eventos','INSERT') then raise exception 'Audit history writable'; end if;
 if (select is_updatable from information_schema.views where table_schema='public' and table_name='crm_clinica')<>'YES' then raise exception 'Contact view lost writes'; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='oportunidades') then raise exception 'Realtime missing'; end if;
 -- Cascades must delete associated meetings before FK checks.
 delete from crm_clinica where id=lid;
 if exists(select 1 from projetos where lead_id=lid) or exists(select 1 from oportunidades where lead_id=lid) then raise exception 'Cascade incomplete'; end if;
end $$;
select 'PASS: legacy migration, independent sales/projects, accurate services/values, cancellation, ambiguous meetings, legacy write protection, grants and cascades' as checks;

rollback;
