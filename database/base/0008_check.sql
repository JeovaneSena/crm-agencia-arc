-- Ensaio da 0008_modulo_projetos.
do $$
declare
  u uuid := gen_random_uuid(); c uuid := gen_random_uuid(); p uuid := gen_random_uuid();
  o1 uuid; o2 uuid; pr uuid; n integer; v record;
begin
  insert into auth.users(id) values (u);
  insert into public.contatos_dados(id, nome, whatsapp) values (c, 'Cliente', '5511922220001');
  insert into public.profissionais(id, nome) values (p, 'Ana');
  insert into public.catalogo_servicos(nome, descricao) values ('Serviço X', 'teste');

  -- venda aberta não gera projeto
  insert into public.oportunidades(contato_id, nome) values (c, 'Venda 1') returning id into o1;
  select count(*) into n from public.projetos where oportunidade_id = o1;
  if n <> 0 then raise exception 'FAIL: projeto nasceu de venda aberta'; end if;

  -- ganhar a venda gera exatamente um projeto, com nome e escopo da venda
  update public.oportunidades set status = 'ganho', valor_proposta = 100, servicos_contratados = array['Serviço X'], escopo = 'Escopo A' where id = o1;
  select * into v from public.projetos where oportunidade_id = o1;
  if v.id is null or v.nome <> 'Venda 1' or v.escopo <> 'Escopo A' or v.etapa <> 'planejamento' or v.contato_id <> c then
    raise exception 'FAIL: projeto da venda errado (%)', v;
  end if;
  pr := v.id;

  -- idempotente: outro update de status não duplica
  update public.oportunidades set status = 'ganho' where id = o1;
  select count(*) into n from public.projetos where oportunidade_id = o1;
  if n <> 1 then raise exception 'FAIL: projeto duplicado (%)', n; end if;

  -- constraints
  begin
    insert into public.projetos(contato_id, oportunidade_id, nome) values (c, o1, 'dup');
    raise exception 'FAIL: segundo projeto da mesma venda entrou';
  exception when unique_violation then null; end;
  insert into public.oportunidades(contato_id, nome) values (c, 'Venda 2') returning id into o2;
  begin
    insert into public.projetos(contato_id, oportunidade_id, nome) values (c, o2, 'de venda aberta');
    raise exception 'FAIL: projeto de venda não ganha entrou';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin
    update public.projetos set etapa = 'briefing' where id = pr;
    raise exception 'FAIL: etapa fora do contrato entrou';
  exception when check_violation then null; end;
  begin
    update public.projetos set oportunidade_id = o2 where id = pr;
    raise exception 'FAIL: vínculo com a venda foi alterado';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;

  -- a equipe lê e edita só o andamento; não cria, não apaga, não mexe no vínculo
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', u::text, true);
  update public.projetos set etapa = 'andamento', prazo = current_date + 7, responsavel_id = p, nome = 'Renomeado' where id = pr;
  select * into v from public.projetos where id = pr;
  if v.etapa <> 'andamento' or v.responsavel_id <> p or v.nome <> 'Renomeado' then raise exception 'FAIL: equipe não editou o andamento'; end if;
  begin
    insert into public.projetos(contato_id, oportunidade_id, nome) values (c, o1, 'x');
    raise exception 'FAIL: equipe criou projeto';
  exception when insufficient_privilege then null; end;
  begin
    update public.projetos set oportunidade_id = o2 where id = pr;
    raise exception 'FAIL: equipe alterou o vínculo';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.projetos where id = pr;
    raise exception 'FAIL: equipe apagou projeto';
  exception when insufficient_privilege then null; end;
  reset role;
  set local role anon;
  begin
    perform 1 from public.projetos;
    raise exception 'FAIL: anon leu projetos';
  exception when insufficient_privilege then null; end;
  reset role;

  -- desligar o responsável não apaga o projeto
  delete from public.profissionais where id = p;
  select * into v from public.projetos where id = pr;
  if v.id is null or v.responsavel_id is not null then raise exception 'FAIL: apagar responsável quebrou o projeto'; end if;

  -- apagar o contato leva os projetos junto
  delete from public.contatos_dados where id = c;
  select count(*) into n from public.projetos where id = pr;
  if n <> 0 then raise exception 'FAIL: projeto sobreviveu ao contato'; end if;

  select count(*) into n from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'projetos';
  if n <> 1 then raise exception 'FAIL: projetos fora do realtime'; end if;
end;
$$;
