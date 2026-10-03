BEGIN;
-- RESPOSTAS RÁPIDAS (módulo conversas): textos prontos para a equipe inserir na conversa.
-- Duas famílias, na mesma tabela:
--   da equipe (`dono_id` NULL)  todos leem; só o gestor cria, edita e apaga;
--   pessoais  (`dono_id` = eu)  só o dono lê, cria, edita e apaga.
-- O texto aceita {{nome}} e {{primeiro_nome}}, preenchidos pela tela com o contato da conversa.
-- Inserir NÃO envia: a pessoa revisa o texto antes. `atalho` (opcional) permite digitar /atalho.
--
-- Ideia adaptada do DeskcommCRM (MIT, © 2026 Rafael Melgaço): `message_templates`.

CREATE TABLE public.respostas_rapidas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 60),
  texto text NOT NULL CHECK (length(btrim(texto)) BETWEEN 1 AND 1000),
  atalho text CHECK (atalho ~ '^[a-z0-9_-]{1,20}$'),
  dono_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  criada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Atalho único dentro de cada família (o de uma pessoa pode repetir o de outra).
CREATE UNIQUE INDEX respostas_atalho_equipe ON public.respostas_rapidas(atalho) WHERE dono_id IS NULL AND atalho IS NOT NULL;
CREATE UNIQUE INDEX respostas_atalho_pessoal ON public.respostas_rapidas(dono_id, atalho) WHERE dono_id IS NOT NULL AND atalho IS NOT NULL;
CREATE INDEX respostas_dono_idx ON public.respostas_rapidas(dono_id);
CREATE TRIGGER respostas_rapidas_updated_at BEFORE UPDATE ON public.respostas_rapidas FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.respostas_rapidas ENABLE ROW LEVEL SECURITY;
CREATE POLICY le ON public.respostas_rapidas FOR SELECT TO authenticated
  USING (dono_id IS NULL OR dono_id = auth.uid());
CREATE POLICY cria ON public.respostas_rapidas FOR INSERT TO authenticated
  WITH CHECK (criada_por = auth.uid() AND ((dono_id = auth.uid()) OR (dono_id IS NULL AND public.usuario_e_gestor())));
CREATE POLICY edita ON public.respostas_rapidas FOR UPDATE TO authenticated
  USING (dono_id = auth.uid() OR (dono_id IS NULL AND public.usuario_e_gestor()))
  WITH CHECK (dono_id = auth.uid() OR (dono_id IS NULL AND public.usuario_e_gestor()));
CREATE POLICY apaga ON public.respostas_rapidas FOR DELETE TO authenticated
  USING (dono_id = auth.uid() OR (dono_id IS NULL AND public.usuario_e_gestor()));

REVOKE ALL ON public.respostas_rapidas FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.respostas_rapidas TO authenticated;
GRANT INSERT (titulo, texto, atalho, dono_id, criada_por) ON public.respostas_rapidas TO authenticated;
-- `dono_id` fica fora do UPDATE: mudar a família é apagar e criar de novo.
GRANT UPDATE (titulo, texto, atalho) ON public.respostas_rapidas TO authenticated;
GRANT ALL ON public.respostas_rapidas TO service_role;

INSERT INTO crm_base_private.schema_migrations(version) VALUES ('0013_respostas_rapidas');
NOTIFY pgrst, 'reload schema';
COMMIT;
