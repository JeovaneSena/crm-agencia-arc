BEGIN;
-- Adaptação da 0036: evidência, comparação sem envio, aceite explícito e versões.
CREATE TABLE public.assistente_melhorias(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),titulo text NOT NULL CHECK(length(btrim(titulo)) BETWEEN 3 AND 160),
 contato_id uuid NOT NULL REFERENCES public.contatos_dados(id) ON DELETE CASCADE,
 evidencia text NOT NULL CHECK(length(btrim(evidencia)) BETWEEN 3 AND 4000),
 conteudo text NOT NULL CHECK(length(btrim(conteudo)) BETWEEN 3 AND 4000),
 estado text NOT NULL DEFAULT 'rascunho' CHECK(estado IN ('rascunho','testada','aprovada','rejeitada')),
 criada_em timestamptz NOT NULL DEFAULT now(),criada_por uuid NOT NULL REFERENCES public.usuarios(id));
CREATE TABLE public.assistente_melhoria_versoes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conteudo text NOT NULL CHECK(length(conteudo)<=4000),
 anterior_id uuid REFERENCES public.assistente_melhoria_versoes(id),origem_id uuid REFERENCES public.assistente_melhorias(id) ON DELETE SET NULL,
 criada_em timestamptz NOT NULL DEFAULT now(),criada_por uuid REFERENCES public.usuarios(id));
