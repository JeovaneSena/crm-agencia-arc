-- Ensaio da 0011_central_de_avisos.
do $$
declare
  g uuid := gen_random_uuid(); k uuid := gen_random_uuid(); fora uuid := gen_random_uuid();
  a1 uuid; a2 uuid; a3 uuid; v record; n integer;
begin
  insert into auth.users(id) values (g);
  insert into auth.users(id) values (k);
  insert into auth.users(id) values (fora);
  update public.usuarios set papel = 'gestor' where id = g;
  update public.usuarios set papel = 'consultor' where id = k;
  update public.usuarios set ativo = false where id = fora;

  -- abre; repetir não cria outra linha, só conta
  a1 := public.aviso_abrir('mensagem_presa', 'x', 'atencao', 'Mensagem não saiu', 'detalhe 1', '/conversas');
  a2 := public.aviso_abrir('mensagem_presa', 'x', 'atencao', 'Mensagem não saiu', 'detalhe 2', '/conversas');
  if a1 is null or a1 <> a2 then raise exception 'FAIL: repetição abriu outro aviso (% / %)', a1, a2; end if;
  select * into v from public.avisos where id = a1;
  if v.ocorrencias <> 2 or v.detalhe <> 'detalhe 2' then raise exception 'FAIL: repetição não atualizou (%)', v; end if;

  -- a gravidade sobe, nunca desce
  perform public.aviso_abrir('mensagem_presa', 'x', 'critico', 'Mensagem não saiu', null, '/conversas');
  perform public.aviso_abrir('mensagem_presa', 'x', 'info', 'Mensagem não saiu', null, '/conversas');
  select * into v from public.avisos where id = a1;
  if v.gravidade <> 'critico' or v.ocorrencias <> 4 then raise exception 'FAIL: gravidade desceu ou contagem errada (%)', v; end if;

  -- chaves diferentes são avisos diferentes; chave vazia é uma chave
  a3 := public.aviso_abrir('mensagem_presa', 'y', 'info', 'Outra');
  if a3 = a1 then raise exception 'FAIL: chaves diferentes colidiram'; end if;
  perform public.aviso_abrir('conexao_caida', null, 'critico', 'WhatsApp caiu', null, null, null, true);
  perform public.aviso_abrir('conexao_caida', '', 'critico', 'WhatsApp caiu', null, null, null, true);
  select count(*) into n from public.avisos where tipo = 'conexao_caida';
  if n <> 1 then raise exception 'FAIL: chave nula e vazia deveriam ser o mesmo aviso (%)', n; end if;

  -- validações
  begin perform public.aviso_abrir('Tipo Ruim', '', 'info', 't'); raise exception 'FAIL: tipo inválido passou';
  exception when check_violation then null; end;
  begin perform public.aviso_abrir('ok_tipo', '', 'grave', 't'); raise exception 'FAIL: gravidade inválida passou';
  exception when sqlstate '22023' then null; end;
  begin perform public.aviso_abrir('ok_tipo', '', 'info', ''); raise exception 'FAIL: título vazio passou';
  exception when check_violation then null; end;
  begin perform public.aviso_abrir('ok_tipo', '', 'info', 't', null, 'https://externo.example/x'); raise exception 'FAIL: rota externa passou';
  exception when check_violation then null; end;
  begin perform public.aviso_abrir('ok_tipo', '', 'info', 't', null, '//externo.example'); raise exception 'FAIL: rota // passou';
  exception when check_violation then null; end;
  begin perform public.aviso_abrir('ok_tipo', '', 'info', 't', null, null, null, false, 999); raise exception 'FAIL: silêncio absurdo passou';
  exception when sqlstate '22023' then null; end;

  -- leitura: consultor não vê o "só gestor"; gestor vê
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  select count(*) into n from public.avisos where tipo = 'conexao_caida';
  if n <> 0 then raise exception 'FAIL: consultor viu aviso só do gestor'; end if;
  select count(*) into n from public.avisos where tipo = 'mensagem_presa';
  if n <> 2 then raise exception 'FAIL: consultor não viu os avisos da equipe (%)', n; end if;
  -- e não escreve direto, nem abre aviso pela API
  begin update public.avisos set titulo = 'x'; raise exception 'FAIL: consultor escreveu direto';
  exception when insufficient_privilege then null; end;
  begin perform public.aviso_abrir('ok_tipo', '', 'info', 't'); raise exception 'FAIL: consultor abriu aviso';
  exception when insufficient_privilege then null; end;
  begin perform public.avisos_expurgar(30); raise exception 'FAIL: consultor expurgou';
  exception when insufficient_privilege then null; end;
  -- dispensar o aviso só do gestor: nega
  begin
    perform public.aviso_dispensar((select id from public.avisos where tipo = 'conexao_caida' and resolvido_em is null) );
    raise exception 'FAIL: consultor dispensou aviso do gestor';
  exception when sqlstate 'P0002' then null; end;
  -- dispensar o da equipe: ok
  perform public.aviso_dispensar(a1);
  reset role;

  select * into v from public.avisos where id = a1;
  if v.resolucao <> 'manual' or v.resolvido_por <> k or v.resolvido_em is null then raise exception 'FAIL: dispensa não gravou quem (%)', v; end if;

  -- anon e usuário inativo: nada
  set local role anon;
  begin perform public.aviso_dispensar(a1); raise exception 'FAIL: anon dispensou';
  exception when insufficient_privilege then null; end;
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', fora::text, true);
  begin perform public.aviso_dispensar(a3); raise exception 'FAIL: usuário inativo dispensou';
  exception when sqlstate '42501' then null; end;
  reset role;

  -- silêncio: depois de dispensado, a repetição imediata NÃO reabre
  if public.aviso_abrir('mensagem_presa', 'x', 'critico', 'Mensagem não saiu') is not null then
    raise exception 'FAIL: reabriu aviso dispensado dentro do silêncio';
  end if;
  -- com silêncio zero, reabre como aviso novo
  if public.aviso_abrir('mensagem_presa', 'x', 'critico', 'Mensagem não saiu', null, null, null, false, 0) is null then
    raise exception 'FAIL: não reabriu com silêncio 0';
  end if;
  select count(*) into n from public.avisos where tipo = 'mensagem_presa' and chave = 'x' and resolvido_em is null;
  if n <> 1 then raise exception 'FAIL: deveria haver 1 aviso aberto (%)', n; end if;

  -- resolução automática: por chave e por tipo
  if public.aviso_resolver_auto('mensagem_presa', 'x') <> 1 then raise exception 'FAIL: resolver por chave'; end if;
  if public.aviso_resolver_auto('mensagem_presa') <> 1 then raise exception 'FAIL: resolver por tipo (sobrou o y)'; end if;
  if public.aviso_resolver_auto('mensagem_presa') <> 0 then raise exception 'FAIL: resolver repetido deveria ser 0'; end if;

  -- gestor dispensa o aviso só dele
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', g::text, true);
  perform public.aviso_dispensar((select id from public.avisos where tipo = 'conexao_caida' and resolvido_em is null));
  reset role;

  -- expurgo respeita o piso e só apaga resolvido antigo
  begin perform public.avisos_expurgar(7); raise exception 'FAIL: expurgo abaixo do piso passou';
  exception when sqlstate '22023' then null; end;
  update public.avisos set resolvido_em = now() - interval '100 days' where id = a1;
  if public.avisos_expurgar(90) <> 1 then raise exception 'FAIL: expurgo não apagou o antigo'; end if;
  select count(*) into n from public.avisos where id = a1;
  if n <> 0 then raise exception 'FAIL: aviso antigo ficou'; end if;
  select count(*) into n from public.avisos where resolvido_em is not null and resolvido_em > now() - interval '1 day';
  if n < 1 then raise exception 'FAIL: expurgo apagou resolvido recente'; end if;

  -- contato apagado leva os avisos dele
  declare c uuid := gen_random_uuid(); begin
    insert into public.contatos_dados(id, nome, whatsapp) values (c, 'Cliente', '5511933330077');
    perform public.aviso_abrir('contato_sem_resposta', c::text, 'atencao', 'Sem resposta', null, '/conversas', c);
    delete from public.contatos_dados where id = c;
    select count(*) into n from public.avisos where contato_id = c;
    if n <> 0 then raise exception 'FAIL: aviso sobreviveu ao contato'; end if;
  end;
end $$;
