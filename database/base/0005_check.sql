-- Ensaio da 0005_funcoes_so_equipe: nenhuma função pública fica aberta a anon.
do $$
declare f record; abertas text := ''; n integer;
begin
  for f in select p.oid, p.oid::regprocedure as assinatura from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    if has_function_privilege('anon', f.oid, 'EXECUTE') then abertas := abertas || ' ' || f.assinatura::text; end if;
    if not has_function_privilege('authenticated', f.oid, 'EXECUTE') then raise exception 'authenticated perdeu acesso a %', f.assinatura; end if;
  end loop;
  if abertas <> '' then raise exception 'anon ainda executa:%', abertas; end if;

  -- função criada depois nasce fechada para anon
  create function public.zz_teste_privilegio() returns int language sql as 'select 1';
  if has_function_privilege('anon', 'public.zz_teste_privilegio()', 'EXECUTE') then
    raise exception 'função nova nasceu aberta para anon (default privileges não pegaram)';
  end if;

  raise notice 'PASS: 0005_funcoes_so_equipe';
end $$;
