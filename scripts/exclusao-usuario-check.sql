-- Executado na mesma transacao da migracao; termina em rollback.
do $$
declare
  v_livre uuid := gen_random_uuid();
  v_com_historico uuid := gen_random_uuid();
  v_bloqueado boolean := false;
begin
  insert into auth.users(id, raw_user_meta_data)
  values (v_livre, jsonb_build_object('nome', 'Conta sem historico', 'papel', 'consultor'));
  if public.usuario_tem_historico(v_livre) then
    raise exception 'Conta nova apareceu com historico';
  end if;
  delete from auth.users where id = v_livre;
  if exists (select 1 from public.usuarios where id = v_livre) then
    raise exception 'Conta sem historico permaneceu em usuarios';
  end if;

  insert into auth.users(id, raw_user_meta_data)
  values (v_com_historico, jsonb_build_object('nome', 'Conta com historico', 'papel', 'consultor'));
  update public.configuracoes_agente
     set atualizado_por = v_com_historico
   where id = (select id from public.configuracoes_agente limit 1);
  if not found then raise exception 'Configuracao do agente nao encontrada para o ensaio'; end if;
  if not public.usuario_tem_historico(v_com_historico) then
    raise exception 'Historico em configuracoes_agente nao foi detectado';
  end if;
  begin
    delete from auth.users where id = v_com_historico;
  exception when foreign_key_violation then
    v_bloqueado := true;
  end;
  if not v_bloqueado then raise exception 'Conta com historico foi excluida'; end if;
end;
$$;
