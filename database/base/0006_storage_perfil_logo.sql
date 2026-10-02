BEGIN;
-- Foto do perfil (`avatars`) e logo da empresa (`logos`). Buckets públicos: as
-- telas usam getPublicUrl(). Só imagens, até 2 MB (a mesma regra da tela, agora
-- também no servidor). Avatar: cada pessoa só mexe na PRÓPRIA pasta
-- (`<auth.uid()>/...`). Logo: só o gestor, como o resto da configuração.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('avatars', 'avatars', true, 2097152, ARRAY['image/jpeg','image/png','image/webp','image/svg+xml']),
  ('logos',   'logos',   true, 2097152, ARRAY['image/jpeg','image/png','image/webp','image/svg+xml'])
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY avatars_leitura ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
CREATE POLICY logos_leitura ON storage.objects FOR SELECT USING (bucket_id = 'logos');

-- INSERT + UPDATE porque a tela grava com { upsert: true }.
CREATE POLICY avatars_proprio_insere ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY avatars_proprio_atualiza ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY avatars_proprio_apaga ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY logos_gestor_insere ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'logos' AND public.usuario_e_gestor());
CREATE POLICY logos_gestor_atualiza ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'logos' AND public.usuario_e_gestor());
CREATE POLICY logos_gestor_apaga ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'logos' AND public.usuario_e_gestor());

INSERT INTO crm_base_private.schema_migrations(version) VALUES ('0006_storage_perfil_logo');
NOTIFY pgrst, 'reload schema';
COMMIT;
