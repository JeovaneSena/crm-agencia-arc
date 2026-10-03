BEGIN;
-- ETIQUETAS (núcleo): um vocabulário da empresa para marcar contatos ("quente", "indicação", "sem WhatsApp").
-- Qualquer pessoa da equipe cria etiqueta e marca/desmarca contatos; só o gestor renomeia, troca a cor,
-- junta duas em uma e exclui (mexer no vocabulário muda a ficha de muita gente).
-- O nome é único sem diferenciar caixa nem espaços repetidos. Cada contato leva até 20 etiquetas.
--
-- Ideia adaptada do DeskcommCRM (MIT, © 2026 Rafael Melgaço): tela de Tags (renomear, juntar, excluir).

CREATE TABLE public.etiquetas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (length(nome) BETWEEN 1 AND 30),
  cor text NOT NULL DEFAULT 'accent' CHECK (cor IN ('accent','info','success','warning','purple','danger')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX etiquetas_nome_unico ON public.etiquetas (lower(nome));

CREATE FUNCTION public.etiquetas_normaliza() RETURNS trigger LANGUAGE plpgsql AS $$
begin
  new.nome := btrim(regexp_replace(new.nome, '\s+', ' ', 'g'));
  return new;
end;
$$;
CREATE TRIGGER etiquetas_normaliza BEFORE INSERT OR UPDATE OF nome ON public.etiquetas FOR EACH ROW EXECUTE FUNCTION public.etiquetas_normaliza();

CREATE TABLE public.contato_etiquetas (
  contato_id uuid NOT NULL REFERENCES public.contatos_dados(id) ON DELETE CASCADE,
  etiqueta_id uuid NOT NULL REFERENCES public.etiquetas(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contato_id, etiqueta_id)
);
CREATE INDEX contato_etiquetas_etiqueta_idx ON public.contato_etiquetas(etiqueta_id);

CREATE FUNCTION public.contato_etiquetas_limite() RETURNS trigger LANGUAGE plpgsql AS $$
begin
  if (select count(*) from public.contato_etiquetas where contato_id = new.contato_id) >= 20 then
    raise exception 'Um contato leva no máximo 20 etiquetas.' using errcode = '23514';
  end if;
  return new;
end;
$$;
CREATE TRIGGER contato_etiquetas_limite BEFORE INSERT ON public.contato_etiquetas FOR EACH ROW EXECUTE FUNCTION public.contato_etiquetas_limite();

ALTER TABLE public.etiquetas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contato_etiquetas ENABLE ROW LEVEL SECURITY;
CREATE POLICY equipe_le ON public.etiquetas FOR SELECT TO authenticated USING (true);
CREATE POLICY equipe_cria ON public.etiquetas FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.ativo));
CREATE POLICY gestor_edita ON public.etiquetas FOR UPDATE TO authenticated USING (public.usuario_e_gestor()) WITH CHECK (public.usuario_e_gestor());
CREATE POLICY gestor_apaga ON public.etiquetas FOR DELETE TO authenticated USING (public.usuario_e_gestor());
CREATE POLICY equipe_le ON public.contato_etiquetas FOR SELECT TO authenticated USING (true);
CREATE POLICY equipe_marca ON public.contato_etiquetas FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.ativo));
CREATE POLICY equipe_desmarca ON public.contato_etiquetas FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.ativo));

REVOKE ALL ON public.etiquetas, public.contato_etiquetas FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.etiquetas TO authenticated;
GRANT INSERT (nome, cor) ON public.etiquetas TO authenticated;
GRANT UPDATE (nome, cor) ON public.etiquetas TO authenticated;
GRANT SELECT, DELETE ON public.contato_etiquetas TO authenticated;
GRANT INSERT (contato_id, etiqueta_id) ON public.contato_etiquetas TO authenticated;
GRANT ALL ON public.etiquetas, public.contato_etiquetas TO service_role;

-- Junta `origem` em `destino`: quem tinha a primeira passa a ter a segunda, e a primeira some.
-- Contato que já está no limite de 20 simplesmente perde a etiqueta de origem. Devolve quantos contatos migraram.
CREATE FUNCTION public.etiqueta_juntar(p_origem uuid, p_destino uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare r record; n integer := 0;
begin
  if not public.usuario_e_gestor() then raise exception 'Só o gestor junta etiquetas.' using errcode = '42501'; end if;
  if p_origem = p_destino then raise exception 'Escolha duas etiquetas diferentes.' using errcode = '22023'; end if;
  if not exists (select 1 from public.etiquetas where id = p_origem) or not exists (select 1 from public.etiquetas where id = p_destino) then
    raise exception 'Etiqueta não encontrada.' using errcode = 'P0002';
  end if;
  for r in select contato_id from public.contato_etiquetas where etiqueta_id = p_origem
            and not exists (select 1 from public.contato_etiquetas d where d.contato_id = contato_etiquetas.contato_id and d.etiqueta_id = p_destino) loop
    begin
      insert into public.contato_etiquetas(contato_id, etiqueta_id) values (r.contato_id, p_destino);
      n := n + 1;
    exception when check_violation then null;   -- no limite: perde a de origem
    end;
  end loop;
  delete from public.etiquetas where id = p_origem;
  return n;
end;
$$;
REVOKE EXECUTE ON FUNCTION public.etiqueta_juntar(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.etiqueta_juntar(uuid, uuid) TO authenticated, service_role;

INSERT INTO crm_base_private.schema_migrations(version) VALUES ('0017_etiquetas');
NOTIFY pgrst, 'reload schema';
COMMIT;
