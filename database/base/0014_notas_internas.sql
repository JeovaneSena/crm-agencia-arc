BEGIN;
-- NOTAS INTERNAS (módulo conversas): anotações da equipe dentro da conversa. Ficam numa tabela
-- PRÓPRIA, separada de `mensagens_whatsapp`, de propósito: nenhum caminho que envia (a rota /enviar,
-- o assistente, as campanhas) lê esta tabela, então uma nota nunca vai para o WhatsApp nem para o
-- prompt da IA. A equipe inteira lê; cada um escreve em seu nome; ninguém edita (nota é registro);
-- apaga o autor ou o gestor.
--
-- Ideia adaptada do DeskcommCRM (MIT, © 2026 Rafael Melgaço): `conversation_notes` (regra AT-05).

CREATE TABLE public.notas_conversa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_id uuid NOT NULL REFERENCES public.contatos_dados(id) ON DELETE CASCADE,
  texto text NOT NULL CHECK (length(btrim(texto)) BETWEEN 1 AND 2000),
  autor_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notas_conversa_contato_idx ON public.notas_conversa(contato_id, created_at);

ALTER TABLE public.notas_conversa ENABLE ROW LEVEL SECURITY;
CREATE POLICY equipe_le ON public.notas_conversa FOR SELECT TO authenticated USING (true);
CREATE POLICY escreve_em_nome_proprio ON public.notas_conversa FOR INSERT TO authenticated
  WITH CHECK (autor_id = auth.uid() AND EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.ativo));
CREATE POLICY autor_ou_gestor_apaga ON public.notas_conversa FOR DELETE TO authenticated
  USING (autor_id = auth.uid() OR public.usuario_e_gestor());

REVOKE ALL ON public.notas_conversa FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.notas_conversa TO authenticated;
GRANT INSERT (contato_id, texto, autor_id) ON public.notas_conversa TO authenticated;
GRANT ALL ON public.notas_conversa TO service_role;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notas_conversa;

INSERT INTO crm_base_private.schema_migrations(version) VALUES ('0014_notas_internas');
NOTIFY pgrst, 'reload schema';
COMMIT;
