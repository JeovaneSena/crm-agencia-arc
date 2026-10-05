DO $$ BEGIN
 IF (SELECT count(*) FROM public.etapas_funil)<>8 OR NOT EXISTS(SELECT 1 FROM public.preparacao_crm WHERE id) THEN RAISE EXCEPTION 'FAIL: configuração inicial';END IF;
END $$;
