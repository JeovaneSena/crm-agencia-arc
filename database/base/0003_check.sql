-- Ensaio da 0003_contatos_proxima_reuniao.
do $$
declare
  c uuid; p uuid; futura timestamptz := date_trunc('hour', now()) + interval '3 days';
  r timestamptz; n integer;
begin
  insert into public.profissionais(nome) values ('Teste') returning id into p;
  insert into public.catalogo_servicos(nome) values ('Serviço de teste');
  insert into public.profissional_horarios(profissional_id, dia_semana, hora_inicio, hora_fim) select p, d, '00:00', '23:59' from generate_series(0, 6) d;
  insert into public.contatos_dados(nome, whatsapp) values ('Contato teste', '5511999990003') returning id into c;

  select proxima_reuniao into r from public.contatos where id = c;
  if r is not null then raise exception 'Sem reunião, proxima_reuniao deveria ser nula, veio %', r; end if;

  insert into public.reunioes(contato_id, profissional_id, assunto, data_reuniao, duracao_minutos, status)
  values (c, p, 'Serviço de teste', futura, 30, 'agendada');
  select proxima_reuniao into r from public.contatos where id = c;
  if r is distinct from futura then raise exception 'proxima_reuniao deveria ser %, veio %', futura, r; end if;

  update public.reunioes set status = 'cancelada', cancelado_em = now(), motivo_cancelamento = 'teste' where contato_id = c;
  select proxima_reuniao into r from public.contatos where id = c;
  if r is not null then raise exception 'Reunião cancelada não conta como próxima, veio %', r; end if;

  select count(*) into n from information_schema.columns where table_schema='public' and table_name='contatos' and column_name in ('ultima_reuniao','interesses_texto','proxima_reuniao');
  if n <> 3 then raise exception 'A view perdeu colunas: só % das 3 esperadas', n; end if;

  raise notice 'PASS: 0003_contatos_proxima_reuniao';
end $$;
