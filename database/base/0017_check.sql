-- Ensaio da 0017_etiquetas.
do $$
declare
  g uuid := gen_random_uuid(); k uuid := gen_random_uuid(); off uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid();
  quente uuid; morno uuid; frio uuid; n integer; i integer; t uuid;
begin
  insert into auth.users(id) values (g); insert into auth.users(id) values (k); insert into auth.users(id) values (off);
  update public.usuarios set papel = 'gestor' where id = g;
  update public.usuarios set papel = 'consultor' where id in (k, off);
  update public.usuarios set ativo = false where id = off;
  insert into public.contatos_dados(id, nome, whatsapp) values (c1, 'A', '5511933330171'), (c2, 'B', '5511933330172'), (c3, 'C', '5511933330173');

  -- a equipe cria e marca; nome é normalizado e único sem caixa
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  insert into public.etiquetas(nome, cor) values ('  Quente   demais ', 'danger') returning id into quente;
  insert into public.etiquetas(nome) values ('Morno') returning id into morno;
  insert into public.etiquetas(nome) values ('Frio') returning id into frio;
  begin insert into public.etiquetas(nome) values ('quente demais'); raise exception 'FAIL: nome repetido sem caixa';
  exception when unique_violation then null; end;
  begin insert into public.etiquetas(nome) values ('   '); raise exception 'FAIL: nome vazio';
  exception when check_violation then null; end;
  begin insert into public.etiquetas(nome) values (repeat('x', 31)); raise exception 'FAIL: nome enorme';
  exception when check_violation then null; end;
  begin insert into public.etiquetas(nome, cor) values ('Cor ruim', 'rosa'); raise exception 'FAIL: cor inválida';
  exception when check_violation then null; end;
  insert into public.contato_etiquetas(contato_id, etiqueta_id) values (c1, quente), (c1, morno), (c2, morno), (c3, morno);
  begin insert into public.contato_etiquetas(contato_id, etiqueta_id) values (c1, quente); raise exception 'FAIL: marcou duas vezes';
  exception when unique_violation then null; end;
  -- consultor não renomeia, não recolore, não apaga nem junta (a policy filtra a linha; a função recusa)
  update public.etiquetas set nome = 'Hackeada' where id = quente;
  delete from public.etiquetas where id = morno;
  begin perform public.etiqueta_juntar(morno, quente); raise exception 'FAIL: consultor juntou';
  exception when insufficient_privilege then null; end;
  -- desmarcar é da equipe
  delete from public.contato_etiquetas where contato_id = c3 and etiqueta_id = morno;
  reset role;
  if (select nome from public.etiquetas where id = quente) <> 'Quente demais' then raise exception 'FAIL: nome não normalizado ou foi alterado (%)', (select nome from public.etiquetas where id = quente); end if;
  if not exists (select 1 from public.etiquetas where id = morno) then raise exception 'FAIL: consultor apagou etiqueta'; end if;
  if exists (select 1 from public.contato_etiquetas where contato_id = c3) then raise exception 'FAIL: não desmarcou'; end if;

  -- desligado e anon não marcam nem criam
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', off::text, true);
  begin insert into public.etiquetas(nome) values ('Fantasma'); raise exception 'FAIL: desligado criou etiqueta';
  exception when insufficient_privilege then null; end;
  begin insert into public.contato_etiquetas(contato_id, etiqueta_id) values (c3, quente); raise exception 'FAIL: desligado marcou';
  exception when insufficient_privilege then null; end;
  reset role;
  set local role anon;
  begin perform count(*) from public.etiquetas; raise exception 'FAIL: anon leu';
  exception when insufficient_privilege then null; end;
  reset role;

  -- o gestor renomeia, recolore e junta: quem tinha "Morno" passa a ter "Frio"; os que já tinham os dois não duplicam
  insert into public.contato_etiquetas(contato_id, etiqueta_id) values (c2, frio);
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', g::text, true);
  update public.etiquetas set nome = 'Quentíssimo', cor = 'warning' where id = quente;
  begin perform public.etiqueta_juntar(morno, morno); raise exception 'FAIL: juntou consigo mesma';
  exception when sqlstate '22023' then null; end;
  begin perform public.etiqueta_juntar(morno, gen_random_uuid()); raise exception 'FAIL: juntou com inexistente';
  exception when sqlstate 'P0002' then null; end;
  n := public.etiqueta_juntar(morno, frio);
  reset role;
  if (select nome from public.etiquetas where id = quente) <> 'Quentíssimo' then raise exception 'FAIL: gestor não renomeou'; end if;
  if n <> 1 then raise exception 'FAIL: deveria migrar 1 contato (c1; c2 já tinha), migrou %', n; end if;
  if exists (select 1 from public.etiquetas where id = morno) then raise exception 'FAIL: origem não sumiu'; end if;
  select count(*) into n from public.contato_etiquetas where etiqueta_id = frio; if n <> 2 then raise exception 'FAIL: Frio deveria ter 2 contatos (%)', n; end if;

  -- excluir etiqueta leva as marcações; apagar contato leva as dele
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', g::text, true);
  delete from public.etiquetas where id = quente;
  reset role;
  if exists (select 1 from public.contato_etiquetas where etiqueta_id = quente) then raise exception 'FAIL: marcação sobreviveu à etiqueta'; end if;
  delete from public.contatos_dados where id = c1;
  if exists (select 1 from public.contato_etiquetas where contato_id = c1) then raise exception 'FAIL: marcação sobreviveu ao contato'; end if;

  -- limite de 20 por contato, e a junção respeita o limite sem falhar
  for i in 1..20 loop
    insert into public.etiquetas(nome) values ('T' || i) returning id into t;
    insert into public.contato_etiquetas(contato_id, etiqueta_id) values (c3, t);
  end loop;
  begin insert into public.contato_etiquetas(contato_id, etiqueta_id) values (c3, frio); raise exception 'FAIL: passou do limite de 20';
  exception when check_violation then null; end;
  insert into public.contato_etiquetas(contato_id, etiqueta_id) values (c2, t) on conflict do nothing;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', g::text, true);
  perform public.etiqueta_juntar(frio, t);   -- c3 já está no limite com 20 e tem T20 = t; c2 migra
  reset role;
end $$;
