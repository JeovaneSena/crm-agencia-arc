-- Ensaio da 0018_responsavel_e_lote.
do $$
declare
  g uuid := gen_random_uuid(); k uuid := gen_random_uuid(); off uuid := gen_random_uuid();
  c uuid := gen_random_uuid(); o1 uuid; o2 uuid; o3 uuid; ganha uuid; ids uuid[] := '{}'; i integer; n integer; v record;
begin
  insert into auth.users(id) values (g); insert into auth.users(id) values (k); insert into auth.users(id) values (off);
  update public.usuarios set papel = 'gestor' where id = g;
  update public.usuarios set papel = 'consultor' where id in (k, off);
  update public.usuarios set ativo = false where id = off;
  insert into public.contatos_dados(id, nome, whatsapp) values (c, 'Cliente', '5511933330018');
  insert into public.catalogo_servicos(nome, descricao) values ('Serviço Lote', 'x');

  -- quem cria é o responsável; pelo servidor (sem sessão) fica vazio
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  insert into public.oportunidades(contato_id, nome) values (c, 'Venda 1') returning id into o1;
  insert into public.oportunidades(contato_id, nome) values (c, 'Venda 2') returning id into o2;
  insert into public.oportunidades(contato_id, nome, responsavel_id) values (c, 'Venda 3', g) returning id into o3;
  reset role;
  if (select responsavel_id from public.oportunidades where id = o1) <> k then raise exception 'FAIL: criador não virou responsável'; end if;
  if (select responsavel_id from public.oportunidades where id = o3) <> g then raise exception 'FAIL: responsável informado foi ignorado'; end if;
  perform set_config('request.jwt.claim.sub', '', true);   -- sem sessão, como a Edge Function (service_role)
  insert into public.oportunidades(contato_id, nome) values (c, 'Do servidor') returning id into ganha;
  if (select responsavel_id from public.oportunidades where id = ganha) is not null then raise exception 'FAIL: servidor deveria deixar sem responsável'; end if;

  -- responsável: só pessoa ativa; trocar e limpar
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  begin update public.oportunidades set responsavel_id = off where id = o1; raise exception 'FAIL: responsável desligado';
  exception when sqlstate '22023' then null; end;
  begin update public.oportunidades set responsavel_id = gen_random_uuid() where id = o1; raise exception 'FAIL: responsável inexistente';
  exception when sqlstate '22023' then null; end;
  update public.oportunidades set responsavel_id = g where id = o1;
  update public.oportunidades set responsavel_id = null where id = o2;
  reset role;
  if (select responsavel_id from public.oportunidades where id = o1) <> g or (select responsavel_id from public.oportunidades where id = o2) is not null then raise exception 'FAIL: troca/limpeza de responsável'; end if;

  -- venda ganha aceita trocar o responsável (o resto segue congelado)
  update public.oportunidades set status = 'ganho', valor_proposta = 100, servicos_contratados = array['Serviço Lote'] where id = o3;
  update public.oportunidades set responsavel_id = k where id = o3;
  if (select responsavel_id from public.oportunidades where id = o3) <> k then raise exception 'FAIL: não trocou o responsável da venda ganha'; end if;

  -- lote: mover etapa (tudo ou nada, só etapas em andamento, até 50)
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  n := public.oportunidades_mover_em_lote(array[o1, o2, o1], 'proposta');       -- repetido conta uma vez
  if n <> 2 then raise exception 'FAIL: deveria mover 2 (%)', n; end if;
  begin perform public.oportunidades_mover_em_lote(array[o1, o3], 'negociacao'); raise exception 'FAIL: moveu junto uma venda ganha';
  exception when sqlstate '22023' then null; end;
  begin perform public.oportunidades_mover_em_lote(array[o1], 'ganho'); raise exception 'FAIL: lote moveu para ganho';
  exception when sqlstate '22023' then null; end;
  begin perform public.oportunidades_mover_em_lote(array[o1], 'etapa_que_nao_existe'); raise exception 'FAIL: etapa inexistente';
  exception when sqlstate '22023' then null; end;
  begin perform public.oportunidades_mover_em_lote('{}', 'proposta'); raise exception 'FAIL: lote vazio';
  exception when sqlstate '22023' then null; end;
  reset role;
  if (select status from public.oportunidades where id = o1) <> 'proposta' then raise exception 'FAIL: o lote com erro alterou algo (all-or-nothing)'; end if;
  select count(*) into n from public.oportunidade_eventos where oportunidade_id in (o1, o2) and status_novo = 'proposta' and usuario_id = k;
  if n <> 2 then raise exception 'FAIL: o histórico deveria registrar quem moveu (%)', n; end if;

  -- limite de 50
  for i in 1..51 loop
    insert into public.oportunidades(contato_id, nome) values (c, 'Massa ' || i) returning id into o2;
    ids := ids || o2;
  end loop;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  begin perform public.oportunidades_mover_em_lote(ids, 'qualificacao'); raise exception 'FAIL: passou de 50';
  exception when sqlstate '22023' then null; end;
  if public.oportunidades_mover_em_lote(ids[1:50], 'qualificacao') <> 50 then raise exception 'FAIL: não moveu 50'; end if;

  -- lote de responsável: troca todos, ou nenhum se um responsável for inválido
  if public.oportunidades_definir_responsavel_em_lote(ids[1:10], g) <> 10 then raise exception 'FAIL: não trocou 10'; end if;
  begin perform public.oportunidades_definir_responsavel_em_lote(ids[1:3], off); raise exception 'FAIL: lote com responsável desligado';
  exception when sqlstate '22023' then null; end;
  begin perform public.oportunidades_definir_responsavel_em_lote(array[ids[1], gen_random_uuid()], k); raise exception 'FAIL: lote com id inexistente';
  exception when sqlstate '22023' then null; end;
  perform public.oportunidades_definir_responsavel_em_lote(ids[1:2], null);
  reset role;
  select count(*) into n from public.oportunidades where id = any(ids[3:10]) and responsavel_id = g; if n <> 8 then raise exception 'FAIL: lotes com erro alteraram dados (%)', n; end if;
  select count(*) into n from public.oportunidades where id = any(ids[1:2]) and responsavel_id is null; if n <> 2 then raise exception 'FAIL: limpar em lote (%)', n; end if;

  -- anon não chama
  set local role anon;
  begin perform public.oportunidades_mover_em_lote(array[o1], 'proposta'); raise exception 'FAIL: anon moveu em lote';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;
