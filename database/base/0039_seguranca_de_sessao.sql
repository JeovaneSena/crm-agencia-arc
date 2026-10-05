BEGIN;
CREATE FUNCTION public.sessao_segura() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_catalog' AS $$
 SELECT CASE WHEN auth.role()='service_role' THEN true ELSE
 EXISTS(SELECT 1 FROM public.usuarios WHERE id=auth.uid() AND ativo)
 AND (coalesce(auth.jwt()->>'aal','aal1')='aal2' OR NOT EXISTS(SELECT 1 FROM auth.mfa_factors WHERE user_id=auth.uid() AND status='verified')) END;
$$;
CREATE FUNCTION public.verificar_sessao_api() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ BEGIN
 IF auth.role()='authenticated' AND NOT public.sessao_segura() THEN RAISE EXCEPTION 'Confirme sua verificação em duas etapas ou entre com uma conta ativa.' USING errcode='42501';END IF;
END $$;
CREATE OR REPLACE FUNCTION public.usuario_e_gestor(p_usuario uuid DEFAULT auth.uid()) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
 SELECT EXISTS(SELECT 1 FROM public.usuarios WHERE id=p_usuario AND papel='gestor' AND ativo) AND (auth.role()='service_role' OR public.sessao_segura());
$$;
DO $$ DECLARE t record;atual text;BEGIN
 FOR t IN SELECT n.nspname esquema,c.relname tabela,c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname='public' AND c.relkind IN ('r','p')) OR (n.nspname='storage' AND c.relname='objects') LOOP
 EXECUTE format('CREATE POLICY sessao_segura ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING((SELECT public.sessao_segura())) WITH CHECK((SELECT public.sessao_segura()))',t.esquema,t.tabela);
 -- Cobertura de auditoria também para tabelas dos módulos instalados.
 IF t.esquema='public' AND t.tabela<>'auditoria' AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=t.oid AND tgname='auditoria') THEN
 EXECUTE format('CREATE TRIGGER auditoria AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.auditar_mudanca()',t.tabela);END IF;
 END LOOP;
 -- Não sobrescreva uma proteção prévia de uma instalação derivada.
 SELECT split_part(s,'=',2) INTO atual FROM pg_roles r CROSS JOIN LATERAL unnest(r.rolconfig) s WHERE r.rolname='authenticator' AND s LIKE 'pgrst.db_pre_request=%';
 IF atual IS NOT NULL AND atual<>'public.verificar_sessao_api' THEN RAISE EXCEPTION 'Integre a verificação de sessão ao pre-request existente antes de aplicar.';END IF;
END $$;
REVOKE ALL ON FUNCTION public.sessao_segura(),public.verificar_sessao_api() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sessao_segura(),public.verificar_sessao_api() TO anon,authenticated,service_role;
ALTER ROLE authenticator SET pgrst.db_pre_request='public.verificar_sessao_api';
INSERT INTO crm_base_private.schema_migrations(version) VALUES('0039_seguranca_de_sessao');
NOTIFY pgrst,'reload schema';
NOTIFY pgrst,'reload config';
COMMIT;
