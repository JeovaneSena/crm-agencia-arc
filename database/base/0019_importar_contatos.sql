BEGIN;
-- IMPORTAR CONTATOS DE UMA PLANILHA (núcleo). A tela lê o CSV no navegador, normaliza os telefones e manda as
-- linhas aqui; esta função revalida tudo e grava numa única transação (até 500 linhas por vez).
--
-- Roda com os direitos de quem chama (SECURITY INVOKER): valem as mesmas regras e travas de criar um contato
-- à mão. Telefone que já existe NÃO é alterado nem duplicado (o contato antigo fica como está) e entra na
-- contagem "já existiam". Importar NÃO registra consentimento de marketing: quem foi importado só recebe
-- campanha depois de o gestor registrar a autorização, contato a contato ou pela rotina própria da instalação.
-- Opcionalmente marca os contatos NOVOS com uma etiqueta (para achar o lote depois).
--
-- Ideia adaptada do DeskcommCRM (MIT, © 2026 Rafael Melgaço): `lib/leads/planilha.ts`.

CREATE FUNCTION public.contatos_importar(p_linhas jsonb, p_etiqueta uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
declare
  e jsonb; v_whats text; v_email text; v_id uuid;
  v_criados integer := 0; v_existiam integer := 0; v_ignoradas integer := 0; v_ids uuid[] := '{}';
begin
  if auth.uid() is null or not exists (select 1 from public.usuarios u where u.id = auth.uid() and u.ativo) then
    raise exception 'Só a equipe importa contatos.' using errcode = '42501';
  end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) not between 1 and 500 then
    raise exception 'Envie de 1 a 500 linhas por importação.' using errcode = '22023';
  end if;
  if p_etiqueta is not null and not exists (select 1 from public.etiquetas where id = p_etiqueta) then
    raise exception 'Etiqueta não encontrada.' using errcode = 'P0002';
  end if;
  for e in select value from jsonb_array_elements(p_linhas) loop
    v_id := null;
    v_whats := regexp_replace(coalesce(e ->> 'whatsapp', ''), '\D', '', 'g');
    if v_whats !~ '^[0-9]{12,15}$' then v_ignoradas := v_ignoradas + 1; continue; end if;
    v_email := nullif(lower(btrim(coalesce(e ->> 'email', ''))), '');
    if v_email is not null and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then v_email := null; end if;
    insert into public.contatos_dados (nome, whatsapp, empresa, email)
      values (nullif(btrim(left(coalesce(e ->> 'nome', ''), 200)), ''), v_whats, nullif(btrim(left(coalesce(e ->> 'empresa', ''), 200)), ''), v_email)
      on conflict (whatsapp) where whatsapp is not null do nothing
      returning id into v_id;
    if v_id is null then v_existiam := v_existiam + 1; else v_criados := v_criados + 1; v_ids := v_ids || v_id; end if;
  end loop;
  if p_etiqueta is not null and cardinality(v_ids) > 0 then
    insert into public.contato_etiquetas (contato_id, etiqueta_id) select unnest(v_ids), p_etiqueta;
  end if;
  return jsonb_build_object('criados', v_criados, 'ja_existiam', v_existiam, 'ignoradas', v_ignoradas);
end;
$$;
REVOKE EXECUTE ON FUNCTION public.contatos_importar(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contatos_importar(jsonb, uuid) TO authenticated, service_role;

INSERT INTO crm_base_private.schema_migrations(version) VALUES ('0019_importar_contatos');
NOTIFY pgrst, 'reload schema';
COMMIT;
