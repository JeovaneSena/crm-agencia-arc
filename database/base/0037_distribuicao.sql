BEGIN;
CREATE TABLE public.distribuicao_config(id boolean PRIMARY KEY DEFAULT true CHECK(id),ativa boolean NOT NULL DEFAULT false,equipe uuid[] NOT NULL DEFAULT '{}',ultimo uuid,versao integer NOT NULL DEFAULT 1);
INSERT INTO public.distribuicao_config DEFAULT VALUES;
ALTER TABLE public.distribuicao_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.distribuicao_config FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.distribuicao_config TO authenticated;
GRANT ALL ON public.distribuicao_config TO service_role;
CREATE POLICY gestor_le ON public.distribuicao_config FOR SELECT TO authenticated USING(public.usuario_e_gestor());
CREATE TRIGGER auditoria AFTER INSERT OR UPDATE OR DELETE ON public.distribuicao_config FOR EACH ROW EXECUTE FUNCTION public.auditar_mudanca();
CREATE FUNCTION public.distribuicao_salvar(p_ativa boolean,p_equipe uuid[],p_versao integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ BEGIN
 IF NOT public.usuario_e_gestor() THEN RAISE EXCEPTION 'Só gestor configura a distribuição.' USING errcode='42501';END IF;
 IF p_ativa IS NULL OR p_equipe IS NULL OR cardinality(p_equipe)>100 OR (p_ativa AND cardinality(p_equipe)=0) OR cardinality(p_equipe)<>(SELECT count(DISTINCT x) FROM unnest(p_equipe) x) OR EXISTS(SELECT 1 FROM unnest(p_equipe) x WHERE x IS NULL OR NOT EXISTS(SELECT 1 FROM public.usuarios WHERE id=x AND ativo)) THEN RAISE EXCEPTION 'Escolha pessoas ativas, sem duplicação.' USING errcode='22023';END IF;
 UPDATE public.distribuicao_config SET ativa=p_ativa,equipe=p_equipe,versao=versao+1 WHERE id AND versao=p_versao;
 IF NOT FOUND THEN RAISE EXCEPTION 'Configuração mudou. Atualize.' USING errcode='22023';END IF;
END $$;
CREATE FUNCTION public.oportunidade_distribuir() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE c public.distribuicao_config;pool uuid[];i integer;BEGIN
 IF new.responsavel_id IS NOT NULL THEN RETURN new;END IF;
 SELECT * INTO c FROM public.distribuicao_config WHERE id FOR UPDATE;
 IF NOT c.ativa THEN RETURN new;END IF;
 SELECT coalesce(array_agg(x ORDER BY n),'{}') INTO pool FROM unnest(c.equipe) WITH ORDINALITY a(x,n) JOIN public.usuarios u ON u.id=x AND u.ativo;
 IF cardinality(pool)=0 THEN RETURN new;END IF;
 i:=coalesce(array_position(pool,c.ultimo),0)%cardinality(pool)+1;
 new.responsavel_id:=pool[i];UPDATE public.distribuicao_config SET ultimo=pool[i] WHERE id;RETURN new;
END $$;
-- Executa antes do gatilho que usa o criador como responsável padrão.
CREATE TRIGGER oportunidade_a_distribuir BEFORE INSERT ON public.oportunidades FOR EACH ROW EXECUTE FUNCTION public.oportunidade_distribuir();
REVOKE ALL ON FUNCTION public.distribuicao_salvar(boolean,uuid[],integer),public.oportunidade_distribuir() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.distribuicao_salvar(boolean,uuid[],integer) TO authenticated;
INSERT INTO crm_base_private.schema_migrations(version) VALUES('0037_distribuicao');
NOTIFY pgrst,'reload schema';
COMMIT;
