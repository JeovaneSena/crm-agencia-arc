BEGIN;
CREATE FUNCTION public.privacidade_proteger_vinculo() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE c uuid;BEGIN
 IF tg_table_name='contatos_dados' THEN
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='midias-whatsapp' AND name LIKE old.id::text||'/%') THEN RAISE EXCEPTION 'Remova as mídias pelo servidor primeiro.' USING errcode='22023';END IF;
 IF NOT EXISTS(SELECT 1 FROM crm_base_private.privacidade_bloqueios WHERE contato_id=old.id) THEN RAISE EXCEPTION 'Use a remoção de dados pelo servidor.' USING errcode='42501';END IF;RETURN old;
 END IF;
 c:=(to_jsonb(new)->>'contato_id')::uuid;
 IF c IS NULL THEN RETURN new;END IF;
 PERFORM 1 FROM public.contatos_dados WHERE id=c FOR SHARE;
 IF EXISTS(SELECT 1 FROM crm_base_private.privacidade_bloqueios WHERE contato_id=c) THEN RAISE EXCEPTION 'Contato aguardando remoção de dados.' USING errcode='42501';END IF;RETURN new;
END $$;
CREATE TRIGGER privacidade_remocao BEFORE DELETE ON public.contatos_dados FOR EACH ROW EXECUTE FUNCTION public.privacidade_proteger_vinculo();
DO $$ DECLARE t record;BEGIN
 FOR t IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='contato_id' AND NOT a.attisdropped WHERE n.nspname='public' AND c.relkind IN ('r','p') LOOP
 EXECUTE format('CREATE TRIGGER privacidade_vinculo BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.privacidade_proteger_vinculo()',t.relname);
 IF t.relname IN ('automacao_envios','campanha_destinatarios','gestao_saidas') THEN EXECUTE format('CREATE TRIGGER privacidade_envio BEFORE UPDATE ON public.%I FOR EACH ROW WHEN(new.estado IN (''reservado'',''chamando'',''processando'')) EXECUTE FUNCTION public.privacidade_proteger_vinculo()',t.relname);END IF;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.diagnostico_base() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_catalog' AS $$ DECLARE sem_rls jsonb;sem_auditoria jsonb;sem_mfa jsonb;protegida boolean;configurada boolean;BEGIN
 IF NOT public.usuario_e_gestor() THEN RAISE EXCEPTION 'Só gestor consulta o diagnóstico.' USING errcode='42501';END IF;
 SELECT coalesce(jsonb_agg(c.relname),'[]') INTO sem_rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity;
 SELECT coalesce(jsonb_agg(c.relname),'[]') INTO sem_auditoria FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname<>'auditoria' AND NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='auditoria' AND t.tgenabled<>'D');
 SELECT coalesce(jsonb_agg(c.relname),'[]') INTO sem_mfa FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='sessao_segura' AND NOT p.polpermissive);
 SELECT count(*)=2 INTO protegida FROM pg_trigger WHERE tgrelid='public.auditoria'::regclass AND tgname IN ('auditoria_nao_edita','auditoria_nao_limpa') AND tgenabled<>'D';
 SELECT EXISTS(SELECT 1 FROM pg_roles r CROSS JOIN LATERAL unnest(r.rolconfig) s WHERE r.rolname='authenticator' AND s='pgrst.db_pre_request=public.verificar_sessao_api') INTO configurada;
 RETURN jsonb_build_object('tabelas_sem_rls',sem_rls,'tabelas_sem_auditoria',sem_auditoria,'tabelas_sem_mfa',sem_mfa,'seguranca_api',configurada,'auditoria_protegida',protegida AND NOT has_table_privilege('authenticated','public.auditoria','UPDATE') AND NOT has_table_privilege('service_role','public.auditoria','DELETE'),'migracoes',(SELECT count(*) FROM crm_base_private.schema_migrations),'gestores_ativos',(SELECT count(*) FROM public.usuarios WHERE papel='gestor' AND ativo),'eventos_pendentes',(SELECT count(*) FROM public.gestao_eventos WHERE estado='pendente'),'saidas_incertas',(SELECT count(*) FROM public.gestao_saidas WHERE estado='incerto'),'eventos_parados',(SELECT count(*) FROM public.gestao_eventos WHERE estado='pendente' AND criado_em<now()-interval '15 minutes'));
END $$;
CREATE FUNCTION public.gestao_manutencao() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ BEGIN
 IF to_regprocedure('public.propostas_vigiar()') IS NOT NULL THEN EXECUTE 'SELECT public.propostas_vigiar()';END IF;
 IF EXISTS(SELECT 1 FROM public.gestao_eventos WHERE estado='pendente' AND criado_em<now()-interval '15 minutes') THEN PERFORM public.aviso_abrir('gestao_parada','worker','atencao','As regras de gestão estão aguardando execução','Confira o trabalhador e as execuções recentes.','/regras',NULL,true);ELSE PERFORM public.aviso_resolver_auto('gestao_parada','worker');END IF;
END $$;
REVOKE ALL ON FUNCTION public.gestao_manutencao() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gestao_manutencao() TO service_role;
INSERT INTO crm_base_private.schema_migrations(version) VALUES('0040_diagnostico_operacional');
NOTIFY pgrst,'reload schema';
COMMIT;
