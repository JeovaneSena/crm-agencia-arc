-- Ensaio da 0006_storage_perfil_logo.
do $$
declare
  g uuid := gen_random_uuid(); c uuid := gen_random_uuid(); n integer; ok boolean;
begin
  insert into auth.users(id) values (g);
  insert into auth.users(id) values (c);
  update public.usuarios set papel = 'consultor' where id = c;

  select count(*) into n from storage.buckets where id in ('avatars','logos') and public and file_size_limit = 2097152;
  if n <> 2 then raise exception 'Buckets avatars/logos ausentes ou mal configurados (% de 2)', n; end if;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', c::text, true);

  -- consultor grava na própria pasta do avatar
  insert into storage.objects(bucket_id, name, owner) values ('avatars', c::text || '/avatar.png', c);
  -- ...mas não na pasta de outra pessoa
  begin
    insert into storage.objects(bucket_id, name, owner) values ('avatars', g::text || '/avatar.png', c);
    raise exception 'FAIL: consultor gravou na pasta de outro usuário';
  exception when insufficient_privilege or check_violation then null;
  when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  -- consultor não troca a logo
  begin
    insert into storage.objects(bucket_id, name, owner) values ('logos', 'empresa/logo.png', c);
    raise exception 'FAIL: consultor gravou a logo';
  exception when insufficient_privilege or check_violation then null;
  when others then if sqlerrm like 'FAIL%' then raise; end if; end;

  -- gestor grava a logo
  perform set_config('request.jwt.claim.sub', g::text, true);
  insert into storage.objects(bucket_id, name, owner) values ('logos', 'empresa/logo.png', g);
  reset role;

  raise notice 'PASS: 0006_storage_perfil_logo';
end $$;
