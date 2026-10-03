-- Ensaio da 0021_radar.
create temp sequence seq_radar;
create function pg_temp.nova(p_nome text, p_etapa text, p_horas integer) returns uuid language plpgsql as $f$
declare c uuid := gen_random_uuid(); o uuid;
begin
  -- todo contato novo já nasce com a "oportunidade inicial" (gatilho contato_inicial): é ela que o radar vigia.
  insert into public.contatos_dados(id, nome, whatsapp) values (c, p_nome, '5511933' || lpad(nextval('seq_radar')::text, 6, '0'));
  select id into o from public.oportunidades where contato_id = c;
  if p_etapa <> 'novo_lead' then update public.oportunidades set status = p_etapa where id = o; end if;
  -- created_at não muda por UPDATE (validar_oportunidade): só o ensaio desliga o gatilho, para envelhecer o negócio.
  alter table public.oportunidades disable trigger oportunidade_validar;
  update public.oportunidades set created_at = now() - make_interval(hours => p_horas) where id = o;
  alter table public.oportunidades enable trigger oportunidade_validar;
  update public.oportunidade_eventos set created_at = now() - make_interval(hours => p_horas) where oportunidade_id = o;
  return o;
end;
$f$;
create function pg_temp.faixa(p_op uuid) returns text language sql as $f$
  select coalesce((select faixa || coalesce(':' || protegido_por, '') from public.radar_negocios() where oportunidade_id = p_op), 'fora');
$f$;

do $$
declare
  g uuid := gen_random_uuid(); k uuid := gen_random_uuid(); p uuid;
  a uuid; b uuid; c uuid; d uuid; e uuid; f uuid; h uuid; i uuid; j uuid; k1 uuid; k2 uuid; l uuid; fechada uuid;
  ct uuid; v record; n integer;
