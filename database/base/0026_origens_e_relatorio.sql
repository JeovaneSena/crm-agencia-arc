BEGIN;
ALTER TABLE public.captacao_fontes ADD COLUMN codigo_ref text UNIQUE CHECK(codigo_ref ~ '^[a-zA-Z0-9_-]{3,64}$'),
 ADD COLUMN utm_ref jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(utm_ref)='object');
GRANT SELECT(codigo_ref,utm_ref) ON public.captacao_fontes TO authenticated;
ALTER TABLE public.contato_atribuicoes ALTER COLUMN fonte_id DROP NOT NULL,
 ADD COLUMN canal text NOT NULL DEFAULT 'formulario' CHECK(canal IN ('formulario','referencia','meta')),
 ADD COLUMN referencia text,
 ADD COLUMN meta jsonb NOT NULL DEFAULT '{}',
 ADD CONSTRAINT atribuicao_canal CHECK((canal='meta' AND fonte_id IS NULL) OR (canal<>'meta' AND fonte_id IS NOT NULL));
CREATE INDEX contato_atribuicoes_data ON public.contato_atribuicoes(recebida_em);

CREATE FUNCTION public.captacao_configurar_referencia(p_fonte uuid,p_codigo text,p_utm jsonb DEFAULT '{}') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE limpo jsonb; BEGIN
 IF NOT public.usuario_e_gestor() THEN RAISE EXCEPTION 'Só gestor configura a origem.' USING errcode='42501'; END IF;
 IF p_codigo IS NOT NULL AND p_codigo !~ '^[a-zA-Z0-9_-]{3,64}$' THEN RAISE EXCEPTION 'Código inválido.' USING errcode='22023'; END IF;
 IF p_utm IS NULL OR jsonb_typeof(p_utm)<>'object' THEN RAISE EXCEPTION 'UTMs inválidas.' USING errcode='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_utm) WHERE key NOT IN ('utm_source','utm_medium','utm_campaign','utm_content','utm_term') OR jsonb_typeof(value)<>'string' OR length(value#>>'{}')>200) THEN
  RAISE EXCEPTION 'UTMs inválidas.' USING errcode='22023';
 END IF;
 SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO limpo FROM jsonb_each(p_utm) WHERE length(value#>>'{}')>0;
 UPDATE public.captacao_fontes SET codigo_ref=p_codigo,utm_ref=limpo WHERE id=p_fonte;
 IF NOT FOUND THEN RAISE EXCEPTION 'Fonte não encontrada.' USING errcode='P0002'; END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.captacao_configurar_referencia(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.captacao_configurar_referencia(uuid,text,jsonb) TO authenticated;

-- Não depende das tabelas de conversas ou assistente; só service_role pode receber.
CREATE FUNCTION public.captacao_contato_whatsapp(p_whatsapp text,p_origem jsonb DEFAULT NULL,p_ia boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c uuid; novo boolean; f public.captacao_fontes; m jsonb; meta_limpa jsonb;
BEGIN
 IF p_whatsapp IS NULL OR p_whatsapp !~ '^[1-9][0-9]{7,14}$' THEN RAISE EXCEPTION 'Telefone inválido.' USING errcode='22023'; END IF;
 -- Todas as entradas da captação compartilham a trava por telefone.
 -- Trava fonte antes de telefone, como captacao_receber, para evitar deadlock.
 IF p_origem->>'canal'='referencia' THEN
  SELECT * INTO f FROM public.captacao_fontes WHERE codigo_ref=p_origem->>'referencia' AND ativa FOR SHARE;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtext(p_whatsapp));
 INSERT INTO public.contatos_dados(whatsapp) VALUES(p_whatsapp)
 ON CONFLICT(whatsapp) WHERE whatsapp IS NOT NULL DO NOTHING RETURNING id INTO c;
 novo:=c IS NOT NULL;
 IF NOT novo THEN SELECT id INTO c FROM public.contatos_dados WHERE whatsapp=p_whatsapp; RETURN c; END IF;
 IF p_ia IS TRUE AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contatos_dados' AND column_name='ia_ligada') THEN
  EXECUTE 'UPDATE public.contatos_dados SET ia_ligada=true WHERE id=$1' USING c;
 END IF;
 IF f.id IS NOT NULL THEN
  INSERT INTO public.contato_atribuicoes(contato_id,fonte_id,canal,referencia,utm) VALUES(c,f.id,'referencia',f.codigo_ref,f.utm_ref);
 ELSIF p_origem->>'canal'='meta' THEN
  m:=p_origem->'meta';
  IF m->>'source_type' IN ('ad','post') AND m->>'source_id' ~ '^[0-9]{1,80}$' THEN
   meta_limpa:=jsonb_build_object('source_type',m->>'source_type','source_id',m->>'source_id');
   IF m->>'ctwa_clid' ~ '^[a-zA-Z0-9_-]+$' AND length(m->>'ctwa_clid') BETWEEN 1 AND 512 THEN meta_limpa:=meta_limpa||jsonb_build_object('ctwa_clid',m->>'ctwa_clid'); END IF;
   INSERT INTO public.contato_atribuicoes(contato_id,canal,meta,utm) VALUES(c,'meta',meta_limpa,jsonb_build_object('utm_source','meta','utm_medium',CASE WHEN m->>'source_type'='ad' THEN 'paid_social' ELSE 'social' END,'utm_content',m->>'source_id'));
  END IF;
 END IF;
 RETURN c;
END $$;
REVOKE EXECUTE ON FUNCTION public.captacao_contato_whatsapp(text,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.captacao_contato_whatsapp(text,jsonb,boolean) TO service_role;

-- Coorte por data de criação do contato; ganhos/valores são o estado atual dos negócios.
-- Pré-agrega negócios para não multiplicar leads por quantidade de oportunidades.
CREATE FUNCTION public.captacao_relatorio(p_inicio timestamptz,p_fim timestamptz)
RETURNS TABLE(canal text,fonte text,origem text,campanha text,conteudo text,leads bigint,ganhos bigint,valor_ganho numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.usuarios WHERE id=auth.uid() AND ativo) THEN RAISE EXCEPTION 'Sem acesso.' USING errcode='42501'; END IF;
 IF p_inicio IS NULL OR p_fim IS NULL OR p_fim<=p_inicio OR p_fim-p_inicio>interval '366 days' THEN RAISE EXCEPTION 'Escolha um período de até 366 dias.' USING errcode='22023'; END IF;
 RETURN QUERY
 WITH negocios AS (
  SELECT o.contato_id,count(*) FILTER(WHERE o.status='ganho') AS ganhos,
   coalesce(sum(o.valor_proposta) FILTER(WHERE o.status='ganho'),0) AS valor
  FROM public.oportunidades o JOIN public.contatos_dados c ON c.id=o.contato_id
  WHERE c.created_at>=p_inicio AND c.created_at<p_fim GROUP BY o.contato_id
 )
 SELECT coalesce(a.canal,'sem_origem'),coalesce(f.nome,CASE WHEN a.canal='meta' THEN 'Meta' ELSE 'Sem origem registrada' END),
 coalesce(nullif(a.utm->>'utm_source',''),'Sem UTM'),coalesce(nullif(a.utm->>'utm_campaign',''),'Sem campanha'),
 coalesce(nullif(a.utm->>'utm_content',''),'Sem conteúdo'),count(*),coalesce(sum(n.ganhos),0)::bigint,coalesce(sum(n.valor),0)
 FROM public.contatos_dados c LEFT JOIN public.contato_atribuicoes a ON a.contato_id=c.id
 LEFT JOIN public.captacao_fontes f ON f.id=a.fonte_id LEFT JOIN negocios n ON n.contato_id=c.id
 WHERE c.created_at>=p_inicio AND c.created_at<p_fim
 GROUP BY 1,2,3,4,5 ORDER BY count(*) DESC,2,3,4,5;
END $$;
REVOKE EXECUTE ON FUNCTION public.captacao_relatorio(timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.captacao_relatorio(timestamptz,timestamptz) TO authenticated;
INSERT INTO crm_base_private.schema_migrations(version) VALUES('0026_origens_e_relatorio');
NOTIFY pgrst,'reload schema';
COMMIT;
