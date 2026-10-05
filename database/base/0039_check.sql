DO $$ DECLARE g uuid:=gen_random_uuid();n integer;BEGIN
 INSERT INTO auth.users(id) VALUES(g);UPDATE public.usuarios SET papel='gestor' WHERE id=g;
 PERFORM set_config('request.jwt.claim.sub',g::text,true);PERFORM set_config('request.jwt.claim.role','authenticated',true);PERFORM set_config('request.jwt.claims','{"aal":"aal1"}',true);
 SET LOCAL ROLE authenticated;PERFORM public.verificar_sessao_api();RESET ROLE;
 INSERT INTO auth.mfa_factors(id,user_id,status) VALUES(gen_random_uuid(),g,'verified');
 SET LOCAL ROLE authenticated;
 BEGIN PERFORM public.verificar_sessao_api();RAISE EXCEPTION 'FAIL: API sem segundo fator';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 SELECT count(*) INTO n FROM public.contatos_dados;
 IF n<>0 OR public.usuario_e_gestor() THEN RAISE EXCEPTION 'FAIL: RLS ou gestor sem segundo fator';END IF;RESET ROLE;
 PERFORM set_config('request.jwt.claims','{"aal":"aal2"}',true);SET LOCAL ROLE authenticated;
 PERFORM public.verificar_sessao_api();IF NOT public.usuario_e_gestor() THEN RAISE EXCEPTION 'FAIL: MFA verificada bloqueada';END IF;RESET ROLE;
 PERFORM set_config('request.jwt.claim.role','service_role',true);SET LOCAL ROLE service_role;PERFORM public.verificar_sessao_api();RESET ROLE;
END $$;
