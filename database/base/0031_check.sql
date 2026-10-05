DO $$ DECLARE g uuid:=gen_random_uuid();u uuid:=gen_random_uuid();r jsonb; BEGIN
 INSERT INTO auth.users(id) VALUES(g),(u);UPDATE public.usuarios SET papel='gestor' WHERE id=g;UPDATE public.usuarios SET papel='consultor' WHERE id=u;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);SET LOCAL ROLE authenticated;
 BEGIN PERFORM public.funil_modelo_aplicar('imobiliario');RAISE EXCEPTION 'FAIL: consultor aplica';EXCEPTION WHEN insufficient_privilege THEN NULL;END;RESET ROLE;
 PERFORM set_config('request.jwt.claim.sub',g::text,true);SET LOCAL ROLE authenticated;
 BEGIN PERFORM public.preparacao_concluir();RAISE EXCEPTION 'FAIL: encerra sem preparar';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 PERFORM public.funil_modelo_aplicar('imobiliario');RESET ROLE;
 IF NOT EXISTS(SELECT 1 FROM public.etapas_funil WHERE chave='diagnostico' AND rotulo='Visita marcada') OR (SELECT count(*) FROM public.etapas_funil)<>8 THEN RAISE EXCEPTION 'FAIL: modelo altera chaves';END IF;
 SET LOCAL ROLE authenticated;PERFORM public.funil_modelo_aplicar('servicos');RESET ROLE;
 IF NOT EXISTS(SELECT 1 FROM public.etapas_funil WHERE chave='ganho' AND rotulo='Contrato fechado' AND tipo='ganho') THEN RAISE EXCEPTION 'FAIL: terminal';END IF;
 UPDATE public.configuracoes_negocio SET nome_negocio='Empresa de ensaio';
 INSERT INTO public.catalogo_servicos(nome) VALUES('Serviço de ensaio');
 SET LOCAL ROLE authenticated;PERFORM public.funil_confirmar();PERFORM public.preparacao_concluir();r:=public.preparacao_status();RESET ROLE;
 IF r->>'concluida_em' IS NULL OR r->>'empresa'<>'true' OR r->>'catalogo'<>'true' THEN RAISE EXCEPTION 'FAIL: guia';END IF;
 SET LOCAL ROLE anon;
 BEGIN PERFORM public.funil_modelo_aplicar('generico');RAISE EXCEPTION 'FAIL: anon aplica';EXCEPTION WHEN insufficient_privilege THEN NULL;END;RESET ROLE;
END $$;
