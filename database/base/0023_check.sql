-- Recuperação: autoria, prazo, idempotência, exclusões e conclusão automática.
do $$
declare g uuid := gen_random_uuid(); outro uuid := gen_random_uuid(); c uuid := gen_random_uuid(); o uuid; r uuid; t record; n integer;
begin
 insert into auth.users(id) values(g),(outro);
 update public.usuarios set papel='gestor' where id=outro;
 update public.usuarios set papel='gestor' where id=g;
 insert into public.catalogo_servicos(nome) values('Reunião recuperação');
 insert into public.contatos_dados(id,nome,whatsapp) values(c,'Ana','551199990023');
 insert into public.oportunidades(contato_id,nome,responsavel_id) values(c,'Venda',g) returning id into o;
 perform set_config('request.jwt.claim.sub',g::text,true);
 set local role authenticated;
 insert into public.reunioes(contato_id,oportunidade_id,assunto,data_reuniao) values(c,o,'Reunião recuperação',now()-interval '1 day') returning id into r;
 update public.reunioes set status='faltou' where id=r;
 reset role;
 select * into t from public.tarefas where reuniao_id=r;
 if t.id is null or t.origem<>'sistema' or t.responsavel_id is distinct from g or t.vence_em<>now()+interval '2 hours' then raise exception 'FAIL: tarefa da falta sem prazo ou responsável'; end if;
 set local role authenticated;
 begin update public.tarefas set reuniao_id=null where id=t.id; raise exception 'FAIL: navegador alterou a reunião da tarefa'; exception when insufficient_privilege then null; end;
 update public.reunioes set status='realizada' where id=r;
 update public.reunioes set status='faltou' where id=r;
 reset role;
 select count(*) into n from public.tarefas where reuniao_id=r;
 if n<>1 then raise exception 'FAIL: falta duplicou a tarefa'; end if;
 insert into public.reunioes(contato_id,oportunidade_id,assunto,data_reuniao) values(c,o,'Reunião recuperação',now()+interval '2 days');
 if not exists(select 1 from public.tarefas where id=t.id and concluida_em is not null and concluida_por is null) then raise exception 'FAIL: remarcar não concluiu'; end if;
 -- Já tem outra agendada: não cria. Inserção histórica também não.
 insert into public.reunioes(contato_id,oportunidade_id,assunto,data_reuniao) values(c,o,'Reunião recuperação',now()-interval '3 days') returning id into r;
 update public.reunioes set status='faltou' where id=r;
 if exists(select 1 from public.tarefas where reuniao_id=r) then raise exception 'FAIL: criou apesar de já remarcada'; end if;
 insert into public.reunioes(contato_id,oportunidade_id,assunto,data_reuniao,status) values(c,o,'Reunião recuperação',now()-interval '4 days','faltou') returning id into r;
 if exists(select 1 from public.tarefas where reuniao_id=r) then raise exception 'FAIL: histórico criou recuperação'; end if;
 update public.reunioes set status='cancelada' where contato_id=c and status='agendada';
 -- Responsável desligado cai para a pessoa que baixou a falta.
 update public.usuarios set ativo=false where id=g;
 perform set_config('request.jwt.claim.sub','',true);
 insert into public.reunioes(contato_id,oportunidade_id,assunto,data_reuniao) values(c,o,'Reunião recuperação',now()-interval '5 days') returning id into r;
 update public.reunioes set status='faltou' where id=r;
 if not exists(select 1 from public.tarefas where reuniao_id=r and responsavel_id is null) then raise exception 'FAIL: responsável desligado impediu baixa'; end if;
 -- Sem negócio, a recuperação também funciona.
 insert into public.reunioes(contato_id,assunto,data_reuniao) values(c,'Reunião recuperação',now()-interval '6 days') returning id into r;
 update public.reunioes set status='faltou' where id=r;
 if not exists(select 1 from public.tarefas where reuniao_id=r and oportunidade_id is null) then raise exception 'FAIL: falta sem negócio não criou tarefa'; end if;
 delete from public.reunioes where id=r;
 if exists(select 1 from public.tarefas where reuniao_id=r) then raise exception 'FAIL: tarefa órfã'; end if;
end $$;
