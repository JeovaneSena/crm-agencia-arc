-- Ensaio da 0013_respostas_rapidas.
do $$
declare
  g uuid := gen_random_uuid(); k uuid := gen_random_uuid(); k2 uuid := gen_random_uuid();
  eq uuid; pk uuid; n integer;
begin
  insert into auth.users(id) values (g);
  insert into auth.users(id) values (k);
  insert into auth.users(id) values (k2);
  update public.usuarios set papel = 'gestor' where id = g;
  update public.usuarios set papel = 'consultor' where id = k;
  update public.usuarios set papel = 'consultor' where id = k2;

  -- o gestor cria uma da equipe
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', g::text, true);
  insert into public.respostas_rapidas(titulo, texto, atalho, dono_id, criada_por) values ('Endereço', 'Fica na Rua X, 10.', 'endereco', null, g) returning id into eq;
  reset role;

  -- o consultor lê a da equipe, cria a própria, e NÃO cria nem edita nem apaga a da equipe
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  insert into public.respostas_rapidas(titulo, texto, atalho, dono_id, criada_por) values ('Saudação', 'Oi, {{primeiro_nome}}! Tudo bem?', 'oi', k, k) returning id into pk;
  select count(*) into n from public.respostas_rapidas; if n <> 2 then raise exception 'FAIL: consultor deveria ver 2 (%)', n; end if;
  begin insert into public.respostas_rapidas(titulo, texto, dono_id, criada_por) values ('x', 'y', null, k); raise exception 'FAIL: consultor criou da equipe';
  exception when insufficient_privilege then null; end;
  update public.respostas_rapidas set texto = 'hackeado' where id = eq;
  delete from public.respostas_rapidas where id = eq;
  -- não cria em nome de outro nem finge ser outro autor
  begin insert into public.respostas_rapidas(titulo, texto, dono_id, criada_por) values ('x', 'y', k2, k); raise exception 'FAIL: criou para outra pessoa';
  exception when insufficient_privilege then null; end;
  begin insert into public.respostas_rapidas(titulo, texto, dono_id, criada_por) values ('x', 'y', k, g); raise exception 'FAIL: criada_por falso';
  exception when insufficient_privilege then null; end;
  -- não troca de família
  begin update public.respostas_rapidas set dono_id = null where id = pk; raise exception 'FAIL: mudou o dono';
  exception when insufficient_privilege then null; end;
  reset role;
  if (select texto from public.respostas_rapidas where id = eq) <> 'Fica na Rua X, 10.' then raise exception 'FAIL: consultor editou a da equipe'; end if;
  if not exists (select 1 from public.respostas_rapidas where id = eq) then raise exception 'FAIL: consultor apagou a da equipe'; end if;

  -- a pessoal de um não aparece nem é editável por outro consultor; o gestor também não a vê
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k2::text, true);
  select count(*) into n from public.respostas_rapidas; if n <> 1 then raise exception 'FAIL: outro consultor viu a pessoal (%)', n; end if;
  update public.respostas_rapidas set texto = 'hackeado' where id = pk;
  delete from public.respostas_rapidas where id = pk;
  perform set_config('request.jwt.claim.sub', g::text, true);
  select count(*) into n from public.respostas_rapidas where id = pk; if n <> 0 then raise exception 'FAIL: gestor viu a pessoal de outro'; end if;
  reset role;
  if (select texto from public.respostas_rapidas where id = pk) <> 'Oi, {{primeiro_nome}}! Tudo bem?' then raise exception 'FAIL: pessoal foi alterada por outro'; end if;

  -- o dono edita e apaga a própria; o gestor edita a da equipe
  -- (now() não anda dentro de uma transação: recua a criação para a mudança de updated_at aparecer)
  update public.respostas_rapidas set created_at = now() - interval '1 day', updated_at = now() - interval '1 day' where id = pk;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  update public.respostas_rapidas set titulo = 'Saudação 2' where id = pk;
  reset role;
  if (select titulo from public.respostas_rapidas where id = pk) <> 'Saudação 2' then raise exception 'FAIL: dono não editou'; end if;
  if (select updated_at from public.respostas_rapidas where id = pk) = (select created_at from public.respostas_rapidas where id = pk) then raise exception 'FAIL: updated_at não andou'; end if;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', g::text, true);
  update public.respostas_rapidas set texto = 'Rua Y, 20.' where id = eq;
  reset role;
  if (select texto from public.respostas_rapidas where id = eq) <> 'Rua Y, 20.' then raise exception 'FAIL: gestor não editou a da equipe'; end if;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  delete from public.respostas_rapidas where id = pk;
  reset role;
  if exists (select 1 from public.respostas_rapidas where id = pk) then raise exception 'FAIL: dono não apagou'; end if;

  -- validações e atalhos únicos por família
  begin insert into public.respostas_rapidas(titulo, texto, atalho, criada_por) values ('', 'y', null, g); raise exception 'FAIL: título vazio';
  exception when check_violation then null; end;
  begin insert into public.respostas_rapidas(titulo, texto, atalho, criada_por) values ('t', repeat('x', 1001), null, g); raise exception 'FAIL: texto enorme';
  exception when check_violation then null; end;
  begin insert into public.respostas_rapidas(titulo, texto, atalho, criada_por) values ('t', 'y', 'Com Espaço', g); raise exception 'FAIL: atalho inválido';
  exception when check_violation then null; end;
  begin insert into public.respostas_rapidas(titulo, texto, atalho, dono_id, criada_por) values ('t', 'y', 'endereco', null, g); raise exception 'FAIL: atalho repetido na equipe';
  exception when unique_violation then null; end;
  insert into public.respostas_rapidas(titulo, texto, atalho, dono_id, criada_por) values ('t', 'y', 'endereco', k, k);
  insert into public.respostas_rapidas(titulo, texto, atalho, dono_id, criada_por) values ('t', 'y', 'endereco', k2, k2);
  begin insert into public.respostas_rapidas(titulo, texto, atalho, dono_id, criada_por) values ('t2', 'y', 'endereco', k, k); raise exception 'FAIL: atalho repetido na mesma pessoa';
  exception when unique_violation then null; end;

  -- anon: nada
  set local role anon;
  begin perform count(*) from public.respostas_rapidas; raise exception 'FAIL: anon leu';
  exception when insufficient_privilege then null; end;
  reset role;

  -- quem tem resposta própria tem "histórico": a conta é desligada, não excluída (regra geral da 0001)
  begin delete from auth.users where id = k2; raise exception 'FAIL: excluiu conta com resposta pessoal';
  exception when sqlstate '23503' then null; end;
end $$;
