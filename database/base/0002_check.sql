-- Ensaio da 0002_nucleo_configuravel: roda dentro da transação da própria
-- migração, revertida por SAVEPOINT (apply) ou ROLLBACK (rehearse).
do $$
declare
  g1 uuid := gen_random_uuid();  -- gestor
  c1 uuid := gen_random_uuid();  -- consultor
  n integer; t text;
begin
  insert into auth.users(id) values (g1);
  insert into auth.users(id) values (c1);
  update public.usuarios set papel = 'consultor' where id = c1;

  select count(*) into n from public.etapas_funil;
  if n <> 8 then raise exception 'Esperava 8 etapas semeadas, achei %', n; end if;

  select count(distinct ordem) into n from public.etapas_funil;
  if n <> 8 then raise exception 'Ordem das etapas deveria ser única, só há % valores distintos', n; end if;

  select rotulo into t from public.etapas_funil where chave = 'diagnostico_realizado';
  if t is null then raise exception 'Etapa diagnostico_realizado deveria existir (é alcançada pelo funil de verdade)'; end if;

  -- chave fora das 8 técnicas é rejeitada
  begin
    insert into public.etapas_funil(chave, rotulo, ordem, tipo) values ('etapa_inventada', 'Teste', 9, 'aberta');
    raise exception 'FAIL: aceitou uma chave fora do funil técnico';
  exception when others then
    if sqlerrm not like '%etapas_funil_chave_check%' and sqlerrm not like '%check constraint%' then raise; end if;
  end;

  -- ordem duplicada é rejeitada
  begin
    update public.etapas_funil set ordem = 1 where chave = 'perdido';
    raise exception 'FAIL: aceitou ordem duplicada';
  exception when unique_violation then null;
  end;

  -- gestor edita rótulo
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', g1::text, true);
  update public.etapas_funil set rotulo = 'Primeiro contato' where chave = 'novo_lead';
  select rotulo into t from public.etapas_funil where chave = 'novo_lead';
  if t <> 'Primeiro contato' then raise exception 'Gestor deveria poder editar o rótulo, ficou %', t; end if;

  -- consultor não edita (RLS filtra, não lança exceção)
  perform set_config('request.jwt.claim.sub', c1::text, true);
  update public.etapas_funil set rotulo = 'Não deveria gravar' where chave = 'novo_lead';
  get diagnostics n = row_count;
  reset role;
  if n <> 0 then raise exception 'FAIL: consultor conseguiu editar etapas_funil (% linha(s))', n; end if;

  raise notice 'PASS: 0002_nucleo_configuravel — etapas semeadas, unicidade de ordem, RLS conferidos.';
end $$;
