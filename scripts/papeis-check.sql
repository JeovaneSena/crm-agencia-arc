-- Ensaio das invariantes da migracao 0033 (gestor e consultores).
-- Roda dentro da transacao da propria migracao e termina em rollback: nada
-- escrito aqui sobrevive. Falha = exception; sucesso = silencio.
do $$
declare
  g0 uuid;                     -- o gestor que a migracao deixou de pe
  c1 uuid := gen_random_uuid();  -- consultor por omissao
  c2 uuid := gen_random_uuid();  -- consultor por papel invalido no convite
  g1 uuid := gen_random_uuid();  -- gestor pedido no convite
  p1 uuid; p2 uuid;
  n integer; t text;
begin
  -- ------------------------------------------------------------- backfill
  select count(*) into n from public.usuarios where papel = 'gestor' and ativo;
  if n = 0 then raise exception 'A migracao nao deixou nenhum gestor ativo'; end if;

  select id into g0 from public.usuarios
   where papel = 'gestor' and ativo order by created_at, id limit 1;

  -- Deixa exatamente um gestor, que e o cenario que as travas protegem.
  -- Rebaixar os excedentes tem que ser permitido: a trava e do ultimo, nao
  -- de qualquer um.
  update public.usuarios set papel = 'consultor'
   where papel = 'gestor' and ativo and id <> g0;
  select count(*) into n from public.usuarios where papel = 'gestor' and ativo;
  if n <> 1 then raise exception 'Deveria restar 1 gestor para o ensaio, restaram %', n; end if;

  -- --------------------------------------------------- papel na conta nova
  insert into auth.users(id) values (c1);
  select papel into t from public.usuarios where id = c1;
  if t <> 'consultor' then raise exception 'Conta sem papel no convite nasceu %', t; end if;

  insert into auth.users(id, raw_user_meta_data)
  values (c2, jsonb_build_object('nome','Papel Estranho','papel','dono'));
  select papel into t from public.usuarios where id = c2;
  if t <> 'consultor' then raise exception 'Papel invalido no convite virou %', t; end if;

  insert into auth.users(id, raw_user_meta_data)
  values (g1, jsonb_build_object('nome','Gestora Convidada','papel','gestor'));
  select papel into t from public.usuarios where id = g1;
  if t <> 'gestor' then raise exception 'Convite de gestor nasceu %', t; end if;

  -- O convite tambem tem que trazer o nome, senao a tela de Usuarios lista
  -- linha em branco ate a pessoa entrar pela primeira vez.
  select nome into t from public.usuarios where id = g1;
  if t <> 'Gestora Convidada' then raise exception 'Nome do convite nao chegou: %', t; end if;

  -- ------------------------------------------------------ o ultimo gestor
  -- Com g1 gestor, rebaixar g0 e legitimo e tem que passar.
  update public.usuarios set papel = 'consultor' where id = g0;
  select papel into t from public.usuarios where id = g0;
  if t <> 'consultor' then raise exception 'Rebaixar gestor com sucessor falhou'; end if;
  update public.usuarios set papel = 'gestor' where id = g0;

  -- Agora g1 volta a ser consultor e g0 fica sozinho: as tres saidas travam.
  update public.usuarios set papel = 'consultor' where id = g1;

  begin
    update public.usuarios set papel = 'consultor' where id = g0;
    raise exception 'UNEXPECTED rebaixar o ultimo gestor foi aceito';
  exception when others then if sqlerrm like 'UNEXPECTED%' then raise; end if; end;

  begin
    update public.usuarios set ativo = false where id = g0;
    raise exception 'UNEXPECTED desativar o ultimo gestor foi aceito';
  exception when others then if sqlerrm like 'UNEXPECTED%' then raise; end if; end;

  -- O caminho indireto: apagar em auth.users chega em usuarios pelo cascade.
  begin
    delete from auth.users where id = g0;
    raise exception 'UNEXPECTED apagar o ultimo gestor foi aceito';
  exception when others then if sqlerrm like 'UNEXPECTED%' then raise; end if; end;

  select papel || '/' || ativo::text into t from public.usuarios where id = g0;
  if t <> 'gestor/true' then raise exception 'O ultimo gestor sobreviveu como %', t; end if;

  -- Desativar consultor nunca foi travado.
  update public.usuarios set ativo = false where id = c2;
  update public.usuarios set ativo = true  where id = c2;

  -- ------------------------------------------------------------- quem e quem
  if not public.usuario_e_gestor(g0) then raise exception 'usuario_e_gestor nao reconheceu o gestor'; end if;
  if public.usuario_e_gestor(c1) then raise exception 'usuario_e_gestor aprovou um consultor'; end if;
  if public.usuario_e_gestor(null) then raise exception 'usuario_e_gestor aprovou sessao vazia'; end if;

  begin
    perform public.exigir_gestor(c1);
    raise exception 'UNEXPECTED exigir_gestor deixou consultor passar';
  exception when others then if sqlerrm like 'UNEXPECTED%' then raise; end if; end;
  perform public.exigir_gestor(g0);

  -- ---------------------------------------------------------- campanhas
  -- Gestor passa SEM a coluna: e o freio de emergencia do plano.
  update public.usuarios set pode_gerenciar_campanhas = false where id = g0;
  perform public.whatsapp_campanha_exigir_permissao(g0);
  -- E pelo nome antigo tambem, que lembretes-servico.ts ainda chama.
  perform public.whatsapp_campanha_exigir_gestor(g0);

  -- Consultor passa COM a coluna: campanhas nao e exclusiva do gestor.
  update public.usuarios set pode_gerenciar_campanhas = true where id = c1;
  perform public.whatsapp_campanha_exigir_permissao(c1);

  -- Consultor sem a coluna, nao.
  begin
    perform public.whatsapp_campanha_exigir_permissao(c2);
    raise exception 'UNEXPECTED consultor sem permissao gerenciou campanha';
  exception when others then if sqlerrm like 'UNEXPECTED%' then raise; end if; end;

  -- Conta desligada nao gerencia nada, nem com a coluna ligada.
  update public.usuarios set ativo = false where id = c1;
  begin
    perform public.whatsapp_campanha_exigir_permissao(c1);
    raise exception 'UNEXPECTED conta desativada gerenciou campanha';
  exception when others then if sqlerrm like 'UNEXPECTED%' then raise; end if; end;
  update public.usuarios set ativo = true where id = c1;

  -- ------------------------------------------------------- vinculo com a agenda
  insert into public.profissionais(nome) values ('Ensaio Papeis') returning id into p1;
  update public.usuarios set profissional_id = p1 where id = c1;
  begin
    update public.usuarios set profissional_id = p1 where id = c2;
    raise exception 'UNEXPECTED dois logins apontaram para o mesmo profissional';
  exception when others then if sqlerrm like 'UNEXPECTED%' then raise; end if; end;

  -- Profissional apagado nao leva o login junto: a conta so perde a agenda.
  delete from public.profissionais where id = p1;
  select count(*) into n from public.usuarios where id = c1;
  if n <> 1 then raise exception 'Apagar o profissional apagou a conta de login'; end if;
  select profissional_id into p2 from public.usuarios where id = c1;
  if p2 is not null then raise exception 'Vinculo orfao sobreviveu ao profissional'; end if;

  -- --------------------------------------------------------------- acesso
  -- A trava de auto-promocao e o grant por coluna da 0031, nao uma policy.
  if has_column_privilege('authenticated','public.usuarios','papel','update')
     or has_column_privilege('authenticated','public.usuarios','ativo','update')
     or has_column_privilege('authenticated','public.usuarios','profissional_id','update')
     or has_column_privilege('authenticated','public.usuarios','pode_gerenciar_campanhas','update') then
    raise exception 'O navegador pode editar coluna de poder em usuarios';
  end if;
  if not has_column_privilege('authenticated','public.usuarios','nome','update') then
    raise exception 'A equipe perdeu a edicao do proprio nome';
  end if;
  if not has_table_privilege('authenticated','public.usuarios','select') then
    raise exception 'A equipe perdeu a leitura dos perfis';
  end if;

  if has_function_privilege('authenticated','public.whatsapp_campanha_exigir_permissao(uuid)','execute')
     or has_function_privilege('authenticated','public.whatsapp_campanha_exigir_gestor(uuid)','execute')
     or has_function_privilege('authenticated','public.exigir_gestor(uuid)','execute') then
    raise exception 'Funcao de permissao ficou exposta ao navegador';
  end if;
  if not has_function_privilege('authenticated','public.usuario_e_gestor(uuid)','execute') then
    raise exception 'A tela perdeu como saber quem e gestor';
  end if;

  raise notice 'Ensaio de papeis concluido sem violacao de invariante.';
end;
$$;