begin
  insert into auth.users(id) values (g); insert into auth.users(id) values (k);
  update public.usuarios set papel = 'gestor' where id = g;
  update public.usuarios set papel = 'consultor' where id = k;
  insert into public.profissionais(nome) values ('Radar') returning id into p;
  insert into public.catalogo_servicos(nome) values ('Serviço Radar');
  insert into public.profissional_horarios(profissional_id, dia_semana, hora_inicio, hora_fim) select p, dia, '00:00', '23:59' from generate_series(0, 6) dia;

  -- janela padrão de 48 h; crítico em 144 h (3 janelas)
  a := pg_temp.nova('A fresco', 'novo_lead', 10);
  b := pg_temp.nova('B esfriou', 'novo_lead', 49);
  c := pg_temp.nova('C crítico', 'novo_lead', 145);
  if pg_temp.faixa(a) <> 'fora' then raise exception 'FAIL: negócio fresco não entra no radar (%)', pg_temp.faixa(a); end if;
  if pg_temp.faixa(b) <> 'em_risco' then raise exception 'FAIL: 49 h deveria ser em risco (%)', pg_temp.faixa(b); end if;
  if pg_temp.faixa(c) <> 'critico' then raise exception 'FAIL: 145 h deveria ser crítico (%)', pg_temp.faixa(c); end if;
  if pg_temp.faixa(pg_temp.nova('Limite 47 h', 'novo_lead', 47)) <> 'fora' then raise exception 'FAIL: 47 h ainda está dentro da janela'; end if;
  if pg_temp.faixa(pg_temp.nova('Limite 143 h', 'novo_lead', 143)) <> 'em_risco' then raise exception 'FAIL: 143 h ainda não é crítico'; end if;

  -- próximo passo garantido: tarefa futura, reunião futura ou retomar depois de hoje
  d := pg_temp.nova('D com tarefa', 'novo_lead', 100);
  select contato_id into ct from public.oportunidades where id = d;
  insert into public.tarefas(titulo, vence_em, contato_id) values ('Ligar', now() + interval '1 day', ct);
  if pg_temp.faixa(d) <> 'em_voo:tarefa' then raise exception 'FAIL: tarefa futura deveria proteger (%)', pg_temp.faixa(d); end if;

  e := pg_temp.nova('E tarefa vencida', 'novo_lead', 100);
  select contato_id into ct from public.oportunidades where id = e;
  insert into public.tarefas(titulo, vence_em, contato_id) values ('Atrasada', now() - interval '1 hour', ct);
  if pg_temp.faixa(e) <> 'em_risco' then raise exception 'FAIL: tarefa vencida não deveria proteger (%)', pg_temp.faixa(e); end if;

  f := pg_temp.nova('F com reunião', 'novo_lead', 100);
  select contato_id into ct from public.oportunidades where id = f;
  insert into public.reunioes(contato_id, profissional_id, assunto, data_reuniao, duracao_minutos, status)
  values (ct, p, 'Serviço Radar', date_trunc('hour', now()) + interval '3 days', 30, 'agendada');
  -- marcar a reunião é atividade e move a etapa: envelhece de novo para isolar a proteção
  update public.reunioes set created_at = now() - interval '100 hours' where contato_id = ct;
  update public.oportunidade_eventos set created_at = now() - interval '100 hours' where oportunidade_id = f;
  if pg_temp.faixa(f) <> 'em_voo:reuniao' then raise exception 'FAIL: reunião futura deveria proteger (%)', pg_temp.faixa(f); end if;
  update public.reunioes set status = 'cancelada', cancelado_em = now(), motivo_cancelamento = 'teste do radar' where contato_id = ct;
  update public.oportunidade_eventos set created_at = now() - interval '100 hours' where oportunidade_id = f;
  if pg_temp.faixa(f) <> 'em_risco' then raise exception 'FAIL: reunião cancelada não protege (%)', pg_temp.faixa(f); end if;

  h := pg_temp.nova('H retomar amanhã', 'novo_lead', 100);
  update public.oportunidades set retomar_em = current_date + 1 where id = h;
  if pg_temp.faixa(h) <> 'em_voo:retomar' then raise exception 'FAIL: retomar amanhã deveria proteger (%)', pg_temp.faixa(h); end if;
  update public.oportunidades set retomar_em = current_date where id = h;
  update public.oportunidade_eventos set created_at = now() - interval '100 hours' where oportunidade_id = h;
  if pg_temp.faixa(h) <> 'em_risco' then raise exception 'FAIL: retomar hoje já venceu, não protege (%)', pg_temp.faixa(h); end if;

  -- atividade recente tira do radar: mensagem do contato, tarefa concluída
  i := pg_temp.nova('I mensagem recente', 'novo_lead', 100);
  update public.contatos_dados set ultima_mensagem = now() - interval '1 hour' where id = (select contato_id from public.oportunidades where id = i);
  if pg_temp.faixa(i) <> 'fora' then raise exception 'FAIL: mensagem recente deveria tirar do radar (%)', pg_temp.faixa(i); end if;
  j := pg_temp.nova('J tarefa concluída', 'novo_lead', 100);
  select contato_id into ct from public.oportunidades where id = j;
  insert into public.tarefas(titulo, vence_em, contato_id, concluida_em) values ('Feita', now() - interval '2 hours', ct, now() - interval '1 hour');
  if pg_temp.faixa(j) <> 'fora' then raise exception 'FAIL: tarefa concluída agora deveria tirar do radar (%)', pg_temp.faixa(j); end if;

  -- negócio encerrado nunca aparece
  fechada := pg_temp.nova('Fechada', 'proposta', 500);
  update public.oportunidades set status = 'ganho', valor_proposta = 100, servicos_contratados = array['Serviço Radar'] where id = fechada;
  update public.oportunidade_eventos set created_at = now() - interval '500 hours' where oportunidade_id = fechada;
  if pg_temp.faixa(fechada) <> 'fora' then raise exception 'FAIL: negócio ganho não entra no radar (%)', pg_temp.faixa(fechada); end if;

  -- janela por etapa: proposta esfria em 24 h (crítico em 72 h); as outras seguem em 48 h
  update public.etapas_funil set esfria_apos_horas = 24 where chave = 'proposta';
  k1 := pg_temp.nova('K proposta 30 h', 'proposta', 30);
  k2 := pg_temp.nova('K proposta 73 h', 'proposta', 73);
  l := pg_temp.nova('L diagnóstico 30 h', 'diagnostico', 30);
  if pg_temp.faixa(k1) <> 'em_risco' then raise exception 'FAIL: proposta com 30 h passa da janela de 24 h (%)', pg_temp.faixa(k1); end if;
  if pg_temp.faixa(k2) <> 'critico' then raise exception 'FAIL: proposta com 73 h passa de 3 janelas (%)', pg_temp.faixa(k2); end if;
  if pg_temp.faixa(l) <> 'fora' then raise exception 'FAIL: outra etapa segue em 48 h (%)', pg_temp.faixa(l); end if;
  select esfria_apos_horas into n from public.radar_negocios() where oportunidade_id = k1;
  if n <> 24 then raise exception 'FAIL: a janela da etapa deveria vir na linha (%)', n; end if;

  -- ordem: críticos, em risco, em voo; dentro de cada faixa o mais frio primeiro
  select count(*) into n from (select faixa, horas_parado, lag(faixa) over () as fa, lag(horas_parado) over () as ha from public.radar_negocios()) q
   where (fa = 'em_risco' and faixa = 'critico') or (fa = 'em_voo' and faixa <> 'em_voo') or (fa = faixa and ha < horas_parado);
  if n <> 0 then raise exception 'FAIL: o radar deveria sair por faixa e, dentro dela, do mais frio (% fora de ordem)', n; end if;
  if (select faixa from public.radar_negocios() limit 1) <> 'critico' then raise exception 'FAIL: o primeiro da fila deveria ser crítico'; end if;

  -- críticos por responsável (para o vigia): sem responsável vem como linha própria
  update public.oportunidades set responsavel_id = k where id = c;
  select * into v from public.radar_criticos_por_responsavel() where responsavel_id = k;
  if v.quantidade <> 1 then raise exception 'FAIL: k tem 1 crítico (%)', v.quantidade; end if;
  select * into v from public.radar_criticos_por_responsavel() where responsavel_id is null;
  if v.quantidade <> 1 then raise exception 'FAIL: sem responsável tem 1 crítico (K proposta 73 h) (%)', v.quantidade; end if;

  -- a janela só aceita de 1 h a 90 dias; só o gestor muda
  begin update public.etapas_funil set esfria_apos_horas = 0 where chave = 'qualificacao'; raise exception 'FAIL: janela zero';
  exception when check_violation then null; end;
  begin update public.etapas_funil set esfria_apos_horas = 2161 where chave = 'qualificacao'; raise exception 'FAIL: janela de mais de 90 dias';
  exception when check_violation then null; end;
  update public.etapas_funil set esfria_apos_horas = null where chave = 'proposta';
  if pg_temp.faixa(k1) <> 'fora' then raise exception 'FAIL: sem janela configurada volta para 48 h (%)', pg_temp.faixa(k1); end if;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  update public.etapas_funil set esfria_apos_horas = 12 where chave = 'proposta';
  reset role;
  if (select esfria_apos_horas from public.etapas_funil where chave = 'proposta') is not null then raise exception 'FAIL: consultor mudou a janela'; end if;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', g::text, true);
  update public.etapas_funil set esfria_apos_horas = 12 where chave = 'proposta';
  reset role;
  if (select esfria_apos_horas from public.etapas_funil where chave = 'proposta') <> 12 then raise exception 'FAIL: gestor não conseguiu mudar a janela'; end if;

  -- permissões: a equipe lê o radar; anon não; só o servidor chama o resumo do vigia
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  select count(*) into n from public.radar_negocios();
  if n < 5 then raise exception 'FAIL: a equipe deveria ver o radar (%)', n; end if;
  begin perform public.radar_criticos_por_responsavel(); raise exception 'FAIL: equipe chamou o resumo do vigia';
  exception when insufficient_privilege then null; end;
  reset role;
  set local role anon;
  begin perform count(*) from public.radar_negocios(); raise exception 'FAIL: anon leu o radar';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;
