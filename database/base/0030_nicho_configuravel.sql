BEGIN;
CREATE TABLE public.campos_personalizados (
 chave text PRIMARY KEY CHECK(chave ~ '^[a-z][a-z0-9_]{1,39}$'),
 rotulo text NOT NULL CHECK(length(btrim(rotulo)) BETWEEN 1 AND 80),
 entidade text NOT NULL CHECK(entidade IN ('contato','oportunidade')),
 tipo text NOT NULL CHECK(tipo IN ('texto','numero','data','opcao','booleano')),
 opcoes text[] NOT NULL DEFAULT '{}',obrigatorio_em text[] NOT NULL DEFAULT '{}',
 ativo boolean NOT NULL DEFAULT true,versao integer NOT NULL DEFAULT 1);
CREATE TABLE public.motivos_perda (
 chave text PRIMARY KEY CHECK(chave ~ '^[a-z][a-z0-9_]{1,59}$'),
 rotulo text NOT NULL CHECK(length(btrim(rotulo)) BETWEEN 1 AND 80),
 exige_retomada boolean NOT NULL DEFAULT false,ativo boolean NOT NULL DEFAULT true,versao integer NOT NULL DEFAULT 1);
INSERT INTO public.motivos_perda(chave,rotulo,exige_retomada) VALUES
 ('sem_orcamento','Sem orçamento',false),('nao_e_o_momento','Não é o momento',true),
 ('escolheu_outra','Escolheu outra solução',false),('parou_de_responder','Parou de responder',false),
 ('nao_decide','Não é quem decide',false),('sem_perfil','Não tem o perfil',false);
