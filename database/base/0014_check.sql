-- Ensaio da 0014_notas_internas.
do $$
declare
  g uuid := gen_random_uuid(); k uuid := gen_random_uuid(); k2 uuid := gen_random_uuid(); off uuid := gen_random_uuid();
  c uuid := gen_random_uuid(); nk uuid; n integer;
begin
  insert into auth.users(id) values (g);
  insert into auth.users(id) values (k);
  insert into auth.users(id) values (k2);
  insert into auth.users(id) values (off);
  update public.usuarios set papel = 'gestor' where id = g;
  update public.usuarios set papel = 'consultor' where id in (k, k2, off);
  update public.usuarios set ativo = false where id = off;
  insert into public.contatos_dados(id, nome, whatsapp) values (c, 'Cliente', '5511933330014');

  -- a equipe escreve em seu nome
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  insert into public.notas_conversa(contato_id, texto, autor_id) values (c, 'Pediu desconto de 10%.', k) returning id into nk;
  -- ... e não em nome de outro, nem vazio, nem enorme
  begin insert into public.notas_conversa(contato_id, texto, autor_id) values (c, 'x', k2); raise exception 'FAIL: escreveu como outro';
  exception when insufficient_privilege then null; end;
  begin insert into public.notas_conversa(contato_id, texto, autor_id) values (c, '   ', k); raise exception 'FAIL: nota vazia';
  exception when check_violation then null; end;
  begin insert into public.notas_conversa(contato_id, texto, autor_id) values (c, repeat('x', 2001), k); raise exception 'FAIL: nota enorme';
  exception when check_violation then null; end;
  -- ninguém edita
  begin update public.notas_conversa set texto = 'outra' where id = nk; raise exception 'FAIL: editou a nota';
  exception when insufficient_privilege then null; end;
  reset role;

  -- todos leem; usuário desligado não escreve
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k2::text, true);
  select count(*) into n from public.notas_conversa where contato_id = c; if n <> 1 then raise exception 'FAIL: colega não leu a nota (%)', n; end if;
  -- outro consultor não apaga a nota alheia (a policy filtra a linha)
  delete from public.notas_conversa where id = nk;
  perform set_config('request.jwt.claim.sub', off::text, true);
  begin insert into public.notas_conversa(contato_id, texto, autor_id) values (c, 'x', off); raise exception 'FAIL: usuário desligado escreveu';
  exception when insufficient_privilege then null; end;
  reset role;
  if not exists (select 1 from public.notas_conversa where id = nk) then raise exception 'FAIL: colega apagou a nota alheia'; end if;

  -- o autor apaga a própria; o gestor apaga qualquer
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  delete from public.notas_conversa where id = nk;
  reset role;
  if exists (select 1 from public.notas_conversa where id = nk) then raise exception 'FAIL: autor não apagou'; end if;
  insert into public.notas_conversa(contato_id, texto, autor_id) values (c, 'outra', k) returning id into nk;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', g::text, true);
  delete from public.notas_conversa where id = nk;
  reset role;
  if exists (select 1 from public.notas_conversa where id = nk) then raise exception 'FAIL: gestor não apagou'; end if;

  -- anon: nada
  set local role anon;
  begin perform count(*) from public.notas_conversa; raise exception 'FAIL: anon leu';
  exception when insufficient_privilege then null; end;
  reset role;

  -- apagar o contato leva as notas
  insert into public.notas_conversa(contato_id, texto, autor_id) values (c, 'some junto', k);
  delete from public.contatos_dados where id = c;
  select count(*) into n from public.notas_conversa where contato_id = c; if n <> 0 then raise exception 'FAIL: nota sobreviveu ao contato'; end if;
end $$;
