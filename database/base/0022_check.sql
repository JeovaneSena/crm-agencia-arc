-- Ensaio da 0022_volta_ao_assistente.
create temp sequence seq_volta;
-- Cria um contato já encaminhado pelo assistente há `p_min` minutos (a IA calada, como `encaminhar` deixa).
create function pg_temp.encaminhada(p_nome text, p_min integer, p_motivo text default 'equipe') returns uuid language plpgsql as $f$
declare c uuid := gen_random_uuid();
begin
  insert into public.contatos_dados(id, nome, whatsapp) values (c, p_nome, '5511944' || lpad(nextval('seq_volta')::text, 6, '0'));
  update public.contatos_dados set ia_ligada = false, ia_encaminhada_em = now() - make_interval(mins => p_min),
    ia_encaminhada_motivo = p_motivo, ia_resumo = 'Quer falar de preço.' where id = c;
  return c;
end;
$f$;
create function pg_temp.mensagem(p_contato uuid, p_autor text, p_min integer, p_tipo text default 'texto') returns uuid language plpgsql as $f$
declare m uuid := gen_random_uuid();
begin
  insert into public.mensagens_whatsapp(id, contato_id, autor, tipo, conteudo, provedor, id_externo, criada_em)
    values (m, p_contato, p_autor, p_tipo, 'texto ' || p_autor, 'uazapi', 'v-' || m::text, now() - make_interval(mins => p_min));
  return m;
end;
$f$;
create function pg_temp.voltou(p_contato uuid) returns boolean language sql as $f$
  select ia_ligada and ia_encaminhada_em is null and ia_encaminhada_motivo is null and ia_resumo is null
    and exists (select 1 from public.conversa_eventos e where e.contato_id = p_contato and e.tipo = 'voltou_ao_assistente' and e.por_usuario is null)
  from public.contatos_dados where id = p_contato;
$f$;

do $$
declare
  g uuid := gen_random_uuid(); k uuid := gen_random_uuid();
  vencida uuid; parou uuid; assumida uuid; manual uuid; adiada uuid; recente uuid; atendida uuid; pendente uuid; velha uuid; sem_msg uuid; antiga uuid;
  m_pend uuid; m_velha uuid; n integer; v record;
