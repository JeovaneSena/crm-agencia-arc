BEGIN;
CREATE TABLE public.auditoria(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tabela text NOT NULL,registro_id text NOT NULL,operacao text NOT NULL,usuario_id uuid,campos text[] NOT NULL,criado_em timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.auditoria ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auditoria FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.auditoria TO authenticated,service_role;
CREATE POLICY gestor_le ON public.auditoria FOR SELECT TO authenticated USING(public.usuario_e_gestor());
CREATE FUNCTION public.auditoria_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Auditoria só aceita inclusão pelo servidor.' USING errcode='42501';END $$;
CREATE TRIGGER auditoria_nao_edita BEFORE UPDATE OR DELETE ON public.auditoria FOR EACH ROW EXECUTE FUNCTION public.auditoria_imutavel();
CREATE TRIGGER auditoria_nao_limpa BEFORE TRUNCATE ON public.auditoria FOR EACH STATEMENT EXECUTE FUNCTION public.auditoria_imutavel();
CREATE FUNCTION public.auditar_mudanca() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE a jsonb:=CASE WHEN tg_op='INSERT' THEN '{}' ELSE to_jsonb(old) END;b jsonb:=CASE WHEN tg_op='DELETE' THEN '{}' ELSE to_jsonb(new) END;chaves text[]; BEGIN
 SELECT coalesce(array_agg(k ORDER BY k),'{}') INTO chaves FROM(SELECT key k FROM jsonb_object_keys(a||b) key WHERE a->key IS DISTINCT FROM b->key) x;
 IF cardinality(chaves)>0 THEN INSERT INTO public.auditoria(tabela,registro_id,operacao,usuario_id,campos) VALUES(tg_table_name,coalesce(b->>'id',a->>'id',b->>'chave',a->>'chave',b->>'contato_id',a->>'contato_id','config'),tg_op,auth.uid(),chaves);END IF;
 RETURN coalesce(new,old);
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['contatos_dados','oportunidades','reunioes','usuarios','etapas_funil','catalogo_servicos','configuracoes_negocio','campos_personalizados','motivos_perda','tarefas','contato_etiquetas','preparacao_crm'] LOOP
 EXECUTE format('CREATE TRIGGER auditoria AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.auditar_mudanca()',t);
 END LOOP;
END $$;
CREATE FUNCTION public.diagnostico_base() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE sem_rls jsonb;falhas integer; BEGIN
 IF NOT public.usuario_e_gestor() THEN RAISE EXCEPTION 'Só gestor consulta o diagnóstico.' USING errcode='42501';END IF;
 SELECT coalesce(jsonb_agg(c.relname),'[]') INTO sem_rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity;
 SELECT count(*) INTO falhas FROM pg_trigger WHERE tgrelid='public.auditoria'::regclass AND tgname IN ('auditoria_nao_edita','auditoria_nao_limpa') AND tgenabled<>'D';
 RETURN jsonb_build_object('tabelas_sem_rls',sem_rls,'auditoria_protegida',falhas=2 AND NOT has_table_privilege('authenticated','public.auditoria','UPDATE') AND NOT has_table_privilege('service_role','public.auditoria','DELETE'),'migracoes',(SELECT count(*) FROM crm_base_private.schema_migrations),'gestores_ativos',(SELECT count(*) FROM public.usuarios WHERE papel='gestor' AND ativo));
END $$;
REVOKE ALL ON FUNCTION public.diagnostico_base() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.diagnostico_base() TO authenticated,service_role;
INSERT INTO crm_base_private.schema_migrations(version) VALUES('0034_auditoria');
NOTIFY pgrst,'reload schema';
COMMIT;
