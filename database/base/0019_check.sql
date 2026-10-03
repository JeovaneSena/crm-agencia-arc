-- Ensaio da 0019_importar_contatos.
do $$
declare
  g uuid := gen_random_uuid(); k uuid := gen_random_uuid(); off uuid := gen_random_uuid();
  tag uuid; r jsonb; n integer; linhas jsonb;
begin
  insert into auth.users(id) values (g); insert into auth.users(id) values (k); insert into auth.users(id) values (off);
  update public.usuarios set papel = 'gestor' where id = g;
  update public.usuarios set papel = 'consultor' where id in (k, off);
  update public.usuarios set ativo = false where id = off;
  insert into public.contatos_dados(nome, whatsapp, empresa) values ('Antigo', '5511900000001', 'Empresa Velha');
  insert into public.etiquetas(nome) values ('Lote outubro') returning id into tag;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  r := public.contatos_importar(jsonb_build_array(
    jsonb_build_object('nome', '  Ana ', 'whatsapp', '5511900000002', 'empresa', 'Acme', 'email', 'ANA@Exemplo.com'),
    jsonb_build_object('nome', 'Antigo Mudado', 'whatsapp', '5511900000001', 'empresa', 'Outra'),
    jsonb_build_object('whatsapp', '+55 (11) 90000-0003'),
    jsonb_build_object('nome', 'Sem DDD', 'whatsapp', '900000004'),
    jsonb_build_object('nome', 'Repetido', 'whatsapp', '5511900000002'),
    jsonb_build_object('nome', 'Email ruim', 'whatsapp', '5511900000005', 'email', 'nao-e-email')
  ), tag);
  reset role;

  if r <> jsonb_build_object('criados', 3, 'ja_existiam', 2, 'ignoradas', 1) then raise exception 'FAIL: contagens erradas (%)', r; end if;
  -- o contato antigo não é alterado
  if (select empresa from public.contatos_dados where whatsapp = '5511900000001') <> 'Empresa Velha' or (select nome from public.contatos_dados where whatsapp = '5511900000001') <> 'Antigo' then raise exception 'FAIL: importação alterou contato existente'; end if;
  -- campos normalizados
  if (select nome from public.contatos_dados where whatsapp = '5511900000002') <> 'Ana' or (select email from public.contatos_dados where whatsapp = '5511900000002') <> 'ana@exemplo.com' then raise exception 'FAIL: nome/e-mail não normalizados'; end if;
  if (select nome from public.contatos_dados where whatsapp = '5511900000003') is not null then raise exception 'FAIL: nome em branco deveria ser nulo'; end if;
  if (select email from public.contatos_dados where whatsapp = '5511900000005') is not null then raise exception 'FAIL: e-mail inválido deveria ser descartado (contato entra)'; end if;
  -- todos entram como novo lead, e SÓ os novos levam a etiqueta
  select count(*) into n from public.contatos_dados where whatsapp in ('5511900000002','5511900000003','5511900000005') and status = 'novo_lead'; if n <> 3 then raise exception 'FAIL: status dos importados (%)', n; end if;
  select count(*) into n from public.contato_etiquetas where etiqueta_id = tag; if n <> 3 then raise exception 'FAIL: etiqueta só nos novos (%)', n; end if;
  if exists (select 1 from public.contato_etiquetas ce join public.contatos_dados d on d.id = ce.contato_id where d.whatsapp = '5511900000001') then raise exception 'FAIL: etiquetou o contato antigo'; end if;
  -- importar NÃO cria consentimento de marketing (a tabela só existe com o módulo campanhas)
  if to_regclass('public.marketing_consentimentos') is not null then
    execute 'select count(*) from public.marketing_consentimentos' into n; if n <> 0 then raise exception 'FAIL: importação criou consentimento'; end if;
  end if;

  -- validações de entrada
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  begin perform public.contatos_importar('[]'::jsonb); raise exception 'FAIL: lote vazio';
  exception when sqlstate '22023' then null; end;
  begin perform public.contatos_importar('{"a":1}'::jsonb); raise exception 'FAIL: não-array';
  exception when sqlstate '22023' then null; end;
  begin perform public.contatos_importar(null); raise exception 'FAIL: nulo';
  exception when sqlstate '22023' then null; end;
  select jsonb_agg(jsonb_build_object('whatsapp', '55218' || lpad(i::text, 8, '0'))) into linhas from generate_series(1, 501) i;
  begin perform public.contatos_importar(linhas); raise exception 'FAIL: 501 linhas passaram';
  exception when sqlstate '22023' then null; end;
  begin perform public.contatos_importar('[{"whatsapp":"5511911111111"}]'::jsonb, gen_random_uuid()); raise exception 'FAIL: etiqueta inexistente';
  exception when sqlstate 'P0002' then null; end;
  reset role;
  if exists (select 1 from public.contatos_dados where whatsapp = '5511911111111') then raise exception 'FAIL: lote recusado deixou contato para trás'; end if;
  -- 500 linhas passam
  select jsonb_agg(jsonb_build_object('whatsapp', '55218' || lpad(i::text, 8, '0'))) into linhas from generate_series(1, 500) i;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', k::text, true);
  r := public.contatos_importar(linhas);
  reset role;
  if (r ->> 'criados')::int <> 500 then raise exception 'FAIL: 500 linhas deveriam entrar (%)', r; end if;

  -- desligado e anon não importam
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', off::text, true);
  begin perform public.contatos_importar('[{"whatsapp":"5511922222222"}]'::jsonb); raise exception 'FAIL: desligado importou';
  exception when sqlstate '42501' then null; end;
  reset role;
  set local role anon;
  begin perform public.contatos_importar('[{"whatsapp":"5511922222222"}]'::jsonb); raise exception 'FAIL: anon importou';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;
