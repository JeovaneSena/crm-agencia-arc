-- Ensaio da 0007_modulo_conversas.
do $$
declare
  u uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  n integer; v record; ult timestamptz;
begin
  insert into auth.users(id) values (u);
  insert into public.contatos_dados(id, nome, whatsapp) values (c1, 'Com conversa', '5511911110001'), (c2, 'Sem conversa', '5511911110002');

  -- escrita da função (service_role / dono): mensagens e idempotência
  insert into public.mensagens_whatsapp(contato_id, autor, conteudo, id_externo, criada_em) values
    (c1, 'cliente', 'oi', 'ext-1', now() - interval '2 minutes'),
    (c1, 'agente', 'olá', 'ext-2', now() - interval '1 minute'),
    (c1, 'cliente', 'tudo bem?', 'ext-3', now());
  begin
    insert into public.mensagens_whatsapp(contato_id, autor, conteudo, id_externo) values (c1, 'cliente', 'dup', 'ext-1');
    raise exception 'FAIL: id_externo duplicado entrou';
  exception when unique_violation then null; end;
  begin
    insert into public.mensagens_whatsapp(contato_id, autor, conteudo) values (c1, 'paciente', 'x');
    raise exception 'FAIL: autor fora do contrato entrou';
  exception when check_violation then null; end;

  select ultima_mensagem into ult from public.contatos_dados where id = c1;
  if ult is null then raise exception 'FAIL: trigger não atualizou ultima_mensagem'; end if;

  -- a lista: só quem tem mensagem; 2 não lidas; última mensagem correta
  select * into v from public.conversas_lista where contato_id = c1;
  if v.nao_lidas <> 2 or v.ultimo_conteudo <> 'tudo bem?' or v.assumida then raise exception 'FAIL: conversas_lista errada (%)', v; end if;
  select count(*) into n from public.conversas_lista where contato_id = c2;
  if n <> 0 then raise exception 'FAIL: contato sem mensagem apareceu na lista'; end if;

  -- anon não enxerga nada
  set local role anon;
  begin
    perform 1 from public.mensagens_whatsapp limit 1;
    raise exception 'FAIL: anon leu mensagens';
  exception when insufficient_privilege then null; end;
  reset role;

  -- equipe: lê, marca como lida, assume; não escreve mensagem nem edita texto
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', u::text, true);
  select count(*) into n from public.mensagens_whatsapp; if n <> 3 then raise exception 'FAIL: equipe não leu (% de 3)', n; end if;
  update public.mensagens_whatsapp set lida = true where contato_id = c1 and autor = 'cliente';
  begin
    insert into public.mensagens_whatsapp(contato_id, autor, conteudo) values (c1, 'atendente', 'direto');
    raise exception 'FAIL: equipe inseriu mensagem pelo banco';
  exception when insufficient_privilege then null; end;
  begin
    update public.mensagens_whatsapp set conteudo = 'editada' where contato_id = c1;
    raise exception 'FAIL: equipe editou conteúdo';
  exception when insufficient_privilege then null; end;
  update public.contatos_dados set assumido_por = u, assumido_em = now() where id = c1;
  select * into v from public.conversas_lista where contato_id = c1;
  if v.nao_lidas <> 0 or not v.assumida then raise exception 'FAIL: lida/assumida não refletiram (%)', v; end if;
  reset role;

  -- apagar o contato leva as mensagens junto
  delete from public.contatos_dados where id = c1;
  select count(*) into n from public.mensagens_whatsapp where contato_id = c1;
  if n <> 0 then raise exception 'FAIL: mensagens órfãs após apagar contato'; end if;

  select count(*) into n from storage.buckets where id = 'midias-whatsapp' and not public;
  if n <> 1 then raise exception 'FAIL: bucket midias-whatsapp ausente ou público'; end if;
  select count(*) into n from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'mensagens_whatsapp';
  if n <> 1 then raise exception 'FAIL: mensagens fora do realtime'; end if;
end $$;
