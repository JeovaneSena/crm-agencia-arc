BEGIN;
-- No Supabase, toda função nova nasce com EXECUTE para `anon` (via privilégios
-- padrão do papel dono). Várias funções do núcleo são SECURITY DEFINER
-- (agenda_marcar, agenda_cancelar, ...): sem esta trava, quem tem só a chave
-- pública do projeto poderia chamá-las pela API e criar contatos e reuniões.
-- Daqui em diante: só a equipe autenticada e o servidor chamam funções.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS assinatura FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e') LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.assinatura);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f.assinatura);
  END LOOP;
END $$;

-- Funções criadas por migrações futuras nascem já fechadas. São DOIS comandos
-- de propósito: o EXECUTE de PUBLIC é um padrão global do papel, e revogá-lo
-- "IN SCHEMA public" não tem efeito (testado); o de `anon` é por esquema.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;

INSERT INTO crm_base_private.schema_migrations(version) VALUES ('0005_funcoes_so_equipe');
NOTIFY pgrst, 'reload schema';
COMMIT;
