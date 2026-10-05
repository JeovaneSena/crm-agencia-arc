DO $$ DECLARE g uuid:=gen_random_uuid();c uuid;r jsonb; BEGIN
 INSERT INTO auth.users(id) VALUES(g);UPDATE public.usuarios SET papel='gestor' WHERE id=g;
 INSERT INTO public.contatos_dados(nome,email) VALUES('Dado pessoal secreto','sigilo@example.invalid') RETURNING id INTO c;
 IF NOT EXISTS(SELECT 1 FROM public.auditoria WHERE tabela='contatos_dados' AND registro_id=c::text AND campos @> ARRAY['email']) THEN RAISE EXCEPTION 'FAIL: auditoria ausente';END IF;
 IF EXISTS(SELECT 1 FROM public.auditoria WHERE to_jsonb(auditoria)::text LIKE '%sigilo@example.invalid%') THEN RAISE EXCEPTION 'FAIL: auditoria copia dado pessoal';END IF;
 BEGIN UPDATE public.auditoria SET operacao='FAKE';RAISE EXCEPTION 'FAIL: auditoria editável';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN DELETE FROM public.auditoria;RAISE EXCEPTION 'FAIL: auditoria apagável';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM set_config('request.jwt.claim.sub',g::text,true);SET LOCAL ROLE authenticated;r:=public.diagnostico_base();RESET ROLE;
 IF r->>'auditoria_protegida'<>'true' OR jsonb_array_length(r->'tabelas_sem_rls')<>0 THEN RAISE EXCEPTION 'FAIL: invariantes %',r;END IF;
END $$;