begin
  insert into auth.users(id) values (g); insert into auth.users(id) values (k);
  update public.usuarios set papel = 'gestor' where id = g;
  update public.usuarios set papel = 'consultor' where id = k;

  -- de fábrica: sem prazo, e nada é devolvido
  if (select devolver_apos_minutos from public.assistente_config) is not null then raise exception 'FAIL: o prazo nasce definido'; end if;

  -- o prazo valida na função e na tabela: 5 min a 24 h, vazio = nunca
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', g::text, true);
  begin perform public.assistente_salvar_config('desligada', 'Sofia', 'claude-sonnet-5-5', null, '{}', 10, 5, 4); raise exception 'FAIL: prazo de 4 min passou';
  exception when sqlstate '22023' then null; end;
  begin perform public.assistente_salvar_config('desligada', 'Sofia', 'claude-sonnet-5-5', null, '{}', 10, 5, 1441); raise exception 'FAIL: prazo de mais de 24 h passou';
  exception when sqlstate '22023' then null; end;
  perform public.assistente_salvar_config('desligada', 'Sofia', 'claude-sonnet-5-5', null, '{}', 10, 5, 30);
  reset role;
  if (select devolver_apos_minutos from public.assistente_config) <> 30 then raise exception 'FAIL: não salvou o prazo'; end if;
  -- a chamada antiga, de 7 argumentos, continua valendo e deixa o prazo vazio (nunca)
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', g::text, true);
  perform public.assistente_salvar_config('desligada', 'Sofia', 'claude-sonnet-5-5', null, '{}', 10, 5);
  reset role;
  if (select devolver_apos_minutos from public.assistente_config) is not null then raise exception 'FAIL: a chamada sem prazo não zerou'; end if;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  begin perform public.assistente_salvar_config('desligada', 'Sofia', 'claude-sonnet-5-5', null, '{}', 10, 5, 30); raise exception 'FAIL: consultor mudou o prazo';
  exception when sqlstate '42501' then null; end;
  reset role;
  begin update public.assistente_config set devolver_apos_minutos = 3; raise exception 'FAIL: a tabela aceitou 3 minutos';
  exception when check_violation then null; end;

  -- o cenário: cada contato é um jeito de a IA estar calada
  vencida := pg_temp.encaminhada('Venceu', 40);                  -- ninguém apareceu há 40 min: volta
  perform pg_temp.mensagem(vencida, 'cliente', 35);
  parou := pg_temp.encaminhada('Pediu para parar', 400, 'parar'); -- decisão do cliente: nunca volta
  assumida := pg_temp.encaminhada('Assumida', 400);               -- alguém disse "eu cuido": nunca volta
  update public.contatos_dados set assumido_por = g, assumido_em = now() - interval '300 minutes' where id = assumida;
  manual := gen_random_uuid();                                    -- a equipe desligou à mão: sem encaminhamento
  insert into public.contatos_dados(id, nome, whatsapp) values (manual, 'Desligada à mão', '5511944990001');
  adiada := pg_temp.encaminhada('Adiada', 400);
  update public.contatos_dados set adiada_ate = now() + interval '3 hours' where id = adiada;
  recente := pg_temp.encaminhada('Recente', 10);                  -- ainda dentro do prazo
  atendida := pg_temp.encaminhada('Atendida', 400);               -- a equipe escreveu há 10 min: o prazo conta do último sinal
  perform pg_temp.mensagem(atendida, 'atendente', 10);
  pendente := pg_temp.encaminhada('Pendente', 120);               -- cliente esperando há 1 h, última mensagem é dele
  m_pend := pg_temp.mensagem(pendente, 'cliente', 60);
  velha := pg_temp.encaminhada('Resposta velha', 3000);           -- o cliente escreveu há mais de 24 h
  m_velha := pg_temp.mensagem(velha, 'cliente', 1800);
  sem_msg := pg_temp.encaminhada('Sem mensagem', 200);            -- encaminhada, mas a equipe já respondeu depois do cliente
  perform pg_temp.mensagem(sem_msg, 'cliente', 190); perform pg_temp.mensagem(sem_msg, 'atendente', 100);
  antiga := pg_temp.encaminhada('Mais antiga', 5000);             -- a que espera há mais tempo sai primeiro
  perform pg_temp.mensagem(antiga, 'cliente', 4000);

  -- sem prazo, desligada ou em teste: nada é devolvido
  select count(*) into n from public.conversas_devolver_ao_assistente(50); if n <> 0 then raise exception 'FAIL: devolveu sem prazo (%)', n; end if;
  update public.assistente_config set modo = 'ao_vivo', devolver_apos_minutos = 30;
  update public.assistente_config set modo = 'teste'; select count(*) into n from public.conversas_devolver_ao_assistente(50);
  if n <> 0 then raise exception 'FAIL: devolveu no modo de teste (%)', n; end if;
  update public.assistente_config set modo = 'desligada'; select count(*) into n from public.conversas_devolver_ao_assistente(50);
  if n <> 0 then raise exception 'FAIL: devolveu com o assistente desligado (%)', n; end if;
  update public.assistente_config set modo = 'ao_vivo';
  if exists (select 1 from public.contatos_dados where ia_ligada and nome in ('Venceu', 'Pendente')) then raise exception 'FAIL: algo voltou antes da hora'; end if;

  -- só o servidor chama
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', g::text, true);
  begin perform * from public.conversas_devolver_ao_assistente(3); raise exception 'FAIL: o gestor chamou a função do vigia';
  exception when insufficient_privilege then null; end;
  reset role;

  -- o limite por rodada: a primeira leva é a que espera há mais tempo
  select * into v from public.conversas_devolver_ao_assistente(1);
  if v.contato_id is distinct from antiga then raise exception 'FAIL: não saiu a mais antiga primeiro (%)', v; end if;
  if v.mensagem_id is not null then raise exception 'FAIL: a mensagem de 66 h não deveria pedir resposta (%)', v; end if;
  if not pg_temp.voltou(antiga) then raise exception 'FAIL: a mais antiga não voltou inteira (IA ligada, encaminhamento limpo, evento sem pessoa)'; end if;
  if v.minutos < 5000 then raise exception 'FAIL: os minutos sem sinal estão errados (%)', v.minutos; end if;

  -- a rodada seguinte leva as demais vencidas, com a mensagem que ficou sem resposta
  create temp table volta_2 on commit drop as select * from public.conversas_devolver_ao_assistente(50);
  select count(*) into n from volta_2; if n <> 4 then raise exception 'FAIL: deveriam voltar 4 nesta rodada (%)', n; end if;
  if not exists (select 1 from volta_2 where contato_id = vencida and mensagem_id is not null and tipo = 'texto') then raise exception 'FAIL: a vencida não trouxe a mensagem sem resposta'; end if;
  if not exists (select 1 from volta_2 where contato_id = pendente and mensagem_id = m_pend) then raise exception 'FAIL: a pendente trouxe a mensagem errada'; end if;
  if not exists (select 1 from volta_2 where contato_id = velha and mensagem_id is null) then raise exception 'FAIL: uma mensagem de mais de 24 h pediu resposta'; end if;
  if not exists (select 1 from volta_2 where contato_id = sem_msg and mensagem_id is null) then raise exception 'FAIL: a equipe já respondeu e a IA foi chamada a responder'; end if;
  if not (pg_temp.voltou(vencida) and pg_temp.voltou(pendente) and pg_temp.voltou(velha) and pg_temp.voltou(sem_msg)) then raise exception 'FAIL: alguma devolvida ficou pela metade'; end if;

  -- o que não podia voltar continua exatamente como estava
  if exists (select 1 from public.contatos_dados where id = parou and (ia_ligada or ia_encaminhada_motivo <> 'parar' or ia_encaminhada_em is null)) then raise exception 'FAIL: quem pediu para parar foi devolvido ao assistente'; end if;
  if exists (select 1 from public.contatos_dados where id = assumida and (ia_ligada or assumido_por is distinct from g)) then raise exception 'FAIL: conversa assumida foi tomada da pessoa'; end if;
  if exists (select 1 from public.contatos_dados where id = manual and ia_ligada) then raise exception 'FAIL: conversa desligada à mão foi religada'; end if;
  if exists (select 1 from public.contatos_dados where id = adiada and ia_ligada) then raise exception 'FAIL: conversa adiada voltou'; end if;
  if exists (select 1 from public.contatos_dados where id = recente and ia_ligada) then raise exception 'FAIL: voltou antes do prazo'; end if;
  if exists (select 1 from public.contatos_dados where id = atendida and ia_ligada) then raise exception 'FAIL: o prazo contou do encaminhamento e não do último sinal da equipe'; end if;
  select count(*) into n from public.conversa_eventos where tipo = 'voltou_ao_assistente'; if n <> 5 then raise exception 'FAIL: eventos de volta registrados: % (esperava 5)', n; end if;

  -- uma vez só: repetir a chamada não devolve de novo
  select count(*) into n from public.conversas_devolver_ao_assistente(50); if n <> 0 then raise exception 'FAIL: devolveu de novo (%)', n; end if;

  -- passado o prazo, "recente" e "atendida" também voltam; o último sinal vence o relógio do encaminhamento
  update public.contatos_dados set ia_encaminhada_em = now() - interval '35 minutes' where id = recente;
  update public.mensagens_whatsapp set criada_em = now() - interval '31 minutes' where contato_id = atendida and autor = 'atendente';
  select count(*) into n from public.conversas_devolver_ao_assistente(50); if n <> 2 then raise exception 'FAIL: deveriam voltar as duas que venceram agora (%)', n; end if;

  -- assumir/devolver por uma pessoa também conta como sinal da equipe
  update public.contatos_dados set assumido_por = null where id = assumida;                         -- só o ensaio solta o gatilho de propósito
  insert into public.conversa_eventos(contato_id, tipo, de_usuario, para_usuario, por_usuario) values (assumida, 'devolveu', g, null, g);
  select count(*) into n from public.conversas_devolver_ao_assistente(50); if n <> 0 then raise exception 'FAIL: devolveu logo depois de uma pessoa mexer na conversa (%)', n; end if;

  -- concluir o encaminhamento (data nula) leva o motivo junto
  update public.contatos_dados set ia_encaminhada_em = null where id = parou;
  if (select ia_encaminhada_motivo from public.contatos_dados where id = parou) is not null then raise exception 'FAIL: o motivo ficou depois de concluir o encaminhamento'; end if;

  -- o motivo só aceita os dois valores
  begin update public.contatos_dados set ia_encaminhada_motivo = 'outro' where id = recente; raise exception 'FAIL: motivo inventado entrou';
  exception when check_violation then null; end;
end $$;
