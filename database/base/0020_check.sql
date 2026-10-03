-- Ensaio da 0020_tarefas.
do $$
declare
  g uuid := gen_random_uuid(); k uuid := gen_random_uuid(); k2 uuid := gen_random_uuid(); off uuid := gen_random_uuid();
  c uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); o1 uuid; o2 uuid;
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; n integer; v record;
begin
  insert into auth.users(id) values (g); insert into auth.users(id) values (k); insert into auth.users(id) values (k2); insert into auth.users(id) values (off);
  update public.usuarios set papel = 'gestor' where id = g;
  update public.usuarios set papel = 'consultor' where id in (k, k2, off);
  update public.usuarios set ativo = false where id = off;
  insert into public.contatos_dados(id, nome, whatsapp) values (c, 'Cliente', '5511933330020');
  insert into public.contatos_dados(id, nome, whatsapp) values (c2, 'Outro cliente', '5511933330021');
  insert into public.oportunidades(contato_id, nome) values (c, 'Venda do cliente') returning id into o1;
  insert into public.oportunidades(contato_id, nome) values (c2, 'Venda do outro') returning id into o2;

  -- criar: quem cria é o responsável e a autoria é do banco; o navegador não escolhe a origem
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  insert into public.tarefas(titulo, vence_em, contato_id, oportunidade_id) values ('Ligar para confirmar a proposta', now() - interval '2 days', c, o1) returning id into t1;
  insert into public.tarefas(titulo, vence_em, responsavel_id) values ('Revisar a agenda da semana', now() + interval '2 days', k2) returning id into t2;
  begin insert into public.tarefas(titulo, vence_em, origem) values ('Disfarçada de sistema', now(), 'sistema'); raise exception 'FAIL: o navegador definiu a origem';
  exception when insufficient_privilege then null; end;
  begin insert into public.tarefas(titulo, vence_em, criada_por) values ('Autoria falsa', now(), g); raise exception 'FAIL: o navegador definiu a autoria';
  exception when insufficient_privilege then null; end;
  reset role;
  select * into v from public.tarefas where id = t1;
  if v.criada_por <> k or v.responsavel_id <> k or v.origem <> 'manual' then raise exception 'FAIL: criador deveria ser autor e responsável'; end if;
  if (select responsavel_id from public.tarefas where id = t2) <> k2 or (select criada_por from public.tarefas where id = t2) <> k then raise exception 'FAIL: responsável informado foi ignorado'; end if;

  -- pelo servidor (sem sessão) a tarefa fica sem autor e sem responsável, e pode ser "do sistema"
  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.tarefas(titulo, vence_em, contato_id, origem) values ('Tarefa do sistema', now() - interval '1 hour', c2, 'sistema') returning id into t3;
  if (select criada_por from public.tarefas where id = t3) is not null or (select responsavel_id from public.tarefas where id = t3) is not null then raise exception 'FAIL: servidor deveria deixar autor e responsável vazios'; end if;

  -- validações de dados
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  begin insert into public.tarefas(titulo, vence_em) values ('   ', now()); raise exception 'FAIL: título vazio';
  exception when check_violation then null; end;
  begin insert into public.tarefas(titulo, vence_em) values (repeat('x', 201), now()); raise exception 'FAIL: título enorme';
  exception when check_violation then null; end;
  begin insert into public.tarefas(titulo, vence_em, detalhe) values ('Ok', now(), repeat('x', 1001)); raise exception 'FAIL: detalhe enorme';
  exception when check_violation then null; end;
  begin insert into public.tarefas(titulo, vence_em) values ('Sem prazo', null); raise exception 'FAIL: sem prazo';
  exception when not_null_violation then null; end;
  begin insert into public.tarefas(titulo, vence_em, contato_id, oportunidade_id) values ('Oportunidade de outro contato', now(), c, o2); raise exception 'FAIL: oportunidade de outro contato';
  exception when foreign_key_violation then null; end;
  begin insert into public.tarefas(titulo, vence_em, oportunidade_id) values ('Oportunidade sem contato', now(), o1); raise exception 'FAIL: oportunidade sem contato';
  exception when check_violation then null; end;
  begin insert into public.tarefas(titulo, vence_em, responsavel_id) values ('Responsável desligado', now(), off); raise exception 'FAIL: responsável desligado';
  exception when sqlstate '22023' then null; end;
  begin insert into public.tarefas(titulo, vence_em, responsavel_id) values ('Responsável inexistente', now(), gen_random_uuid()); raise exception 'FAIL: responsável inexistente';
  exception when sqlstate '22023' then null; end;

  -- editar: título, prazo e responsável; o resto é só do servidor
  update public.tarefas set titulo = 'Ligar e confirmar', vence_em = now() + interval '1 day', responsavel_id = k2 where id = t1;
  begin update public.tarefas set responsavel_id = off where id = t1; raise exception 'FAIL: trocou para responsável desligado';
  exception when sqlstate '22023' then null; end;
  begin update public.tarefas set concluida_em = now() where id = t1; raise exception 'FAIL: concluiu sem passar pela função';
  exception when insufficient_privilege then null; end;
  begin update public.tarefas set origem = 'sistema' where id = t1; raise exception 'FAIL: mudou a origem';
  exception when insufficient_privilege then null; end;
  update public.tarefas set responsavel_id = null where id = t1;
  reset role;
  if (select titulo from public.tarefas where id = t1) <> 'Ligar e confirmar' then raise exception 'FAIL: edição não gravou'; end if;
  if (select responsavel_id from public.tarefas where id = t1) is not null then raise exception 'FAIL: não limpou o responsável'; end if;

  -- concluir e reabrir: registra quem e quando; repetir não troca o autor
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  perform public.tarefa_concluir(t2);
  perform set_config('request.jwt.claim.sub', k2::text, true);
  perform public.tarefa_concluir(t2);
  reset role;
  select * into v from public.tarefas where id = t2;
  if v.concluida_em is null or v.concluida_por <> k then raise exception 'FAIL: concluir deveria guardar quem concluiu primeiro'; end if;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k2::text, true);
  perform public.tarefa_concluir(t2, false);
  reset role;
  select * into v from public.tarefas where id = t2;
  if v.concluida_em is not null or v.concluida_por is not null then raise exception 'FAIL: reabrir deveria limpar a conclusão'; end if;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  begin perform public.tarefa_concluir(gen_random_uuid()); raise exception 'FAIL: concluiu tarefa inexistente';
  exception when sqlstate 'P0002' then null; end;
  reset role;
  -- quem foi desligado não conclui
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', off::text, true);
  begin perform public.tarefa_concluir(t2); raise exception 'FAIL: usuário desligado concluiu';
  exception when sqlstate '42501' then null; end;
  reset role;

  -- apagar: autor, responsável ou gestor; outra pessoa da equipe não
  insert into public.tarefas(titulo, vence_em, criada_por, responsavel_id) values ('De outra pessoa', now(), k, k) returning id into t4;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k2::text, true);
  delete from public.tarefas where id = t4;
  reset role;
  if not exists (select 1 from public.tarefas where id = t4) then raise exception 'FAIL: quem não é autor, responsável nem gestor apagou'; end if;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  delete from public.tarefas where id = t4;
  reset role;
  if exists (select 1 from public.tarefas where id = t4) then raise exception 'FAIL: o autor não conseguiu apagar'; end if;
  insert into public.tarefas(titulo, vence_em, criada_por, responsavel_id) values ('Do gestor apagar', now(), k, k) returning id into t4;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', g::text, true);
  delete from public.tarefas where id = t4;
  reset role;
  if exists (select 1 from public.tarefas where id = t4) then raise exception 'FAIL: o gestor não conseguiu apagar'; end if;

  -- vencidas por responsável: só abertas com prazo no passado; sem responsável vem como linha própria
  perform set_config('request.jwt.claim.sub', '', true);
  delete from public.tarefas where id not in (t1, t2, t3);
  update public.tarefas set vence_em = now() - interval '3 days' where id = t1;     -- aberta, vencida, sem responsável
  update public.tarefas set vence_em = now() + interval '1 day' where id = t2;      -- aberta, no prazo
  insert into public.tarefas(titulo, vence_em, responsavel_id, criada_por) values ('Vencida da Ana', now() - interval '2 hours', k, k);
  insert into public.tarefas(titulo, vence_em, responsavel_id, criada_por) values ('Outra vencida da Ana', now() - interval '5 hours', k, k);
  insert into public.tarefas(titulo, vence_em, responsavel_id, criada_por, concluida_em, concluida_por) values ('Vencida mas feita', now() - interval '9 days', k, k, now(), k);
  select count(*) into n from public.tarefas_vencidas_por_responsavel();
  if n <> 2 then raise exception 'FAIL: deveria haver 2 grupos de vencidas (%)', n; end if;
  select * into v from public.tarefas_vencidas_por_responsavel() where responsavel_id = k;
  if v.quantidade <> 2 then raise exception 'FAIL: a pessoa tem 2 vencidas abertas (%)', v.quantidade; end if;
  select * into v from public.tarefas_vencidas_por_responsavel() where responsavel_id is null;
  if v.quantidade <> 2 then raise exception 'FAIL: sem responsável deveriam ser 2 (t1 e a do sistema) (%)', v.quantidade; end if;

  -- aviso_resolver_exceto: fecha só o que não está na lista
  perform public.aviso_abrir('tarefas_vencidas', 'a', 'atencao', 'A tem 2');
  perform public.aviso_abrir('tarefas_vencidas', 'b', 'atencao', 'B tem 1');
  perform public.aviso_abrir('tarefas_vencidas', 'c', 'atencao', 'C tem 4');
  perform public.aviso_abrir('outro_tipo', 'a', 'atencao', 'Não é meu');
  if public.aviso_resolver_exceto('tarefas_vencidas', array['b']) <> 2 then raise exception 'FAIL: deveria fechar a e c'; end if;
  select count(*) into n from public.avisos where tipo = 'tarefas_vencidas' and resolvido_em is null and chave = 'b'; if n <> 1 then raise exception 'FAIL: fechou o aviso que devia ficar'; end if;
  select count(*) into n from public.avisos where tipo = 'outro_tipo' and resolvido_em is null; if n <> 1 then raise exception 'FAIL: fechou aviso de outro tipo'; end if;
  if public.aviso_resolver_exceto('tarefas_vencidas', '{}') <> 1 then raise exception 'FAIL: lista vazia deveria fechar o resto'; end if;
  if public.aviso_resolver_exceto('tarefas_vencidas', null) <> 0 then raise exception 'FAIL: nada sobrando para fechar'; end if;

  -- apagar o contato leva as tarefas dele; apagar o usuário não apaga a tarefa (e quem criou tem histórico)
  if not public.usuario_tem_historico(k) then raise exception 'FAIL: quem criou tarefa deveria ter histórico'; end if;
  insert into public.tarefas(titulo, vence_em, contato_id) values ('Some com o contato', now(), c2);
  delete from public.contatos_dados where id = c2;
  select count(*) into n from public.tarefas where contato_id = c2; if n <> 0 then raise exception 'FAIL: tarefa sobreviveu ao contato (%)', n; end if;

  -- permissões: anon não toca; consultor não chama as funções do vigia
  set local role anon;
  begin perform public.tarefa_concluir(t2); raise exception 'FAIL: anon concluiu';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.tarefas; raise exception 'FAIL: anon leu tarefas';
  exception when insufficient_privilege then null; end;
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  begin perform public.tarefas_vencidas_por_responsavel(); raise exception 'FAIL: equipe chamou a função do vigia';
  exception when insufficient_privilege then null; end;
  begin perform public.aviso_resolver_exceto('tarefas_vencidas', '{}'); raise exception 'FAIL: equipe chamou aviso_resolver_exceto';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;
