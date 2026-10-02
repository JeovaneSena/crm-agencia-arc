BEGIN;
-- MÓDULO CONVERSAS. Só aplique em instalações que ligarem `conversas` em
-- VITE_MODULOS. Depende só do núcleo (contatos, usuários, reuniões).
--
-- Escreve nas mensagens APENAS a Edge Function (service_role): a equipe lê e
-- marca como lida. "Assumir conversa" é do humano e vale sem assistente; quem
-- pausar assistente por causa disso é o módulo do assistente, lendo `assumido_por`.

CREATE TABLE public.conversas_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  provedor text NOT NULL DEFAULT 'uazapi' CHECK (provedor IN ('uazapi','meta'))
);
INSERT INTO public.conversas_config DEFAULT VALUES;

ALTER TABLE public.contatos_dados
  ADD COLUMN assumido_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN assumido_em timestamptz;

CREATE TABLE public.mensagens_whatsapp (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_id uuid NOT NULL REFERENCES public.contatos_dados(id) ON DELETE CASCADE,
  autor text NOT NULL CHECK (autor IN ('cliente','agente','atendente')),
  tipo text NOT NULL DEFAULT 'texto' CHECK (tipo IN ('texto','audio','imagem','video','documento')),
  -- Em áudio, guarda a transcrição.
  conteudo text,
  -- Caminho no bucket privado `midias-whatsapp`.
  midia_url text,
  provedor text NOT NULL DEFAULT 'uazapi' CHECK (provedor IN ('uazapi','meta')),
  -- Id da mensagem no provedor: impede duplicar quando o webhook é reenviado.
  id_externo text,
  -- Idempotência do envio pela tela: o mesmo pedido nunca grava duas vezes.
  pedido_id uuid,
  estado_envio text CHECK (estado_envio IN ('pendente','enviado','entregue','lido','falhou','incerto')),
  erro_envio text,
  origem_envio text CHECK (origem_envio IN ('agente','atendimento')),
  enviada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Leitura da equipe inteira, não de cada usuário.
  lida boolean NOT NULL DEFAULT false,
  criada_em timestamptz NOT NULL DEFAULT now()
);
-- UNIQUE completo (NULLs não colidem): o PostgREST só consegue mirar `on_conflict` numa restrição
-- sem predicado, e é assim que a função ignora webhook repetido e pedido de envio repetido.
ALTER TABLE public.mensagens_whatsapp
  ADD CONSTRAINT mensagens_externo_unico UNIQUE (provedor, id_externo),
  ADD CONSTRAINT mensagens_pedido_unico UNIQUE (pedido_id);
CREATE INDEX mensagens_conversa_idx ON public.mensagens_whatsapp(contato_id, criada_em);
CREATE INDEX mensagens_nao_lidas_idx ON public.mensagens_whatsapp(contato_id) WHERE NOT lida AND autor = 'cliente';

CREATE FUNCTION public.mensagens_atualiza_contato() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  update public.contatos_dados set ultima_mensagem = new.criada_em where id = new.contato_id;
  return new;
end;
$$;
REVOKE EXECUTE ON FUNCTION public.mensagens_atualiza_contato() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER mensagens_atualiza_contato AFTER INSERT ON public.mensagens_whatsapp
  FOR EACH ROW WHEN (new.autor = 'cliente') EXECUTE FUNCTION public.mensagens_atualiza_contato();

-- Uma linha por conversa. Quem nunca trocou mensagem não aparece.
CREATE VIEW public.conversas_lista WITH (security_invoker = true) AS
SELECT d.id AS contato_id, d.nome, d.whatsapp, d.status,
  (d.assumido_por IS NOT NULL) AS assumida, d.assumido_por, d.assumido_em, u.nome AS assumido_por_nome,
  ultima.conteudo AS ultimo_conteudo, ultima.tipo AS ultimo_tipo, ultima.autor AS ultimo_autor, ultima.criada_em AS ultima_em,
  coalesce(pend.total, 0) AS nao_lidas,
  (SELECT min(r.data_reuniao) FROM public.reunioes r WHERE r.contato_id = d.id AND r.status = 'agendada' AND r.data_reuniao >= now()) AS proxima_reuniao
FROM public.contatos_dados d
JOIN LATERAL (SELECT m.conteudo, m.tipo, m.autor, m.criada_em FROM public.mensagens_whatsapp m
              WHERE m.contato_id = d.id ORDER BY m.criada_em DESC LIMIT 1) ultima ON true
LEFT JOIN LATERAL (SELECT count(*) AS total FROM public.mensagens_whatsapp m
                   WHERE m.contato_id = d.id AND m.autor = 'cliente' AND NOT m.lida) pend ON true
LEFT JOIN public.usuarios u ON u.id = d.assumido_por;

ALTER TABLE public.conversas_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mensagens_whatsapp ENABLE ROW LEVEL SECURITY;
CREATE POLICY equipe_leitura ON public.conversas_config FOR SELECT TO authenticated USING (true);
CREATE POLICY gestor_atualiza ON public.conversas_config FOR UPDATE TO authenticated USING (public.usuario_e_gestor()) WITH CHECK (public.usuario_e_gestor());
CREATE POLICY equipe_leitura ON public.mensagens_whatsapp FOR SELECT TO authenticated USING (true);
CREATE POLICY equipe_marca_lida ON public.mensagens_whatsapp FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

REVOKE ALL ON public.mensagens_whatsapp, public.conversas_config, public.conversas_lista FROM anon, authenticated;
GRANT SELECT ON public.mensagens_whatsapp, public.conversas_config, public.conversas_lista TO authenticated;
GRANT UPDATE (lida) ON public.mensagens_whatsapp TO authenticated;
GRANT UPDATE (provedor) ON public.conversas_config TO authenticated;
GRANT ALL ON public.mensagens_whatsapp, public.conversas_config TO service_role;
GRANT SELECT ON public.conversas_lista TO service_role;

ALTER PUBLICATION supabase_realtime ADD TABLE public.mensagens_whatsapp;

-- Mídias recebidas: privadas; a equipe lê por URL assinada, só a função grava.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('midias-whatsapp', 'midias-whatsapp', false, 52428800) ON CONFLICT (id) DO NOTHING;
CREATE POLICY midias_whatsapp_leitura ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'midias-whatsapp');

INSERT INTO crm_base_private.schema_migrations(version) VALUES ('0007_modulo_conversas');
NOTIFY pgrst, 'reload schema';
COMMIT;
