BEGIN;
-- Passo 3 do núcleo configurável: só a tabela de rótulos do funil. As 8
-- chaves técnicas e as transições automáticas da agenda continuam fixas
-- (reunioes_sincroniza_funil, oportunidade.status) — rótulo, ordem e cor
-- de cada etapa é que ficam editáveis pela interface.
CREATE TABLE public.etapas_funil (
  chave text PRIMARY KEY CHECK (chave = ANY (ARRAY['novo_lead','qualificacao','diagnostico','diagnostico_realizado','proposta','negociacao','ganho','perdido'])),
  rotulo text NOT NULL CHECK (length(trim(rotulo)) BETWEEN 1 AND 40),
  cor text NOT NULL DEFAULT 'accent' CHECK (cor = ANY (ARRAY['accent','info','success','warning','purple','danger'])),
  ordem smallint NOT NULL,
  tipo text NOT NULL CHECK (tipo = ANY (ARRAY['aberta','ganho','perdido']))
);
CREATE UNIQUE INDEX etapas_funil_ordem_unica ON public.etapas_funil(ordem);

ALTER TABLE public.etapas_funil ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.etapas_funil FROM PUBLIC, anon;
GRANT ALL ON TABLE public.etapas_funil TO service_role;
GRANT SELECT ON TABLE public.etapas_funil TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.etapas_funil TO authenticated;
CREATE POLICY equipe_leitura ON public.etapas_funil FOR SELECT TO authenticated USING (true);
CREATE POLICY gestor_escreve ON public.etapas_funil FOR ALL TO authenticated USING (public.usuario_e_gestor()) WITH CHECK (public.usuario_e_gestor());

-- Vocabulário-padrão do funil, não marca nem dado de cliente (mesmo espírito
-- do horario_comercial placeholder da 0001) — rótulo, ordem e cor de sobra
-- para a equipe reconfigurar pela tela.
INSERT INTO public.etapas_funil (chave, rotulo, cor, ordem, tipo) VALUES
  ('novo_lead', 'Novo lead', 'accent', 1, 'aberta'),
  ('qualificacao', 'Qualificação', 'info', 2, 'aberta'),
  ('diagnostico', 'Diagnóstico', 'success', 3, 'aberta'),
  ('diagnostico_realizado', 'Diagnóstico realizado', 'success', 4, 'aberta'),
  ('proposta', 'Proposta', 'warning', 5, 'aberta'),
  ('negociacao', 'Negociação', 'purple', 6, 'aberta'),
  ('ganho', 'Ganho', 'success', 7, 'ganho'),
  ('perdido', 'Perdido', 'danger', 8, 'perdido');

INSERT INTO crm_base_private.schema_migrations(version) VALUES ('0002_nucleo_configuravel');
NOTIFY pgrst, 'reload schema';
COMMIT;
