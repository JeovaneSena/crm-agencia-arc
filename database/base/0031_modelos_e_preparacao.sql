BEGIN;
CREATE TABLE public.modelos_nicho(chave text PRIMARY KEY,nome text NOT NULL,rotulos jsonb NOT NULL CHECK(jsonb_array_length(rotulos)=8));
INSERT INTO public.modelos_nicho VALUES
('generico','Operação geral','["Novo lead", "Qualificação", "Diagnóstico", "Diagnóstico realizado", "Proposta", "Negociação", "Ganho", "Perdido"]'::jsonb),
('servicos','Serviços profissionais','["Novo contato", "Entender a necessidade", "Reunião marcada", "Reunião realizada", "Escopo e proposta", "Ajustes finais", "Contrato fechado", "Não fechado"]'::jsonb),
('imobiliario','Negociação de imóveis','["Novo interessado", "Perfil e orçamento", "Visita marcada", "Visita realizada", "Proposta de compra", "Negociação", "Venda fechada", "Não fechado"]'::jsonb);
ALTER TABLE public.modelos_nicho ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.modelos_nicho FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.modelos_nicho TO authenticated;
GRANT ALL ON public.modelos_nicho TO service_role;
CREATE POLICY equipe_le ON public.modelos_nicho FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.usuarios WHERE id=auth.uid() AND ativo));
CREATE FUNCTION public.funil_modelo_aplicar(p_modelo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE r jsonb;chaves text[]:=ARRAY['novo_lead','qualificacao','diagnostico','diagnostico_realizado','proposta','negociacao','ganho','perdido'];i integer; BEGIN
 IF NOT public.usuario_e_gestor() THEN RAISE EXCEPTION 'Só gestor aplica modelos.' USING errcode='42501';END IF;
 SELECT rotulos INTO r FROM public.modelos_nicho WHERE chave=p_modelo;
 IF NOT FOUND THEN RAISE EXCEPTION 'Modelo inválido.' USING errcode='22023';END IF;
 PERFORM 1 FROM public.preparacao_crm WHERE id FOR UPDATE;
 FOR i IN 1..8 LOOP UPDATE public.etapas_funil SET rotulo=r->>(i-1) WHERE chave=chaves[i];END LOOP;
 UPDATE public.preparacao_crm SET modelo=p_modelo,funil_confirmado=true WHERE id;
END $$;
CREATE FUNCTION public.funil_confirmar() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ BEGIN
 IF NOT public.usuario_e_gestor() THEN RAISE EXCEPTION 'Só gestor confirma o funil.' USING errcode='42501';END IF;
 UPDATE public.preparacao_crm SET funil_confirmado=true WHERE id;
END $$;
CREATE FUNCTION public.preparacao_status() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ BEGIN
 IF NOT public.usuario_e_gestor() THEN RAISE EXCEPTION 'Só gestor prepara o CRM.' USING errcode='42501';END IF;
 RETURN jsonb_build_object('empresa',EXISTS(SELECT 1 FROM public.configuracoes_negocio WHERE length(btrim(nome_negocio))>0),
 'catalogo',EXISTS(SELECT 1 FROM public.catalogo_servicos WHERE ativo AND NOT arquivado),
 'horarios',EXISTS(SELECT 1 FROM public.horario_comercial WHERE ativo),
 'funil',(SELECT funil_confirmado FROM public.preparacao_crm WHERE id),
 'concluida_em',(SELECT concluida_em FROM public.preparacao_crm WHERE id));
END $$;
REVOKE ALL ON FUNCTION public.funil_modelo_aplicar(text),public.funil_confirmar(),public.preparacao_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.funil_modelo_aplicar(text),public.funil_confirmar(),public.preparacao_status() TO authenticated,service_role;
INSERT INTO crm_base_private.schema_migrations(version) VALUES('0031_modelos_e_preparacao');
NOTIFY pgrst,'reload schema';
COMMIT;
