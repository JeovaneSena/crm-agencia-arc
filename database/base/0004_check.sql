-- Ensaio da 0004_dashboard.
do $$
declare
  c uuid; p uuid; n integer; s bigint;
  ini timestamptz := now() - interval '2 days'; fim timestamptz := now() + interval '2 days';
begin
  insert into public.profissionais(nome) values ('Dash') returning id into p;
  insert into public.catalogo_servicos(nome) values ('Serviço de teste');
  insert into public.profissional_horarios(profissional_id, dia_semana, hora_inicio, hora_fim) select p, d, '00:00', '23:59' from generate_series(0, 6) d;
  insert into public.contatos_dados(nome, whatsapp) values ('Dash', '5511999990004') returning id into c;
  insert into public.reunioes(contato_id, profissional_id, assunto, data_reuniao, duracao_minutos)
  values (c, p, 'Serviço de teste', date_trunc('hour', now()) + interval '1 day', 30);

  select count(*) into n from public.dashboard_dia_semana(ini, fim);
  if n <> 7 then raise exception 'dia_semana deveria devolver 7 linhas, veio %', n; end if;
  select sum(contatos) into s from public.dashboard_dia_semana(ini, fim);
  if s <> 1 then raise exception 'dia_semana deveria somar 1 contato, somou %', s; end if;

  select sum(atendimentos), sum(agendamentos) into s, n from public.dashboard_por_dia(ini, fim);
  if s <> 1 or n <> 1 then raise exception 'por_dia esperava 1/1, veio %/%', s, n; end if;

  select reunioes into s from public.dashboard_profissionais(ini, fim + interval '2 days') where profissional_id = p;
  if s <> 1 then raise exception 'profissionais deveria contar 1 reunião, contou %', s; end if;

  perform * from public.dashboard_servicos(ini, fim);

  -- período gigante: teto de 370 dias
  select count(*) into n from public.dashboard_por_dia(now() - interval '5 years', now());
  if n > 370 then raise exception 'por_dia passou do teto: % linhas', n; end if;

  raise notice 'PASS: 0004_dashboard';
end $$;
