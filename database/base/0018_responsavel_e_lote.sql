BEGIN;
-- RESPONSÁVEL PELA OPORTUNIDADE (núcleo) e AÇÕES EM LOTE no quadro.
--
-- Responsável: quem responde por aquela venda. Nasce com quem criou a oportunidade, qualquer pessoa ativa
-- da equipe pode trocar, e tem que ser alguém ATIVO (um usuário desligado deixa o campo vazio, que a tela
-- mostra como "sem responsável"). Vale também para venda ganha: de quem é o pós-venda continua importando.
--
-- Lote: mover etapa e trocar responsável de várias oportunidades de uma vez. As funções rodam com os
-- direitos de quem chama (SECURITY INVOKER): as mesmas travas do UPDATE normal valem para cada linha, e a
-- operação é TUDO OU NADA — se uma das oportunidades já foi encerrada ou não existe, nenhuma muda. Até 50 por vez.
-- Ganho e Perdido ficam de fora do lote de propósito: cada um exige valor, serviços ou motivo próprios.
--
-- Ideia adaptada do DeskcommCRM (MIT, © 2026 Rafael Melgaço): regras AT-06 (lote ≤ 50) e `fn_attendant_metrics`.

ALTER TABLE public.oportunidades ADD COLUMN responsavel_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL;
CREATE INDEX oportunidades_responsavel_idx ON public.oportunidades(responsavel_id) WHERE responsavel_id IS NOT NULL;

CREATE FUNCTION public.oportunidade_responsavel() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  -- Criada por uma pessoa da equipe sem responsável informado: ela é a responsável.
  if tg_op = 'INSERT' and new.responsavel_id is null and auth.uid() is not null
     and exists (select 1 from public.usuarios u where u.id = auth.uid() and u.ativo) then
    new.responsavel_id := auth.uid();
  end if;
  if new.responsavel_id is not null and (tg_op = 'INSERT' or new.responsavel_id is distinct from old.responsavel_id)
     and not exists (select 1 from public.usuarios u where u.id = new.responsavel_id and u.ativo) then
    raise exception 'O responsável precisa ser uma pessoa ativa da equipe.' using errcode = '22023';
  end if;
  return new;
end;
$$;
CREATE TRIGGER oportunidade_responsavel BEFORE INSERT OR UPDATE ON public.oportunidades FOR EACH ROW EXECUTE FUNCTION public.oportunidade_responsavel();

CREATE FUNCTION public.oportunidades_mover_em_lote(p_ids uuid[], p_status text) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
declare v_ids uuid[]; n integer;
begin
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_ids, '{}')) x;
  if cardinality(v_ids) = 0 then raise exception 'Escolha ao menos uma oportunidade.' using errcode = '22023'; end if;
  if cardinality(v_ids) > 50 then raise exception 'Escolha no máximo 50 oportunidades por vez.' using errcode = '22023'; end if;
  if not exists (select 1 from public.etapas_funil e where e.chave = p_status and e.tipo = 'aberta') then
    raise exception 'O lote só move para etapas em andamento. Ganho e Perdido pedem dados de cada oportunidade.' using errcode = '22023';
  end if;
  update public.oportunidades set status = p_status where id = any(v_ids) and fechado_em is null and status not in ('ganho', 'perdido');
  get diagnostics n = row_count;
  if n <> cardinality(v_ids) then
    raise exception 'Alguma oportunidade já foi encerrada ou não existe mais. Nada foi alterado.' using errcode = '22023';
  end if;
  return n;
end;
$$;

CREATE FUNCTION public.oportunidades_definir_responsavel_em_lote(p_ids uuid[], p_responsavel uuid) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
declare v_ids uuid[]; n integer;
begin
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_ids, '{}')) x;
  if cardinality(v_ids) = 0 then raise exception 'Escolha ao menos uma oportunidade.' using errcode = '22023'; end if;
  if cardinality(v_ids) > 50 then raise exception 'Escolha no máximo 50 oportunidades por vez.' using errcode = '22023'; end if;
  update public.oportunidades set responsavel_id = p_responsavel where id = any(v_ids);
  get diagnostics n = row_count;
  if n <> cardinality(v_ids) then raise exception 'Alguma oportunidade não existe mais. Nada foi alterado.' using errcode = '22023'; end if;
  return n;
end;
$$;

REVOKE EXECUTE ON FUNCTION public.oportunidades_mover_em_lote(uuid[], text), public.oportunidades_definir_responsavel_em_lote(uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.oportunidades_mover_em_lote(uuid[], text), public.oportunidades_definir_responsavel_em_lote(uuid[], uuid) TO authenticated, service_role;

INSERT INTO crm_base_private.schema_migrations(version) VALUES ('0018_responsavel_e_lote');
NOTIFY pgrst, 'reload schema';
COMMIT;
