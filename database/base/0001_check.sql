-- Ensaio da 0001_base: roda dentro da transação da própria migração,
-- revertida por SAVEPOINT (apply) ou ROLLBACK (rehearse) — nada aqui
-- sobrevive. Falha = exception; sucesso = silêncio.
do $$
declare
  g1 uuid := gen_random_uuid();  -- primeira conta: vira gestora por necessidade
  c1 uuid := gen_random_uuid();  -- segunda conta: consultora por omissão
  contato uuid; oport uuid; prof uuid;
  n integer; t text; v_ok boolean; v_motivo text; v_reuniao uuid;
begin
  -- ------------------------------------------------- primeiro usuário = gestor
  insert into auth.users(id) values (g1);
  select papel into t from public.usuarios where id = g1;
  if t <> 'gestor' then raise exception 'Primeira conta deveria virar gestora, virou %', t; end if;

  insert into auth.users(id) values (c1);
  select papel into t from public.usuarios where id = c1;
  if t <> 'consultor' then raise exception 'Segunda conta deveria ser consultora, virou %', t; end if;

  -- ------------------------------------------------- contato -> oportunidade
  insert into public.contatos_dados(nome, whatsapp) values ('Contato de teste', '5599999999999') returning id into contato;
  select id into oport from public.oportunidades where contato_id = contato;
  if oport is null then raise exception 'Contato novo deveria nascer com uma oportunidade inicial'; end if;
  select status into t from public.oportunidades where id = oport;
  if t <> 'novo_lead' then raise exception 'Oportunidade inicial deveria nascer novo_lead, nasceu %', t; end if;

  -- ------------------------------------------------- trava de catálogo
  begin
    update public.oportunidades set status = 'ganho', valor_proposta = 100, servicos_contratados = array['Serviço Inexistente'] where id = oport;
    raise exception 'FAIL: marcou ganho com serviço fora do catálogo';
  exception when others then
    if sqlerrm not like '%catálogo%' then raise; end if;
  end;

  -- ------------------------------------------------- ganho exige catálogo ativo
  insert into public.catalogo_servicos(nome, ativo) values ('Serviço de teste', true);
  update public.oportunidades set status = 'ganho', valor_proposta = 100, servicos_contratados = array['Serviço de teste'] where id = oport;
  select status into t from public.contatos_dados where id = contato;
  if t <> 'ganho' then raise exception 'Resumo do contato deveria virar ganho, ficou %', t; end if;

  -- venda encerrada não pode ser reaberta
  begin
    update public.oportunidades set valor_proposta = 200 where id = oport;
    raise exception 'FAIL: editou venda encerrada sem cancelar';
  exception when others then
    if sqlerrm not like '%encerrada%' then raise; end if;
  end;

  -- ------------------------------------------------- agenda: profissional, jornada, reunião
  insert into public.profissionais(nome) values ('Profissional de teste') returning id into prof;
  insert into public.profissional_horarios(profissional_id, dia_semana, hora_inicio, hora_fim)
    select prof, g, '08:00', '18:00' from generate_series(0,6) g;
  insert into public.catalogo_servicos(nome, ativo, exige_reuniao_previa, duracao_minutos) values ('Diagnóstico de teste', true, false, 30);

  insert into public.contatos_dados(nome, whatsapp) values ('Contato da agenda', '5588888888888') returning id into contato;
  -- 15h UTC = meio-dia em America/Sao_Paulo (UTC-3): dentro da jornada em
  -- qualquer dia da semana, já que os 7 dias foram cadastrados iguais acima.
  select ok, motivo, reuniao_id into v_ok, v_motivo, v_reuniao
    from public.agenda_marcar('Contato da agenda','5588888888888','Diagnóstico de teste', date_trunc('day', now()) + interval '10 days' + interval '15 hours', prof);
  if not v_ok then raise exception 'agenda_marcar deveria ter marcado, falhou com %', v_motivo; end if;

  select id into oport from public.oportunidades where contato_id = contato and status <> 'perdido';
  select status into t from public.oportunidades where id = oport;
  if t <> 'diagnostico' then raise exception 'Reunião marcada deveria mover o funil para diagnostico, ficou %', t; end if;

  update public.reunioes set status = 'realizada' where id = v_reuniao;
  select status into t from public.oportunidades where id = oport;
  if t <> 'diagnostico_realizado' then raise exception 'Reunião realizada deveria mover o funil para diagnostico_realizado, ficou %', t; end if;

  -- fora da jornada é recusa (motivo), não exceção: 3h UTC = meia-noite local.
  select ok, motivo into v_ok, v_motivo from public.agenda_marcar(
    'Fora da jornada','5577777777777','Diagnóstico de teste', date_trunc('day', now()) + interval '10 days' + interval '3 hours', prof);
  if v_ok or v_motivo <> 'fora_expediente' then raise exception 'Esperava recusa fora_expediente, veio ok=% motivo=%', v_ok, v_motivo; end if;

  -- ------------------------------------------------- último gestor protegido
  begin
    update public.usuarios set papel = 'consultor' where id = g1;
    raise exception 'FAIL: rebaixou o único gestor ativo';
  exception when others then
    if sqlerrm not like '%gestor%' then raise; end if;
  end;

  -- ------------------------------------------------- RLS: consultor não escreve catálogo
  -- Com GRANT concedido e a trava só na política, a linha simplesmente não
  -- casa: não é exceção, é zero linhas afetadas.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', c1::text, true);
  update public.catalogo_servicos set ativo = false where nome = 'Serviço de teste';
  get diagnostics n = row_count;
  reset role;
  if n <> 0 then raise exception 'FAIL: consultor conseguiu escrever no catálogo (% linha(s))', n; end if;

  raise notice 'PASS: 0001_base — gestor inicial, funil, catálogo, agenda e RLS conferidos.';
end $$;