CREATE TABLE public.assistente_melhoria_controle(id boolean PRIMARY KEY DEFAULT true CHECK(id),versao_id uuid NOT NULL REFERENCES public.assistente_melhoria_versoes(id));
INSERT INTO public.assistente_melhoria_versoes(conteudo) VALUES('');
INSERT INTO public.assistente_melhoria_controle SELECT true,id FROM public.assistente_melhoria_versoes;
CREATE TABLE public.assistente_melhoria_testes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),proposta_id uuid NOT NULL REFERENCES public.assistente_melhorias(id) ON DELETE CASCADE,
 base jsonb NOT NULL,candidato text NOT NULL,resultado jsonb NOT NULL,apto boolean NOT NULL,criado_em timestamptz NOT NULL DEFAULT now());
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['assistente_melhorias','assistente_melhoria_versoes','assistente_melhoria_controle','assistente_melhoria_testes'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
 EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 EXECUTE format('CREATE POLICY gestor_le ON public.%I FOR SELECT TO authenticated USING(public.usuario_e_gestor())',t);
 END LOOP;
END $$;
CREATE FUNCTION public.assistente_melhoria_base() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
 SELECT jsonb_build_object('config',to_jsonb(c),'versao',v.id,'conteudo',v.conteudo) FROM public.assistente_config c CROSS JOIN public.assistente_melhoria_controle k JOIN public.assistente_melhoria_versoes v ON v.id=k.versao_id WHERE c.id;
$$;
CREATE FUNCTION public.assistente_melhoria_criar(p_titulo text,p_contato uuid,p_evidencia text,p_conteudo text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE i uuid; BEGIN
 IF NOT public.usuario_e_gestor() THEN RAISE EXCEPTION 'Só gestor propõe melhorias.' USING errcode='42501'; END IF;
 INSERT INTO public.assistente_melhorias(titulo,contato_id,evidencia,conteudo,criada_por) VALUES(btrim(p_titulo),p_contato,btrim(p_evidencia),btrim(p_conteudo),auth.uid()) RETURNING id INTO i;RETURN i;
END $$;
CREATE FUNCTION public.assistente_melhoria_testar(p_proposta uuid,p_base jsonb,p_candidato text,p_resultado jsonb,p_apto boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE s public.assistente_melhorias;i uuid; BEGIN
 SELECT * INTO s FROM public.assistente_melhorias WHERE id=p_proposta FOR UPDATE;
 IF s.estado IS NULL OR s.estado NOT IN ('rascunho','testada') OR s.conteudo IS DISTINCT FROM p_candidato OR public.assistente_melhoria_base() IS DISTINCT FROM p_base THEN RAISE EXCEPTION 'A configuração mudou. Compare novamente.' USING errcode='22023'; END IF;
 INSERT INTO public.assistente_melhoria_testes(proposta_id,base,candidato,resultado,apto) VALUES(s.id,p_base,p_candidato,p_resultado,p_apto) RETURNING id INTO i;
 UPDATE public.assistente_melhorias SET estado='testada' WHERE id=s.id;RETURN i;
END $$;
CREATE FUNCTION public.assistente_melhoria_aprovar(p_proposta uuid,p_teste uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE s public.assistente_melhorias;t public.assistente_melhoria_testes;v uuid; BEGIN
 IF NOT public.usuario_e_gestor() THEN RAISE EXCEPTION 'Só gestor aprova.' USING errcode='42501'; END IF;
 PERFORM 1 FROM public.assistente_melhoria_controle WHERE id FOR UPDATE;
 PERFORM 1 FROM public.assistente_config WHERE id FOR UPDATE;
 SELECT * INTO s FROM public.assistente_melhorias WHERE id=p_proposta FOR UPDATE;
 SELECT * INTO t FROM public.assistente_melhoria_testes WHERE id=p_teste;
 IF s.estado IS DISTINCT FROM 'testada' OR t.proposta_id IS DISTINCT FROM s.id OR NOT coalesce(t.apto,false) OR t.criado_em<now()-interval '7 days' OR t.base IS DISTINCT FROM public.assistente_melhoria_base() OR t.candidato IS DISTINCT FROM s.conteudo THEN RAISE EXCEPTION 'Compare novamente antes de aprovar.' USING errcode='22023'; END IF;
 INSERT INTO public.assistente_melhoria_versoes(conteudo,anterior_id,origem_id,criada_por) SELECT s.conteudo,versao_id,s.id,auth.uid() FROM public.assistente_melhoria_controle RETURNING id INTO v;
 UPDATE public.assistente_melhoria_controle SET versao_id=v WHERE id;
 UPDATE public.assistente_melhorias SET estado='aprovada' WHERE id=s.id;RETURN v;
END $$;
CREATE FUNCTION public.assistente_melhoria_reverter(p_versao uuid,p_atual uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE v uuid;conteudo text;atual uuid; BEGIN
 IF NOT public.usuario_e_gestor() THEN RAISE EXCEPTION 'Só gestor restaura.' USING errcode='42501'; END IF;
 SELECT versao_id INTO atual FROM public.assistente_melhoria_controle WHERE id FOR UPDATE;
 IF atual IS DISTINCT FROM p_atual THEN RAISE EXCEPTION 'A versão ativa mudou.' USING errcode='22023'; END IF;
 SELECT x.conteudo INTO conteudo FROM public.assistente_melhoria_versoes x WHERE x.id=p_versao;
 IF NOT FOUND THEN RAISE EXCEPTION 'Versão não encontrada.' USING errcode='22023'; END IF;
 INSERT INTO public.assistente_melhoria_versoes(conteudo,anterior_id,criada_por) VALUES(conteudo,atual,auth.uid()) RETURNING id INTO v;
 UPDATE public.assistente_melhoria_controle SET versao_id=v WHERE id;RETURN v;
END $$;
CREATE FUNCTION public.assistente_melhoria_rejeitar(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ BEGIN
 IF NOT public.usuario_e_gestor() THEN RAISE EXCEPTION 'Só gestor rejeita.' USING errcode='42501'; END IF;
 UPDATE public.assistente_melhorias SET estado='rejeitada' WHERE id=p_id AND estado IN ('rascunho','testada');
 IF NOT FOUND THEN RAISE EXCEPTION 'Proposta indisponível.' USING errcode='22023'; END IF;
END $$;
CREATE FUNCTION public.assistente_revisao_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Crie uma nova proposta ou restaure uma versão.' USING errcode='42501';
END $$;
CREATE TRIGGER versao_imutavel BEFORE UPDATE OF conteudo,anterior_id,criada_em,criada_por ON public.assistente_melhoria_versoes FOR EACH ROW EXECUTE FUNCTION public.assistente_revisao_imutavel();
CREATE TRIGGER teste_imutavel BEFORE UPDATE ON public.assistente_melhoria_testes FOR EACH ROW EXECUTE FUNCTION public.assistente_revisao_imutavel();
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure assinatura,proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'assistente_melhoria_%' LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.assinatura);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.assinatura);
 IF f.proname IN ('assistente_melhoria_criar','assistente_melhoria_aprovar','assistente_melhoria_reverter','assistente_melhoria_rejeitar') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.assinatura); END IF;
 END LOOP;
END $$;
INSERT INTO crm_base_private.schema_migrations(version) VALUES('0029_revisao_do_assistente');
NOTIFY pgrst,'reload schema';
COMMIT;
