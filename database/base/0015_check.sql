-- Ensaio da 0015_assumir_e_transferir.
do $$
declare
  g uuid := gen_random_uuid(); a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); off uuid := gen_random_uuid();
  c uuid := gen_random_uuid(); v record; n integer; ok boolean;
begin
  insert into auth.users(id) values (g); insert into auth.users(id) values (a);
  insert into auth.users(id) values (b); insert into auth.users(id) values (off);
  update public.usuarios set papel = 'gestor' where id = g;
  update public.usuarios set papel = 'consultor' where id in (a, b, off);
  update public.usuarios set ativo = false where id = off;
  insert into public.contatos_dados(id, nome, whatsapp) values (c, 'Cliente', '5511933330015');

  -- o navegador não escreve direto
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', a::text, true);
  begin update public.contatos_dados set assumido_por = a, assumido_em = now() where id = c; raise exception 'FAIL: UPDATE direto passou';
  exception when insufficient_privilege then null; end;
  -- mas editar o resto do contato segue livre
  update public.contatos_dados set nome = 'Cliente 2' where id = c;

  -- A assume; repetir é idempotente e não gera outro evento
  if not public.conversa_assumir(c) then raise exception 'FAIL: A não assumiu a conversa livre'; end if;
  if not public.conversa_assumir(c) then raise exception 'FAIL: assumir a própria deveria dar true'; end if;
  -- B chega depois: perde, e nada muda
  perform set_config('request.jwt.claim.sub', b::text, true);
  if public.conversa_assumir(c) then raise exception 'FAIL: B tomou a conversa de A'; end if;
  -- B não força, não transfere e não devolve a conversa de A
  begin perform public.conversa_assumir(c, true); raise exception 'FAIL: consultor forçou';
  exception when insufficient_privilege then null; end;
  begin perform public.conversa_transferir(c, b); raise exception 'FAIL: B transferiu a conversa de A';
  exception when insufficient_privilege then null; end;
  begin perform public.conversa_devolver(c); raise exception 'FAIL: B devolveu a conversa de A';
  exception when insufficient_privilege then null; end;
  reset role;
  select assumido_por into v from public.contatos_dados where id = c;
  if v.assumido_por <> a then raise exception 'FAIL: dono mudou indevidamente (%)', v; end if;
  select count(*) into n from public.conversa_eventos where contato_id = c; if n <> 1 then raise exception 'FAIL: deveria haver 1 evento (%)', n; end if;

  -- A transfere para B; não para desligado nem inexistente
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', a::text, true);
  begin perform public.conversa_transferir(c, off); raise exception 'FAIL: transferiu para desligado';
  exception when sqlstate '22023' then null; end;
  begin perform public.conversa_transferir(c, gen_random_uuid()); raise exception 'FAIL: transferiu para ninguém';
  exception when sqlstate '22023' then null; end;
  perform public.conversa_transferir(c, b);
  reset role;
  select * into v from public.conversa_eventos where contato_id = c and tipo = 'transferiu';
  if v.de_usuario <> a or v.para_usuario <> b or v.por_usuario <> a then raise exception 'FAIL: evento de transferência errado (%)', v; end if;

  -- o gestor toma de B (precisa forçar) e registra; depois devolve
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', g::text, true);
  if public.conversa_assumir(c) then raise exception 'FAIL: gestor sem forçar tomou'; end if;
  if not public.conversa_assumir(c, true) then raise exception 'FAIL: gestor não conseguiu forçar'; end if;
  perform public.conversa_devolver(c);
  perform public.conversa_devolver(c); -- repetir é inofensivo
  reset role;
  select assumido_por, assumido_em into v from public.contatos_dados where id = c;
  if v.assumido_por is not null or v.assumido_em is not null then raise exception 'FAIL: não devolveu (%)', v; end if;
  select count(*) into n from public.conversa_eventos where contato_id = c; if n <> 4 then raise exception 'FAIL: eventos esperados 4 (assumiu, transferiu, transferiu, devolveu), vieram %', n; end if;

  -- desligado e anon não assumem
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', off::text, true);
  begin perform public.conversa_assumir(c); raise exception 'FAIL: desligado assumiu';
  exception when insufficient_privilege then null; end;
  reset role;
  set local role anon;
  begin perform public.conversa_assumir(c); raise exception 'FAIL: anon assumiu';
  exception when insufficient_privilege then null; end;
  reset role;

  -- a equipe lê o histórico, mas não escreve nele
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', b::text, true);
  select count(*) into n from public.conversa_eventos; if n <> 4 then raise exception 'FAIL: equipe não leu o histórico (%)', n; end if;
  begin insert into public.conversa_eventos(contato_id, tipo) values (c, 'assumiu'); raise exception 'FAIL: equipe escreveu evento';
  exception when insufficient_privilege then null; end;
  reset role;

  -- o servidor (service_role/Edge Function) segue podendo escrever direto, e contato apagado leva o histórico
  update public.contatos_dados set assumido_por = a, assumido_em = now() where id = c;
  delete from public.contatos_dados where id = c;
  select count(*) into n from public.conversa_eventos where contato_id = c; if n <> 0 then raise exception 'FAIL: evento sobreviveu ao contato'; end if;
end $$;
