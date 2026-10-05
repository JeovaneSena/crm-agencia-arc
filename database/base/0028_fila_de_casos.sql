BEGIN;
-- Adaptação genérica da 0035 da origem: fila e resolução, sem envio automático.
CREATE TABLE public.assistente_casos(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),contato_id uuid NOT NULL REFERENCES public.contatos_dados(id) ON DELETE CASCADE,
 motivo text NOT NULL CHECK(length(motivo) BETWEEN 1 AND 80),resumo text NOT NULL CHECK(length(resumo) BETWEEN 1 AND 500),
 estado text NOT NULL DEFAULT 'aguardando' CHECK(estado IN ('aguardando','em_atendimento','resolvido')),
 responsavel_id uuid REFERENCES public.usuarios(id),criado_em timestamptz NOT NULL DEFAULT now(),assumido_em timestamptz,resolvido_em timestamptz,
 solucao text CHECK(length(solucao)<=4000),avaliacao text CHECK(avaliacao IN ('necessario','desnecessario')));
CREATE UNIQUE INDEX assistente_caso_aberto ON public.assistente_casos(contato_id) WHERE estado<>'resolvido';
ALTER TABLE public.assistente_casos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.assistente_casos FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.assistente_casos TO authenticated;
GRANT ALL ON public.assistente_casos TO service_role;
CREATE POLICY equipe_le ON public.assistente_casos FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.usuarios WHERE id=auth.uid() AND ativo));
CREATE FUNCTION public.assistente_caso_abrir(p_contato uuid,p_motivo text,p_resumo text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE c uuid; BEGIN
 INSERT INTO public.assistente_casos(contato_id,motivo,resumo) VALUES(p_contato,p_motivo,p_resumo)
 ON CONFLICT(contato_id) WHERE estado<>'resolvido' DO UPDATE SET resumo=excluded.resumo,motivo=excluded.motivo RETURNING id INTO c;
 RETURN c;
END $$;
CREATE FUNCTION public.assistente_caso_assumir(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE c public.assistente_casos; BEGIN
 SELECT * INTO c FROM public.assistente_casos WHERE id=p_id;
 IF c.id IS NULL OR c.estado='resolvido' THEN RAISE EXCEPTION 'Caso não disponível.' USING errcode='22023'; END IF;
 -- Mesma ordem do encaminhamento: contato antes de caso, evitando travas cruzadas.
 IF NOT public.conversa_assumir(c.contato_id) THEN RAISE EXCEPTION 'Outra pessoa está atendendo.' USING errcode='42501'; END IF;
 SELECT * INTO c FROM public.assistente_casos WHERE id=p_id FOR UPDATE;
 IF c.id IS NULL OR c.estado='resolvido' THEN RAISE EXCEPTION 'Caso não disponível.' USING errcode='22023'; END IF;
 UPDATE public.assistente_casos SET estado='em_atendimento',responsavel_id=auth.uid(),assumido_em=coalesce(assumido_em,now()) WHERE id=p_id;
END $$;
CREATE FUNCTION public.assistente_caso_finalizar(p_id uuid,p_solucao text,p_avaliacao text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE c public.assistente_casos; BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.usuarios WHERE id=auth.uid() AND ativo) THEN RAISE EXCEPTION 'Sem acesso.' USING errcode='42501'; END IF;
 SELECT * INTO c FROM public.assistente_casos WHERE id=p_id FOR UPDATE;
 IF c.estado IS DISTINCT FROM 'em_atendimento' OR (c.responsavel_id IS DISTINCT FROM auth.uid() AND NOT public.usuario_e_gestor()) THEN RAISE EXCEPTION 'Assuma o caso antes de finalizar.' USING errcode='42501'; END IF;
 IF p_solucao IS NULL OR length(btrim(p_solucao)) NOT BETWEEN 3 AND 4000 OR p_avaliacao IS NULL OR p_avaliacao NOT IN ('necessario','desnecessario') THEN RAISE EXCEPTION 'Informe solução e avaliação.' USING errcode='22023'; END IF;
 UPDATE public.assistente_casos SET estado='resolvido',solucao=btrim(p_solucao),avaliacao=p_avaliacao,resolvido_em=now() WHERE id=p_id;
 PERFORM public.aviso_resolver_auto('caso_parado',c.id::text);
END $$;
CREATE FUNCTION public.assistente_casos_vigiar() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE c public.assistente_casos;n integer:=0; BEGIN
 FOR c IN SELECT * FROM public.assistente_casos WHERE estado<>'resolvido' AND coalesce(assumido_em,criado_em)<now()-interval '2 hours' LOOP
 PERFORM public.aviso_abrir('caso_parado',c.id::text,'atencao','Um caso está aguardando a equipe','Confira o resumo, assuma e registre a solução.','/casos',c.contato_id,false);n:=n+1;
 END LOOP;RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.assistente_caso_abrir(uuid,text,text),public.assistente_casos_vigiar(),public.assistente_caso_assumir(uuid),public.assistente_caso_finalizar(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assistente_caso_abrir(uuid,text,text),public.assistente_casos_vigiar() TO service_role;
GRANT EXECUTE ON FUNCTION public.assistente_caso_assumir(uuid),public.assistente_caso_finalizar(uuid,text,text) TO authenticated;
INSERT INTO crm_base_private.schema_migrations(version) VALUES('0028_fila_de_casos');
NOTIFY pgrst,'reload schema';
COMMIT;
