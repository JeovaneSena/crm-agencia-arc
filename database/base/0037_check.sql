DO $$ DECLARE g uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();c uuid;o uuid;r uuid;BEGIN
 INSERT INTO auth.users(id) VALUES(g),(a),(b);UPDATE public.usuarios SET papel='gestor' WHERE id=g;
 PERFORM set_config('request.jwt.claim.sub',g::text,true);SET LOCAL ROLE authenticated;
 PERFORM public.distribuicao_salvar(true,ARRAY[a,b],1);RESET ROLE;
 INSERT INTO public.contatos_dados(nome) VALUES('Distribuir') RETURNING id INTO c;
 SELECT responsavel_id INTO r FROM public.oportunidades WHERE contato_id=c;
 IF r<>a THEN RAISE EXCEPTION 'FAIL: primeiro da fila';END IF;
 INSERT INTO public.oportunidades(contato_id,nome) VALUES(c,'Segunda') RETURNING id,responsavel_id INTO o,r;
 IF r<>b THEN RAISE EXCEPTION 'FAIL: segundo da fila';END IF;
 INSERT INTO public.oportunidades(contato_id,nome,responsavel_id) VALUES(c,'Explícito',g) RETURNING responsavel_id INTO r;
 IF r<>g THEN RAISE EXCEPTION 'FAIL: sobrescreveu explícito';END IF;
 UPDATE public.usuarios SET ativo=false WHERE id=a;
 INSERT INTO public.oportunidades(contato_id,nome) VALUES(c,'Ignora inativo') RETURNING responsavel_id INTO r;
 IF r<>b THEN RAISE EXCEPTION 'FAIL: distribuiu para inativo';END IF;
 PERFORM set_config('request.jwt.claim.sub',b::text,true);SET LOCAL ROLE authenticated;
 BEGIN PERFORM public.distribuicao_salvar(false,'{}',2);RAISE EXCEPTION 'FAIL: consultor configura';EXCEPTION WHEN insufficient_privilege THEN NULL;END;RESET ROLE;
END $$;