ALTER TABLE public.oportunidades DROP CONSTRAINT oportunidades_motivo_perda_check;
ALTER TABLE public.oportunidades ADD CONSTRAINT oportunidades_motivo_perda_fkey FOREIGN KEY(motivo_perda) REFERENCES public.motivos_perda(chave);
ALTER TABLE public.contatos_dados ADD COLUMN campos_custom jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(campos_custom)='object'),ADD COLUMN campos_versao integer NOT NULL DEFAULT 1;
ALTER TABLE public.oportunidades ADD COLUMN campos_custom jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(campos_custom)='object');
CREATE TABLE public.preparacao_crm(id boolean PRIMARY KEY DEFAULT true CHECK(id),modelo text NOT NULL DEFAULT 'generico',funil_confirmado boolean NOT NULL DEFAULT false,concluida_em timestamptz);
INSERT INTO public.preparacao_crm DEFAULT VALUES;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['campos_personalizados','motivos_perda','preparacao_crm'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
 EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 EXECUTE format('CREATE POLICY equipe_le ON public.%I FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.usuarios WHERE id=auth.uid() AND ativo))',t);
 END LOOP;
END $$;
CREATE FUNCTION public.campo_definir(p_chave text,p_rotulo text,p_entidade text,p_tipo text,p_opcoes text[],p_etapas text[],p_ativo boolean,p_versao integer DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE c public.campos_personalizados; BEGIN
 IF NOT public.usuario_e_gestor() THEN RAISE EXCEPTION 'Só gestor configura campos.' USING errcode='42501';END IF;
 PERFORM 1 FROM public.preparacao_crm WHERE id FOR UPDATE;
 SELECT * INTO c FROM public.campos_personalizados WHERE chave=p_chave FOR UPDATE;
 IF (c.chave IS NULL AND p_versao IS NOT NULL) OR (c.chave IS NOT NULL AND c.versao IS DISTINCT FROM p_versao) THEN RAISE EXCEPTION 'Configuração mudou. Atualize.' USING errcode='22023';END IF;
 IF c.chave IS NOT NULL AND (c.entidade IS DISTINCT FROM p_entidade OR c.tipo IS DISTINCT FROM p_tipo OR c.opcoes IS DISTINCT FROM p_opcoes) THEN RAISE EXCEPTION 'Tipo e opções são permanentes. Crie outro campo.' USING errcode='22023';END IF;
 IF c.chave IS NULL AND (SELECT count(*) FROM public.campos_personalizados)>=50 THEN RAISE EXCEPTION 'Limite de 50 campos.' USING errcode='22023';END IF;
 IF p_opcoes IS NULL OR p_etapas IS NULL OR p_ativo IS NULL OR cardinality(p_opcoes)>30 OR cardinality(p_etapas)>8
 OR 'novo_lead'=ANY(p_etapas)
 OR EXISTS(SELECT 1 FROM unnest(p_etapas) x WHERE x IS NULL OR NOT EXISTS(SELECT 1 FROM public.etapas_funil e WHERE e.chave=x))
 OR EXISTS(SELECT 1 FROM unnest(p_opcoes) x WHERE x IS NULL OR length(btrim(x)) NOT BETWEEN 1 AND 80 OR x<>btrim(x))
 OR cardinality(p_opcoes)<>(SELECT count(DISTINCT x) FROM unnest(p_opcoes) x)
 OR (p_tipo='opcao' AND cardinality(p_opcoes)=0) OR (p_tipo<>'opcao' AND cardinality(p_opcoes)>0) THEN RAISE EXCEPTION 'Definição inválida.' USING errcode='22023';END IF;
 INSERT INTO public.campos_personalizados VALUES(p_chave,btrim(p_rotulo),p_entidade,p_tipo,p_opcoes,p_etapas,p_ativo,1)
 ON CONFLICT(chave) DO UPDATE SET rotulo=excluded.rotulo,obrigatorio_em=excluded.obrigatorio_em,ativo=excluded.ativo,versao=campos_personalizados.versao+1;
END $$;
CREATE FUNCTION public.motivo_perda_definir(p_chave text,p_rotulo text,p_retomada boolean,p_ativo boolean,p_versao integer DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE m public.motivos_perda; BEGIN
 IF NOT public.usuario_e_gestor() THEN RAISE EXCEPTION 'Só gestor configura motivos.' USING errcode='42501';END IF;
 PERFORM 1 FROM public.preparacao_crm WHERE id FOR UPDATE;
 SELECT * INTO m FROM public.motivos_perda WHERE chave=p_chave FOR UPDATE;
 IF (m.chave IS NULL AND p_versao IS NOT NULL) OR (m.chave IS NOT NULL AND m.versao IS DISTINCT FROM p_versao) THEN RAISE EXCEPTION 'Configuração mudou. Atualize.' USING errcode='22023';END IF;
 IF p_chave='nao_e_o_momento' AND p_retomada IS DISTINCT FROM true THEN RAISE EXCEPTION 'Este motivo exige retomada.' USING errcode='22023';END IF;
 IF m.chave IS NULL AND (SELECT count(*) FROM public.motivos_perda)>=50 THEN RAISE EXCEPTION 'Limite de 50 motivos.' USING errcode='22023';END IF;
 INSERT INTO public.motivos_perda VALUES(p_chave,btrim(p_rotulo),p_retomada,p_ativo,1) ON CONFLICT(chave) DO UPDATE SET rotulo=excluded.rotulo,exige_retomada=excluded.exige_retomada,ativo=excluded.ativo,versao=motivos_perda.versao+1;
END $$;
CREATE OR REPLACE FUNCTION public.rotulo_perda(p_motivo text) RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $$ SELECT rotulo FROM public.motivos_perda WHERE chave=p_motivo $$;
CREATE FUNCTION public.campos_validar(p_entidade text,p_valores jsonb,p_antes jsonb DEFAULT '{}') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE k text;v jsonb;c public.campos_personalizados;d date; BEGIN
 IF jsonb_typeof(p_valores) IS DISTINCT FROM 'object' OR pg_column_size(p_valores)>120000 THEN RAISE EXCEPTION 'Campos inválidos.' USING errcode='22023';END IF;
 FOR k,v IN SELECT * FROM jsonb_each(p_antes) LOOP
  IF EXISTS(SELECT 1 FROM public.campos_personalizados WHERE chave=k AND entidade=p_entidade AND NOT ativo) AND v IS DISTINCT FROM p_valores->k THEN RAISE EXCEPTION 'Campo arquivado: %',k USING errcode='22023';END IF;
 END LOOP;
 FOR k,v IN SELECT * FROM jsonb_each(p_valores) LOOP
  SELECT * INTO c FROM public.campos_personalizados WHERE chave=k AND entidade=p_entidade;
  IF c.chave IS NULL THEN RAISE EXCEPTION 'Campo desconhecido: %',k USING errcode='22023';END IF;
  IF NOT c.ativo THEN
   IF v IS DISTINCT FROM p_antes->k THEN RAISE EXCEPTION 'Campo arquivado: %',c.rotulo USING errcode='22023';END IF;
   CONTINUE;
  END IF;
  IF v='null'::jsonb OR (jsonb_typeof(v)='string' AND btrim(v#>>'{}')='') THEN CONTINUE;END IF;
  IF (c.tipo='texto' AND (jsonb_typeof(v)<>'string' OR length(v#>>'{}')>2000))
   OR (c.tipo='numero' AND NOT CASE WHEN jsonb_typeof(v)='number' THEN abs((v#>>'{}')::numeric)<=1e15 ELSE false END)
   OR (c.tipo='booleano' AND jsonb_typeof(v)<>'boolean')
   OR (c.tipo='opcao' AND (jsonb_typeof(v)<>'string' OR NOT (v#>>'{}'=ANY(c.opcoes)))) THEN RAISE EXCEPTION 'Valor inválido: %',c.rotulo USING errcode='22023';END IF;
  IF c.tipo='data' THEN
   BEGIN
    IF jsonb_typeof(v)<>'string' OR (v#>>'{}') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'data';END IF;
    d:=(v#>>'{}')::date;IF to_char(d,'YYYY-MM-DD')<>v#>>'{}' THEN RAISE EXCEPTION 'data';END IF;
   EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Valor inválido: %',c.rotulo USING errcode='22023';END;
  END IF;
 END LOOP;
END $$;
CREATE FUNCTION public.campos_contato_validar() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ BEGIN
 IF current_setting('role')='authenticated' AND (tg_op='INSERT' OR new.campos_custom IS DISTINCT FROM old.campos_custom) AND NOT EXISTS(SELECT 1 FROM public.usuarios WHERE id=auth.uid() AND ativo) THEN RAISE EXCEPTION 'Sem acesso aos campos.' USING errcode='42501';END IF;
 PERFORM public.campos_validar('contato',new.campos_custom,CASE WHEN tg_op='UPDATE' THEN old.campos_custom ELSE '{}' END);
 new.campos_versao:=CASE WHEN tg_op='UPDATE' THEN old.campos_versao+CASE WHEN new.campos_custom IS DISTINCT FROM old.campos_custom THEN 1 ELSE 0 END ELSE 1 END;RETURN new;
END $$;
CREATE TRIGGER contato_campos BEFORE INSERT OR UPDATE ON public.contatos_dados FOR EACH ROW EXECUTE FUNCTION public.campos_contato_validar();
CREATE FUNCTION public.campos_contato_salvar(p_contato uuid,p_valores jsonb,p_versao integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.usuarios WHERE id=auth.uid() AND ativo) THEN RAISE EXCEPTION 'Sem acesso.' USING errcode='42501';END IF;
 UPDATE public.contatos_dados SET campos_custom=campos_custom||p_valores WHERE id=p_contato AND campos_versao=p_versao;
 IF NOT FOUND THEN RAISE EXCEPTION 'Contato mudou. Atualize.' USING errcode='22023';END IF;
END $$;
CREATE FUNCTION public.campos_oportunidade_validar() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE c public.campos_personalizados;v jsonb;contato jsonb;m public.motivos_perda; BEGIN
 IF current_setting('role')='authenticated' AND (tg_op='INSERT' OR new.campos_custom IS DISTINCT FROM old.campos_custom) AND NOT EXISTS(SELECT 1 FROM public.usuarios WHERE id=auth.uid() AND ativo) THEN RAISE EXCEPTION 'Sem acesso aos campos.' USING errcode='42501';END IF;
 -- Etapas, edição, lote e automações passam pela mesma trava de banco.
 PERFORM public.campos_validar('oportunidade',new.campos_custom,CASE WHEN tg_op='UPDATE' THEN old.campos_custom ELSE '{}' END);
 IF tg_op='UPDATE' AND old.fechado_em IS NOT NULL AND new.campos_custom IS DISTINCT FROM old.campos_custom THEN RAISE EXCEPTION 'Venda encerrada: preserve os campos.' USING errcode='22023';END IF;
 IF (tg_op='INSERT' OR old.fechado_em IS NULL) AND (tg_op='INSERT' OR new.status IS DISTINCT FROM old.status OR new.campos_custom IS DISTINCT FROM old.campos_custom) THEN
  SELECT campos_custom INTO contato FROM public.contatos_dados WHERE id=new.contato_id FOR UPDATE;
  FOR c IN SELECT * FROM public.campos_personalizados WHERE ativo AND new.status=ANY(obrigatorio_em) LOOP
   v:=CASE WHEN c.entidade='contato' THEN contato ELSE new.campos_custom END->c.chave;
   IF v IS NULL OR v='null'::jsonb OR (jsonb_typeof(v)='string' AND btrim(v#>>'{}')='') THEN RAISE EXCEPTION 'Campos obrigatórios: % (%). Preencha na ficha ou na oportunidade.',c.rotulo,c.entidade USING errcode='22023';END IF;
  END LOOP;
 END IF;
 IF new.status='perdido' AND new.fechado_em IS NULL THEN
  SELECT * INTO m FROM public.motivos_perda WHERE chave=new.motivo_perda;
  IF m.chave IS NULL OR (NOT m.ativo AND (tg_op='INSERT' OR old.motivo_perda IS DISTINCT FROM new.motivo_perda OR old.status IS DISTINCT FROM new.status)) THEN RAISE EXCEPTION 'Informe um motivo de perda ativo.' USING errcode='22023';END IF;
  IF m.exige_retomada AND new.retomar_em IS NULL THEN RAISE EXCEPTION 'Informe quando retomar o contato.' USING errcode='22023';END IF;
 END IF;RETURN new;
END $$;
-- Nome após oportunidade_validar: respeita a validação nativa de encerramento.
CREATE TRIGGER oportunidade_z_campos BEFORE INSERT OR UPDATE ON public.oportunidades FOR EACH ROW EXECUTE FUNCTION public.campos_oportunidade_validar();
CREATE FUNCTION public.preparacao_concluir() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ BEGIN
 IF NOT public.usuario_e_gestor() THEN RAISE EXCEPTION 'Só gestor conclui a preparação.' USING errcode='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.configuracoes_negocio WHERE length(btrim(nome_negocio))>0)
 OR NOT EXISTS(SELECT 1 FROM public.catalogo_servicos WHERE ativo AND NOT arquivado)
 OR NOT EXISTS(SELECT 1 FROM public.horario_comercial WHERE ativo)
 OR NOT EXISTS(SELECT 1 FROM public.preparacao_crm WHERE funil_confirmado) THEN RAISE EXCEPTION 'Confira empresa, catálogo, horários e funil.' USING errcode='22023';END IF;
 UPDATE public.preparacao_crm SET concluida_em=now() WHERE id;
END $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure assinatura,proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('campo_definir','motivo_perda_definir','campos_validar','campos_contato_salvar','preparacao_concluir') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.assinatura);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.assinatura);
 IF f.proname<>'campos_validar' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.assinatura);END IF;
 END LOOP;
END $$;
INSERT INTO crm_base_private.schema_migrations(version) VALUES('0030_nicho_configuravel');
NOTIFY pgrst,'reload schema';
COMMIT;
