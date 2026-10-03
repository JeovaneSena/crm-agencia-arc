-- Ensaio da 0016_adiar_conversa.
do $$
declare
  g uuid := gen_random_uuid(); k uuid := gen_random_uuid(); off uuid := gen_random_uuid(); c uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  n integer; v record;
begin
  insert into auth.users(id) values (g); insert into auth.users(id) values (k); insert into auth.users(id) values (off);
  update public.usuarios set papel = 'gestor' where id = g;
  update public.usuarios set papel = 'consultor' where id in (k, off);
  update public.usuarios set ativo = false where id = off;
  insert into public.contatos_dados(id, nome, whatsapp) values (c, 'Cliente A', '5511933330016');
  insert into public.contatos_dados(id, nome, whatsapp) values (c2, 'Cliente B', '5511933330017');

  -- a equipe adia; data passada, absurda e contato inexistente são recusados; desligado e anon não adiam
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  perform public.conversa_adiar(c, now() + interval '2 hours');
  begin perform public.conversa_adiar(c, now() - interval '1 minute'); raise exception 'FAIL: adiou para o passado';
  exception when sqlstate '22023' then null; end;
  begin perform public.conversa_adiar(c, now() + interval '31 days'); raise exception 'FAIL: adiou por mais de 30 dias';
  exception when sqlstate '22023' then null; end;
  begin perform public.conversa_adiar(gen_random_uuid(), now() + interval '1 hour'); raise exception 'FAIL: adiou contato inexistente';
  exception when sqlstate 'P0002' then null; end;
  reset role;
  if (select adiada_ate from public.contatos_dados where id = c) is null then raise exception 'FAIL: não adiou'; end if;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', off::text, true);
  begin perform public.conversa_adiar(c, now() + interval '1 hour'); raise exception 'FAIL: desligado adiou';
  exception when sqlstate '42501' then null; end;
  reset role;
  set local role anon;
  begin perform public.conversa_adiar(c, now() + interval '1 hour'); raise exception 'FAIL: anon adiou';
  exception when insufficient_privilege then null; end;
  reset role;

  -- "voltar agora" (data nula)
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  perform public.conversa_adiar(c, null);
  reset role;
  if (select adiada_ate from public.contatos_dados where id = c) is not null then raise exception 'FAIL: voltar agora não zerou'; end if;

  -- cliente escreve: volta sozinha; a mensagem da equipe/IA não reabre
  update public.contatos_dados set adiada_ate = now() + interval '5 hours' where id in (c, c2);
  insert into public.mensagens_whatsapp(contato_id, autor, tipo, conteudo, provedor, id_externo) values (c, 'atendente', 'texto', 'oi', 'uazapi', 't1');
  if (select adiada_ate from public.contatos_dados where id = c) is null then raise exception 'FAIL: mensagem da equipe reabriu a conversa'; end if;
  insert into public.mensagens_whatsapp(contato_id, autor, tipo, conteudo, provedor, id_externo) values (c, 'cliente', 'texto', 'e então?', 'uazapi', 't2');
  if (select adiada_ate from public.contatos_dados where id = c) is not null then raise exception 'FAIL: cliente escreveu e a conversa continuou adiada'; end if;

  -- vencidas: só as que passaram da hora, uma vez cada, e só o servidor chama
  update public.contatos_dados set adiada_ate = now() - interval '1 minute' where id = c;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  begin perform * from public.conversas_adiadas_vencidas(); raise exception 'FAIL: equipe chamou a função do vigia';
  exception when insufficient_privilege then null; end;
  reset role;
  select count(*) into n from public.conversas_adiadas_vencidas(); if n <> 1 then raise exception 'FAIL: deveria voltar 1 (%)', n; end if;
  select count(*) into n from public.conversas_adiadas_vencidas(); if n <> 0 then raise exception 'FAIL: voltou de novo (%)', n; end if;
  if (select adiada_ate from public.contatos_dados where id = c2) is null then raise exception 'FAIL: a que ainda não venceu voltou'; end if;
end $$;
