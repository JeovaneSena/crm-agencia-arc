-- Ensaio da 0009_modulo_assistente.
do $$
declare
  g uuid := gen_random_uuid(); k uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  v record; n integer;
begin
  insert into auth.users(id) values (g);
  insert into auth.users(id) values (k);
  update public.usuarios set papel = 'gestor' where id = g;
  update public.usuarios set papel = 'consultor' where id = k;
  insert into public.contatos_dados(id, nome, whatsapp) values (c, 'Cliente', '5511933330001');

  -- de fábrica: desligado, sem nada liberado
  select * into v from public.assistente_config;
  if v.modo <> 'desligada' or cardinality(v.numeros_teste) <> 0 or v.instrucoes is not null then raise exception 'FAIL: o assistente não nasce desligado (%)', v; end if;
  select count(*) into n from public.contatos_dados where id = c and ia_ligada;
  if n <> 0 then raise exception 'FAIL: contato nasceu com a IA ligada'; end if;
  begin
    insert into public.assistente_config(id) values (false);
    raise exception 'FAIL: segunda linha de configuração entrou';
  exception when check_violation or unique_violation then null; end;

  -- gestor salva; números ganham o 55 e não repetem
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', g::text, true);
  perform public.assistente_salvar_config('teste', 'Sofia', 'claude-sonnet-5-5', null, array['(11) 98854-1234', '5511988541234'], 10, 5);
  reset role;
  select * into v from public.assistente_config;
  if v.modo <> 'teste' or v.nome <> 'Sofia' or v.numeros_teste <> array['5511988541234'] or v.updated_by <> g then raise exception 'FAIL: configuração salva errada (%)', v; end if;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', g::text, true);
  -- teste sem número, ao vivo sem informações, modo e modelo inválidos
  begin perform public.assistente_salvar_config('teste', 'Sofia', 'claude-sonnet-5-5', null, '{}', 10, 5); raise exception 'FAIL: teste sem número passou';
  exception when sqlstate '22023' then null; end;
  begin perform public.assistente_salvar_config('ao_vivo', 'Sofia', 'claude-sonnet-5-5', 'curto', '{}', 10, 5); raise exception 'FAIL: ao vivo sem informações passou';
  exception when sqlstate '22023' then null; end;
  begin perform public.assistente_salvar_config('solto', 'Sofia', 'claude-sonnet-5-5', null, '{}', 10, 5); raise exception 'FAIL: modo inválido passou';
  exception when sqlstate '22023' then null; end;
  begin perform public.assistente_salvar_config('desligada', 'Sofia', 'modelo qualquer', null, '{}', 10, 5); raise exception 'FAIL: modelo inválido passou';
  exception when check_violation then null; end;
  begin perform public.assistente_salvar_config('teste', 'Sofia', 'claude-sonnet-5-5', null, array['123'], 10, 5); raise exception 'FAIL: número inválido passou';
  exception when sqlstate '22023' then null; end;
  perform public.assistente_salvar_config('ao_vivo', 'Sofia', 'gpt-5', 'Rua das Flores, 10. Abrimos de segunda a sexta, das 8h às 18h.', '{}', 10, 5);
  reset role;
  select modo into v from public.assistente_config;
  if v.modo <> 'ao_vivo' then raise exception 'FAIL: ao vivo com informações não salvou'; end if;

  -- consultor lê, mas não altera (nem pela função, nem direto)
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  select count(*) into n from public.assistente_config;
  if n <> 1 then raise exception 'FAIL: equipe não leu a configuração'; end if;
  begin perform public.assistente_salvar_config('desligada', 'X', 'claude-sonnet-5-5', null, '{}', 10, 5); raise exception 'FAIL: consultor alterou o assistente';
  exception when insufficient_privilege then null; end;
  begin update public.assistente_config set modo = 'desligada'; raise exception 'FAIL: consultor alterou a tabela direto';
  exception when insufficient_privilege then null; end;
  -- a equipe liga/desliga a IA numa conversa
  update public.contatos_dados set ia_ligada = true where id = c;
  reset role;
  set local role anon;
  begin perform 1 from public.assistente_config; raise exception 'FAIL: anon leu a configuração';
  exception when insufficient_privilege then null; end;
  begin perform public.assistente_salvar_config('desligada', 'X', 'claude-sonnet-5-5', null, '{}', 10, 5); raise exception 'FAIL: anon executou a função';
  exception when insufficient_privilege then null; end;
  reset role;

  -- respostas: uma por mensagem; só o gestor lê; a lista traz o estado da IA
  declare m uuid := gen_random_uuid(); begin
    insert into public.mensagens_whatsapp(id, contato_id, autor, conteudo, id_externo) values (m, c, 'cliente', 'oi', 'a-1');
    insert into public.assistente_respostas(mensagem_id, contato_id) values (m, c);
    begin insert into public.assistente_respostas(mensagem_id, contato_id) values (m, c); raise exception 'FAIL: resposta em dobro entrou';
    exception when unique_violation then null; end;
    begin update public.assistente_respostas set estado = 'enviando' where mensagem_id = m; raise exception 'FAIL: estado fora do contrato entrou';
    exception when check_violation then null; end;
    select * into v from public.conversas_lista where contato_id = c;
    if not v.ia_ligada or v.ia_encaminhada_em is not null then raise exception 'FAIL: conversas_lista sem o estado da IA (%)', v; end if;
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', k::text, true);
    select count(*) into n from public.assistente_respostas;
    if n <> 0 then raise exception 'FAIL: consultor leu o registro das respostas'; end if;
    reset role;
    delete from public.contatos_dados where id = c;
    select count(*) into n from public.assistente_respostas where mensagem_id = m;
    if n <> 0 then raise exception 'FAIL: resposta sobreviveu ao contato'; end if;
  end;
end;
$$;
