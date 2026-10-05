DO $$ DECLARE g uuid:=gen_random_uuid();u uuid:=gen_random_uuid();c uuid;outro uuid;r jsonb; BEGIN
 INSERT INTO auth.users(id) VALUES(g),(u);UPDATE public.usuarios SET papel='gestor' WHERE id=g;UPDATE public.usuarios SET papel='consultor' WHERE id=u;
 INSERT INTO public.contatos_dados(nome,email) VALUES('Pessoa privada','privado@example.invalid') RETURNING id INTO c;
 INSERT INTO public.contatos_dados(nome,email) VALUES('Outro contato','outro@example.invalid') RETURNING id INTO outro;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);SET LOCAL ROLE authenticated;
 BEGIN PERFORM public.privacidade_exportar(c);RAISE EXCEPTION 'FAIL: consultor exporta';EXCEPTION WHEN insufficient_privilege THEN NULL;END;RESET ROLE;
 PERFORM set_config('request.jwt.claim.sub',g::text,true);SET LOCAL ROLE authenticated;
 r:=public.privacidade_exportar(c);
 IF r::text NOT LIKE '%privado@example.invalid%' OR r::text LIKE '%outro@example.invalid%' OR jsonb_array_length(r->'dados'->'oportunidades')<>1 THEN RAISE EXCEPTION 'FAIL: exportação isolada';END IF;
 BEGIN PERFORM public.privacidade_remover(c,'');RAISE EXCEPTION 'FAIL: sem confirmação';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 PERFORM public.privacidade_remover(c,'REMOVER DADOS');RESET ROLE;
 IF EXISTS(SELECT 1 FROM public.contatos_dados WHERE id=c) OR EXISTS(SELECT 1 FROM public.oportunidades WHERE contato_id=c) OR NOT EXISTS(SELECT 1 FROM public.contatos_dados WHERE id=outro) THEN RAISE EXCEPTION 'FAIL: cascata';END IF;
END $$;
