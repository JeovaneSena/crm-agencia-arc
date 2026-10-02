-- Ensaio da 0010_modulo_campanhas.
do $$
declare
  g uuid := gen_random_uuid(); k uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid(); c4 uuid := gen_random_uuid(); c5 uuid := gen_random_uuid(); c6 uuid := gen_random_uuid();
  camp uuid; camp_aux uuid; r jsonb; v record; n integer; hash text; lote record; msg uuid; tok uuid; dest uuid;
begin
  insert into auth.users(id) values (g);
  insert into auth.users(id) values (k);
  update public.usuarios set papel = 'gestor' where id = g;
  update public.usuarios set papel = 'consultor' where id = k;
  update public.configuracoes_negocio set fuso_horario = 'America/Sao_Paulo';
  -- c1 ok · c2 sem consentimento · c3 pediu para parar · c4 sem nome (parâmetro vazio) · c5 sem whatsapp · c6 ok (campanha anterior recente)
  insert into public.contatos_dados(id, nome, whatsapp, empresa, status, created_at) values
    (c1, 'Maria Souza', '5511900000001', 'Acme', 'novo_lead', now() - interval '6 days'),
    (c2, 'Joana', '5511900000002', null, 'novo_lead', now() - interval '5 days'),
    (c3, 'Pedro', '5511900000003', null, 'novo_lead', now() - interval '4 days'),
    (c4, null, '5511900000004', null, 'novo_lead', now() - interval '3 days'),
    (c5, 'Sem Zap', null, null, 'novo_lead', now() - interval '2 days'),
    (c6, 'Lia Dias', '5511900000006', null, 'novo_lead', now() - interval '1 day');

  -- ---- consentimento: só gestor concede; qualquer um revoga; trilha imutável ----
  set local role authenticated; perform set_config('request.jwt.claim.sub', k::text, true);
  begin perform public.marketing_registrar_preferencia(c1, true, 'pediu pelo WhatsApp'); raise exception 'FAIL: consultor concedeu consentimento';
  exception when insufficient_privilege then null; end;
  reset role;
  set local role authenticated; perform set_config('request.jwt.claim.sub', g::text, true);
  begin perform public.marketing_registrar_preferencia(c1, true, 'x'); raise exception 'FAIL: consentimento sem origem passou';
  exception when sqlstate '22023' then null; end;
  perform public.marketing_registrar_preferencia(c1, true, 'pediu pelo WhatsApp');
  perform public.marketing_registrar_preferencia(c4, true, 'pediu pelo WhatsApp');
  perform public.marketing_registrar_preferencia(c6, true, 'pediu pelo WhatsApp');
  perform public.marketing_registrar_preferencia(c3, true, 'pediu pelo WhatsApp');
  reset role;
  set local role authenticated; perform set_config('request.jwt.claim.sub', k::text, true);
  perform public.marketing_registrar_preferencia(c3, false, 'mandou sair no WhatsApp');   -- consultor revoga
  reset role;
  select count(*) into n from public.marketing_consentimentos where contato_id = c3 and not ativo and revogado_em is not null;
  if n <> 1 then raise exception 'FAIL: revogação não registrada'; end if;
  begin delete from public.marketing_preferencias_eventos where contato_id = c3; raise exception 'FAIL: trilha de consentimento foi apagada';
  exception when insufficient_privilege then null; end;
  begin update public.marketing_preferencias_eventos set fonte = 'adulterada'; raise exception 'FAIL: trilha de consentimento foi editada';
  exception when insufficient_privilege then null; end;

  -- ---- campanha: só gestor cria; rascunho; filtro inválido ----
  set local role authenticated; perform set_config('request.jwt.claim.sub', k::text, true);
  begin insert into public.campanhas(nome, modelo_id, modelo_nome, modelo_idioma) values ('Não pode', 'm1', 'promo', 'pt_BR'); raise exception 'FAIL: consultor criou campanha';
  exception when insufficient_privilege or sqlstate '42501' then null; end;
  reset role;
  set local role authenticated; perform set_config('request.jwt.claim.sub', g::text, true);
  insert into public.campanhas(nome, modelo_id, modelo_nome, modelo_idioma, modelo_snapshot, mapeamento_parametros, filtros_publico)
  values ('Promo de outubro', 'm1', 'promo_outubro', 'pt_BR', '{"body":"Olá {{1}}, {{2}}"}',
          '[{"tipo":"body","posicao":1,"origem":"primeiro_nome"},{"tipo":"body","posicao":2,"origem":"fixo","valor":"temos novidades"}]', '{}')
  returning id into camp;
  begin update public.campanhas set filtros_publico = '{"cpf":"1"}' where id = camp; raise exception 'FAIL: filtro desconhecido passou';
  exception when sqlstate '22023' then null; end;
  begin update public.campanhas set estado = 'enviando' where id = camp; raise exception 'FAIL: gestor mudou o estado direto';
  exception when insufficient_privilege then null; end;
  begin perform public.campanha_iniciar(camp, 'qualquer'); raise exception 'FAIL: iniciou campanha não pronta';
  exception when sqlstate '55000' then null; end;
  reset role;
  select criada_por, estado into v from public.campanhas where id = camp;
  if v.criada_por <> g or v.estado <> 'rascunho' then raise exception 'FAIL: criada_por/estado errados (%)', v; end if;

  -- campanha anterior: c6 recebeu campanha há pouco => fica de fora
  insert into public.mensagens_whatsapp(contato_id, autor, conteudo, origem_envio, provedor, id_externo, criada_em)
  values (c6, 'agente', 'oi', 'campanha', 'meta', 'wamid.antiga', now() - interval '2 hours');

  -- ---- congelar o público ----
  set local role authenticated; perform set_config('request.jwt.claim.sub', k::text, true);
  begin perform public.campanha_congelar_publico(camp); raise exception 'FAIL: consultor congelou público';
  exception when insufficient_privilege then null; end;
  reset role;
  set local role authenticated; perform set_config('request.jwt.claim.sub', g::text, true);
  r := public.campanha_congelar_publico(camp);
  reset role;
  if (r->>'aptos')::int <> 1 or (r->>'excluidos')::int <> 5 then raise exception 'FAIL: contagem do público errada (%)', r; end if;
  if r->'motivos' <> '{"sem_whatsapp":1,"sem_consentimento":1,"pediu_para_parar":1,"parametro_vazio":1,"recebeu_campanha_recentemente":1}'::jsonb then raise exception 'FAIL: motivos errados (%)', r->'motivos'; end if;
  select * into v from public.campanha_destinatarios where campanha_id = camp and contato_id = c1;
  if not v.apto or v.estado <> 'pendente' or v.pedido_id is null or v.valores <> '{"body":["Maria","temos novidades"]}'::jsonb then raise exception 'FAIL: destinatário apto errado (%)', v; end if;
  select estado, revisao_hash into v from public.campanhas where id = camp;
  if v.estado <> 'pronta' or v.revisao_hash is null then raise exception 'FAIL: campanha não ficou pronta'; end if;
  hash := v.revisao_hash;

  -- mudar a configuração depois de pronta descarta a revisão
  set local role authenticated; perform set_config('request.jwt.claim.sub', g::text, true);
  update public.campanhas set nome = 'Promo de outubro v2' where id = camp;
  reset role;
  select estado, revisao_hash into v from public.campanhas where id = camp;
  select count(*) into n from public.campanha_destinatarios where campanha_id = camp;
  if v.estado <> 'rascunho' or v.revisao_hash is not null or n <> 0 then raise exception 'FAIL: edição não descartou a revisão (% / %)', v, n; end if;
  set local role authenticated; perform set_config('request.jwt.claim.sub', g::text, true);
  r := public.campanha_congelar_publico(camp);
  reset role;
  select revisao_hash into hash from public.campanhas where id = camp;

  -- ---- iniciar: exige o hash revisado; controle global pausado barra ----
  set local role authenticated; perform set_config('request.jwt.claim.sub', g::text, true);
  begin perform public.campanha_iniciar(camp, 'hash-velho'); raise exception 'FAIL: iniciou com revisão desatualizada';
  exception when sqlstate '55000' then null; end;
  update public.campanhas_controle set pausado = true;
  begin perform public.campanha_iniciar(camp, hash); raise exception 'FAIL: iniciou com envios pausados';
  exception when sqlstate '55000' then null; end;
  update public.campanhas_controle set pausado = false;
  reset role;
  set local role authenticated; perform set_config('request.jwt.claim.sub', k::text, true);
  begin perform public.campanha_iniciar(camp, hash); raise exception 'FAIL: consultor iniciou campanha';
  exception when insufficient_privilege then null; end;
  begin perform public.campanha_reivindicar(5); raise exception 'FAIL: consultor executou a fila';
  exception when insufficient_privilege then null; end;
  reset role;
  set local role authenticated; perform set_config('request.jwt.claim.sub', g::text, true);
  perform public.campanha_iniciar(camp, hash);
  reset role;

  -- ---- a fila: reivindicar → reservar → marcar chamada → finalizar ----
  select * into lote from public.campanha_reivindicar(10);
  if lote.destinatario_id is null or lote.contato_id <> c1 or lote.tentativas <> 1 or lote.lease_token is null then raise exception 'FAIL: reivindicar errado (%)', lote; end if;
  dest := lote.destinatario_id; tok := lote.lease_token;
  select count(*) into n from public.campanha_reivindicar(10);
  if n <> 0 then raise exception 'FAIL: o ritmo por minuto não segurou o segundo lote'; end if;
  update public.campanhas_controle set proximo_disparo_em = now();

  r := public.campanha_reservar(dest, gen_random_uuid(), 'Olá Maria, temos novidades');
  if (r->>'ok')::boolean then raise exception 'FAIL: reservou com token errado'; end if;
  r := public.campanha_reservar(dest, tok, 'Olá Maria, temos novidades');
  if not (r->>'ok')::boolean then raise exception 'FAIL: reserva recusada (%)', r; end if;
  msg := (r->>'mensagem_id')::uuid;
  if (public.campanha_reservar(dest, tok, 'Olá Maria, temos novidades')->>'mensagem_id')::uuid <> msg then raise exception 'FAIL: reserva repetida criou outra mensagem'; end if;
  select * into v from public.mensagens_whatsapp where id = msg;
  if v.autor <> 'agente' or v.origem_envio <> 'campanha' or v.provedor <> 'meta' or v.estado_envio <> 'pendente' or v.campanha_id <> camp then raise exception 'FAIL: mensagem da campanha errada (%)', v; end if;

  if not public.campanha_marcar_chamada(dest, tok) then raise exception 'FAIL: marcar chamada recusado'; end if;
  perform public.campanha_finalizar(dest, tok, 'aceito', 'wamid.NOVA1', null);
  select * into v from public.campanha_destinatarios where id = dest;
  if v.estado <> 'aceito' or v.lease_token is not null or v.aceito_em is null then raise exception 'FAIL: finalização errada (%)', v; end if;
  begin perform public.campanha_finalizar(dest, tok, 'aceito', 'wamid.NOVA1', null); raise exception 'FAIL: finalizou duas vezes';
  exception when sqlstate '55000' then null; end;
  select estado, concluida_em into v from public.campanhas where id = camp;
  if v.estado <> 'concluida' or v.concluida_em is null then raise exception 'FAIL: campanha não concluiu ao esvaziar a fila (%)', v; end if;

  -- recibos da Meta, em ordem monotônica
  if not public.campanha_status_meta('wamid.NOVA1', 'delivered') then raise exception 'FAIL: recibo não achou a mensagem'; end if;
  perform public.campanha_status_meta('wamid.NOVA1', 'read');
  perform public.campanha_status_meta('wamid.NOVA1', 'sent');   -- atrasado: não desfaz
  select estado into v from public.campanha_destinatarios where id = dest;
  if v.estado <> 'lido' then raise exception 'FAIL: recibo atrasado desfez o estado (%)', v.estado; end if;
  if public.campanha_status_meta('wamid.INEXISTENTE', 'read') then raise exception 'FAIL: recibo de mensagem desconhecida não deveria casar'; end if;

  -- ---- segunda campanha: pausa, retomada, cancelamento, opt-out no último instante, lease vencida ----
  update public.campanhas_controle set limite_diario = 3, usados_no_dia = 0, proximo_disparo_em = now();
  update public.mensagens_whatsapp set criada_em = now() - interval '3 days' where origem_envio = 'campanha';
  insert into public.campanhas(nome, modelo_id, modelo_nome, modelo_idioma, mapeamento_parametros, filtros_publico, criada_por, intervalo_minimo_horas)
  values ('Segunda', 'm1', 'promo', 'pt_BR', '[{"tipo":"body","posicao":1,"origem":"primeiro_nome"}]', jsonb_build_object('contato_ids', jsonb_build_array(c1, c4, c6)), g, 24)
  returning id into camp;
  set local role authenticated; perform set_config('request.jwt.claim.sub', g::text, true);
  update public.campanhas set mapeamento_parametros = '[{"tipo":"body","posicao":1,"origem":"fixo","valor":"olá"}]' where id = camp;
  r := public.campanha_congelar_publico(camp);
  select revisao_hash into hash from public.campanhas where id = camp;
  if (r->>'aptos')::int <> 3 then raise exception 'FAIL: segunda campanha deveria ter 3 aptos (%)', r; end if;
  perform public.campanha_iniciar(camp, hash);
  perform public.campanha_pausar(camp, 'conferindo o texto');
  begin perform public.campanha_pausar(camp); raise exception 'FAIL: pausou duas vezes';
  exception when sqlstate '55000' then null; end;
  reset role;
  update public.campanhas_controle set proximo_disparo_em = now();
  select count(*) into n from public.campanha_reivindicar(10);
  if n <> 0 then raise exception 'FAIL: campanha pausada foi reivindicada'; end if;
  set local role authenticated; perform set_config('request.jwt.claim.sub', g::text, true);
  perform public.campanha_retomar(camp);
  reset role;

  -- limite diário (2) com 3 aptos: só 2 saem; o terceiro espera mesmo havendo fila
  update public.campanhas_controle set limite_diario = 2, usados_no_dia = 0;
  select count(*) into n from public.campanha_reivindicar(10);
  if n <> 2 then raise exception 'FAIL: o limite diário não limitou o lote (%)', n; end if;
  select usados_no_dia into n from public.campanhas_controle;
  if n <> 2 then raise exception 'FAIL: contador diário errado (%)', n; end if;
  update public.campanhas_controle set proximo_disparo_em = now();
  select count(*) into n from public.campanha_destinatarios where campanha_id = camp and estado = 'pendente';
  if n <> 1 then raise exception 'FAIL: deveria sobrar 1 pendente (%)', n; end if;
  select count(*) into n from public.campanha_reivindicar(10);
  if n <> 0 then raise exception 'FAIL: passou do limite diário (%)', n; end if;
  update public.campanhas_controle set limite_diario = 3, proximo_disparo_em = now();
  select count(*) into n from public.campanha_reivindicar(10);
  if n <> 1 then raise exception 'FAIL: o último deveria sair depois de subir o limite (%)', n; end if;

  -- opt-out no último instante: c4 revoga entre a reivindicação e a reserva
  select destinatario_id, lease_token into dest, tok from (select d.id as destinatario_id, d.lease_token from public.campanha_destinatarios d where d.campanha_id = camp and d.contato_id = c4) z;
  perform public.marketing_registrar_preferencia(c4, false, 'mandou sair às 10h');
  r := public.campanha_reservar(dest, tok, 'Olá');
  if (r->>'ok')::boolean or r->>'motivo' <> 'sem_consentimento' then raise exception 'FAIL: reservou para quem acabou de pedir para parar (%)', r; end if;
  select estado into v from public.campanha_destinatarios where id = dest;
  if v.estado <> 'ignorado' then raise exception 'FAIL: opt-out de última hora não ficou ignorado (%)', v.estado; end if;

  -- lease vencida: sem chamada iniciada volta à fila; com chamada iniciada vira INCERTO
  select d.id, d.lease_token into dest, tok from public.campanha_destinatarios d where d.campanha_id = camp and d.contato_id = c1;
  update public.campanha_destinatarios set lease_expira_em = now() - interval '1 minute' where id = dest;
  select d.id into msg from public.campanha_destinatarios d where d.campanha_id = camp and d.contato_id = c6;
  r := public.campanha_reservar(msg, (select lease_token from public.campanha_destinatarios where id = msg), 'Olá');
  perform public.campanha_marcar_chamada(msg, (select lease_token from public.campanha_destinatarios where id = msg));
  update public.campanha_destinatarios set lease_expira_em = now() - interval '1 minute' where id = msg;
  update public.campanhas_controle set proximo_disparo_em = now() + interval '1 hour';   -- só varre as leases, não reivindica
  perform * from public.campanha_reivindicar(10);
  select estado, chamada_iniciada_em into v from public.campanha_destinatarios where id = dest;
  if v.estado <> 'pendente' then raise exception 'FAIL: lease vencida sem chamada deveria voltar à fila (%)', v.estado; end if;
  select estado into v from public.campanha_destinatarios where id = msg;
  if v.estado <> 'incerto' then raise exception 'FAIL: lease vencida com chamada deveria ser INCERTO (%)', v.estado; end if;

  -- repetir: volta para a fila; na 5ª tentativa vira falha
  update public.campanhas_controle set proximo_disparo_em = now(), limite_diario = 100;
  select d.destinatario_id, d.lease_token into dest, tok from public.campanha_reivindicar(10) d where d.contato_id = c1;
  r := public.campanha_reservar(dest, tok, 'Olá');
  perform public.campanha_marcar_chamada(dest, tok);
  perform public.campanha_finalizar(dest, tok, 'repetir', null, 'limite temporário', interval '10 minutes');
  select * into v from public.campanha_destinatarios where id = dest;
  if v.estado <> 'pendente' or v.proxima_tentativa < now() + interval '9 minutes' then raise exception 'FAIL: repetir não reagendou (%)', v; end if;
  update public.campanha_destinatarios set tentativas = 4, proxima_tentativa = now() where id = dest;
  update public.campanhas_controle set proximo_disparo_em = now();
  select d.destinatario_id, d.lease_token into dest, tok from public.campanha_reivindicar(10) d where d.contato_id = c1;
  perform public.campanha_finalizar(dest, tok, 'repetir', null, 'limite temporário');
  select estado into v from public.campanha_destinatarios where id = dest;
  if v.estado <> 'falhou' then raise exception 'FAIL: 5ª tentativa deveria falhar (%)', v.estado; end if;

  -- pausa automática do sistema (só o servidor): uma campanha em envio vira pausada com o motivo
  update public.mensagens_whatsapp set criada_em = now() - interval '3 days' where origem_envio = 'campanha';
  insert into public.campanhas(nome, modelo_id, modelo_nome, modelo_idioma, mapeamento_parametros, filtros_publico, criada_por)
  values ('Auxiliar', 'm1', 'promo', 'pt_BR', '[{"tipo":"body","posicao":1,"origem":"fixo","valor":"x"}]', jsonb_build_object('contato_ids', jsonb_build_array(c1)), g) returning id into camp_aux;
  set local role authenticated; perform set_config('request.jwt.claim.sub', g::text, true);
  r := public.campanha_congelar_publico(camp_aux);
  perform public.campanha_iniciar(camp_aux, r->>'revisao_hash');
  begin perform public.campanha_pausar_sistema(camp_aux, 'x'); raise exception 'FAIL: gestor executou a pausa do sistema';
  exception when insufficient_privilege then null; end;
  reset role;
  select estado into v from public.campanhas where id = camp_aux;
  if v.estado is distinct from 'enviando' then raise exception 'FAIL: campanha auxiliar deveria estar em envio (%)', v.estado; end if;
  perform public.campanha_pausar_sistema(camp_aux, 'Modelo reprovado na Meta');
  select estado, motivo into v from public.campanhas where id = camp_aux;
  if v.estado is distinct from 'pausada' or v.motivo is distinct from 'Modelo reprovado na Meta' then raise exception 'FAIL: pausa automática errada (%)', v; end if;
  select count(*) into n from public.campanha_eventos where campanha_id = camp_aux and tipo = 'pausada_automatica';
  if n <> 1 then raise exception 'FAIL: pausa automática sem evento'; end if;

  -- cancelar: motivo obrigatório; pendentes viram cancelados
  insert into public.campanhas(nome, modelo_id, modelo_nome, modelo_idioma, mapeamento_parametros, filtros_publico, criada_por)
  values ('Terceira', 'm1', 'promo', 'pt_BR', '[{"tipo":"body","posicao":1,"origem":"fixo","valor":"x"}]', jsonb_build_object('contato_ids', jsonb_build_array(c1)), g) returning id into camp;
  update public.mensagens_whatsapp set criada_em = now() - interval '3 days' where origem_envio = 'campanha';
  set local role authenticated; perform set_config('request.jwt.claim.sub', g::text, true);
  r := public.campanha_congelar_publico(camp);
  select revisao_hash into hash from public.campanhas where id = camp;
  if (r->>'aptos')::int <> 1 then raise exception 'FAIL: terceira deveria ter 1 apto (%)', r; end if;
  perform public.campanha_iniciar(camp, hash);
  begin perform public.campanha_cancelar(camp, 'x'); raise exception 'FAIL: cancelou sem motivo';
  exception when sqlstate '22023' then null; end;
  perform public.campanha_cancelar(camp, 'texto errado no modelo');
  reset role;
  select count(*) into n from public.campanha_destinatarios where campanha_id = camp and estado = 'cancelado';
  if n <> 1 then raise exception 'FAIL: pendente não foi cancelado'; end if;
  begin delete from public.campanhas where id = camp; raise exception 'FAIL: apagou campanha cancelada';
  exception when sqlstate '55000' then null; end;

  -- filtro por etapa: ninguém está em 'ganho', então ninguém entra (nem como excluído)
  insert into public.campanhas(nome, modelo_id, modelo_nome, modelo_idioma, mapeamento_parametros, filtros_publico, criada_por)
  values ('Quarta', 'm1', 'promo', 'pt_BR', '[{"tipo":"body","posicao":1,"origem":"fixo","valor":"x"}]', '{"status":["ganho"]}', g) returning id into camp;
  set local role authenticated; perform set_config('request.jwt.claim.sub', g::text, true);
  r := public.campanha_congelar_publico(camp);
  begin perform public.campanha_iniciar(camp, r->>'revisao_hash'); raise exception 'FAIL: iniciou campanha sem nenhum apto';
  exception when sqlstate '22023' then null; end;
  reset role;
  select count(*) into n from public.campanha_destinatarios where campanha_id = camp;
  if (r->>'aptos')::int <> 0 or n <> 0 then raise exception 'FAIL: filtro por etapa não filtrou (% / %)', r, n; end if;

  -- painel e acesso
  select aptos, excluidos, falhas into v from public.campanhas_lista where nome = 'Promo de outubro v2';
  if v.aptos <> 1 or v.excluidos <> 5 then raise exception 'FAIL: campanhas_lista errada (%)', v; end if;
  set local role anon;
  begin perform 1 from public.campanhas; raise exception 'FAIL: anon leu campanhas';
  exception when insufficient_privilege then null; end;
  begin perform public.campanha_status_meta('x', 'read'); raise exception 'FAIL: anon executou função da fila';
  exception when insufficient_privilege then null; end;
  reset role;
  set local role authenticated; perform set_config('request.jwt.claim.sub', k::text, true);
  update public.campanhas_controle set limite_diario = 1;   -- o RLS filtra: não dá erro, não muda nada
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: consultor mudou o controle'; end if;
  select count(*) into n from public.campanhas;
  if n < 3 then raise exception 'FAIL: equipe não leu as campanhas'; end if;
  reset role;

  -- apagar o contato (LGPD) leva consentimento, trilha e destinatários; a conversa registra a campanha como sem origem
  delete from public.contatos_dados where id = c1;
  select count(*) into n from public.marketing_consentimentos where contato_id = c1;
  if n <> 0 then raise exception 'FAIL: consentimento sobreviveu ao contato'; end if;
  select count(*) into n from public.marketing_preferencias_eventos where contato_id = c1;
  if n <> 0 then raise exception 'FAIL: trilha sobreviveu ao contato'; end if;
end;
$$;
