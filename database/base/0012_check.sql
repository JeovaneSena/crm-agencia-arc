-- Ensaio da 0012_retencao_de_midia.
do $$
declare
  g uuid := gen_random_uuid(); k uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  velha uuid := gen_random_uuid(); nova uuid := gen_random_uuid(); texto uuid := gen_random_uuid();
  n integer; v record;
begin
  insert into auth.users(id) values (g);
  insert into auth.users(id) values (k);
  update public.usuarios set papel = 'gestor' where id = g;
  update public.usuarios set papel = 'consultor' where id = k;
  insert into public.contatos_dados(id, nome, whatsapp) values (c, 'Cliente', '5511933330012');
  insert into public.mensagens_whatsapp(id, contato_id, autor, tipo, midia_url, provedor, id_externo, criada_em) values
    (velha, c, 'cliente', 'imagem', c || '/velha.jpg', 'uazapi', 'v1', now() - interval '400 days'),
    (nova,  c, 'cliente', 'imagem', c || '/nova.jpg',  'uazapi', 'v2', now() - interval '5 days'),
    (texto, c, 'cliente', 'texto',  null,              'uazapi', 'v3', now() - interval '500 days');

  -- de fábrica: sem prazo, nada vence (guardar para sempre)
  if (select retencao_midia_dias from public.conversas_config) is not null then raise exception 'FAIL: a retenção nasceu ligada'; end if;
  select count(*) into n from public.midias_vencidas(); if n <> 0 then raise exception 'FAIL: sem prazo, algo venceu (%)', n; end if;

  -- só o gestor define o prazo; consultor não consegue (a policy filtra a linha), e menos de 30 dias é recusado
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  update public.conversas_config set retencao_midia_dias = 60;
  reset role;
  if (select retencao_midia_dias from public.conversas_config) is not null then raise exception 'FAIL: consultor definiu o prazo'; end if;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', g::text, true);
  begin update public.conversas_config set retencao_midia_dias = 7; raise exception 'FAIL: prazo de 7 dias passou';
  exception when check_violation then null; end;
  update public.conversas_config set retencao_midia_dias = 90;
  reset role;
  if (select retencao_midia_dias from public.conversas_config) <> 90 then raise exception 'FAIL: gestor não definiu o prazo'; end if;

  -- com prazo: vence só o arquivo antigo; mensagem de texto antiga e arquivo recente ficam
  select count(*) into n from public.midias_vencidas(); if n <> 1 then raise exception 'FAIL: deveria vencer 1 (%)', n; end if;
  select * into v from public.midias_vencidas();
  if v.id <> velha or v.midia_url <> c || '/velha.jpg' then raise exception 'FAIL: venceu o arquivo errado (%)', v; end if;

  -- só o servidor chama
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', g::text, true);
  begin perform public.midias_vencidas(); raise exception 'FAIL: gestor chamou midias_vencidas';
  exception when insufficient_privilege then null; end;
  begin perform public.midias_marcar_removidas(array[velha]); raise exception 'FAIL: gestor chamou midias_marcar_removidas';
  exception when insufficient_privilege then null; end;
  reset role;

  -- marcar: o caminho some, fica a data; repetir é inofensivo; a mensagem e a transcrição permanecem
  update public.mensagens_whatsapp set conteudo = 'transcrição' where id = velha;
  if public.midias_marcar_removidas(array[velha, texto]) <> 1 then raise exception 'FAIL: deveria marcar só a que tem arquivo'; end if;
  if public.midias_marcar_removidas(array[velha]) <> 0 then raise exception 'FAIL: marcar de novo deveria ser 0'; end if;
  select * into v from public.mensagens_whatsapp where id = velha;
  if v.midia_url is not null or v.midia_removida_em is null or v.conteudo <> 'transcrição' then raise exception 'FAIL: marcação errada (%)', v; end if;
  select count(*) into n from public.midias_vencidas(); if n <> 0 then raise exception 'FAIL: arquivo já removido voltou a vencer'; end if;
end $$;
