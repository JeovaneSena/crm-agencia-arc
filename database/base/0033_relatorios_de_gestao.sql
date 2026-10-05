BEGIN;
ALTER TABLE public.oportunidades ADD COLUMN fechamento_previsto date,ADD COLUMN etapa_perda text REFERENCES public.etapas_funil(chave);
ALTER TABLE public.etapas_funil ADD COLUMN probabilidade smallint NOT NULL DEFAULT 0 CHECK(probabilidade BETWEEN 0 AND 100);
UPDATE public.etapas_funil SET probabilidade=100 WHERE tipo='ganho';
UPDATE public.oportunidades o SET etapa_perda=(SELECT e.status_anterior FROM public.oportunidade_eventos e WHERE e.oportunidade_id=o.id AND e.status_novo='perdido' ORDER BY e.created_at DESC LIMIT 1) WHERE o.status='perdido' AND o.fechado_em IS NULL;
CREATE FUNCTION public.oportunidade_gestao() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$ BEGIN
 IF tg_op='INSERT' THEN new.etapa_perda:=NULL;
 ELSE
  new.etapa_perda:=CASE WHEN new.status='perdido' AND old.status<>'perdido' AND old.fechado_em IS NULL THEN old.status ELSE old.etapa_perda END;
  IF old.fechado_em IS NOT NULL THEN new.fechamento_previsto:=old.fechamento_previsto;END IF;
 END IF;RETURN new;
END $$;
CREATE TRIGGER oportunidade_y_gestao BEFORE INSERT OR UPDATE ON public.oportunidades FOR EACH ROW EXECUTE FUNCTION public.oportunidade_gestao();
CREATE FUNCTION public.relatorio_gestao(p_inicio timestamptz,p_fim timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE desempenho jsonb;perdas jsonb;previsao jsonb;conversas jsonb:='[]'; BEGIN
 IF NOT public.usuario_e_gestor() THEN RAISE EXCEPTION 'Só gestor consulta os relatórios.' USING errcode='42501';END IF;
 IF p_inicio IS NULL OR p_fim IS NULL OR p_fim<=p_inicio OR p_fim-p_inicio>interval '366 days' THEN RAISE EXCEPTION 'Período inválido: até 366 dias.' USING errcode='22023';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO desempenho FROM (
  SELECT u.id,u.nome,u.ativo,
   (SELECT count(*) FROM public.oportunidades o WHERE o.responsavel_id=u.id AND o.status='ganho' AND o.fechado_em>=p_inicio AND o.fechado_em<p_fim) ganhos,
   (SELECT count(*) FROM public.oportunidade_eventos e JOIN public.oportunidades o ON o.id=e.oportunidade_id WHERE o.responsavel_id=u.id AND e.status_novo='perdido' AND e.status_anterior IS DISTINCT FROM 'perdido' AND o.fechado_em IS NULL AND e.created_at>=p_inicio AND e.created_at<p_fim) perdas,
   (SELECT coalesce(sum(o.valor_proposta),0) FROM public.oportunidades o WHERE o.responsavel_id=u.id AND o.status='ganho' AND o.fechado_em>=p_inicio AND o.fechado_em<p_fim) valor
  FROM public.usuarios u ORDER BY u.nome,u.id
 ) x;
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO perdas FROM (
  SELECT o.motivo_perda,coalesce(m.rotulo,'Sem motivo registrado') motivo,coalesce(f.rotulo,'Etapa não registrada') etapa,count(*) quantidade
  FROM public.oportunidades o LEFT JOIN public.motivos_perda m ON m.chave=o.motivo_perda LEFT JOIN public.etapas_funil f ON f.chave=o.etapa_perda
  WHERE o.status='perdido' AND o.fechado_em IS NULL AND EXISTS(SELECT 1 FROM public.oportunidade_eventos e WHERE e.oportunidade_id=o.id AND e.status_novo='perdido' AND e.created_at>=p_inicio AND e.created_at<p_fim)
  GROUP BY o.motivo_perda,m.rotulo,f.rotulo ORDER BY count(*) DESC,m.rotulo,f.rotulo
 ) x;
 SELECT jsonb_build_object('total',coalesce(sum(o.valor_proposta),0),'ponderado',coalesce(sum(o.valor_proposta*f.probabilidade/100),0),'quantidade',count(*),'sem_data',(SELECT count(*) FROM public.oportunidades oo JOIN public.etapas_funil ff ON ff.chave=oo.status AND ff.tipo='aberta' WHERE oo.fechado_em IS NULL AND oo.fechamento_previsto IS NULL)) INTO previsao
 FROM public.oportunidades o JOIN public.etapas_funil f ON f.chave=o.status AND f.tipo='aberta'
 WHERE o.fechado_em IS NULL AND o.fechamento_previsto>=(p_inicio AT TIME ZONE 'UTC')::date AND o.fechamento_previsto<(p_fim AT TIME ZONE 'UTC')::date;
 IF to_regclass('public.mensagens_whatsapp') IS NOT NULL THEN
  EXECUTE $q$WITH primeiros AS (
   SELECT m.contato_id,min(m.criada_em) em FROM public.mensagens_whatsapp m WHERE m.autor='cliente' AND m.criada_em>=$1 AND m.criada_em<$2 GROUP BY m.contato_id
  ), respostas AS (
   SELECT p.contato_id,p.em,a.enviada_por,a.criada_em FROM primeiros p JOIN LATERAL(
    SELECT m.enviada_por,m.criada_em FROM public.mensagens_whatsapp m WHERE m.contato_id=p.contato_id AND m.autor='atendente' AND m.enviada_por IS NOT NULL AND m.criada_em>=p.em AND m.criada_em<$2 AND m.estado_envio IN ('enviado','entregue','lido') ORDER BY m.criada_em,m.id LIMIT 1
   ) a ON true
  ) SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (
   SELECT u.id,(SELECT count(DISTINCT m.contato_id) FROM public.mensagens_whatsapp m WHERE m.enviada_por=u.id AND m.autor='atendente' AND m.estado_envio IN ('enviado','entregue','lido') AND m.criada_em>=$1 AND m.criada_em<$2) conversas,
    (SELECT count(*) FROM respostas r WHERE r.enviada_por=u.id) primeiras_respostas,
    (SELECT avg(extract(epoch FROM r.criada_em-r.em))/60 FROM respostas r WHERE r.enviada_por=u.id) primeira_resposta_minutos
   FROM public.usuarios u
  ) x$q$ INTO conversas USING p_inicio,p_fim;
 END IF;
 RETURN jsonb_build_object('desempenho',desempenho,'conversas',conversas,'conversas_disponiveis',to_regclass('public.mensagens_whatsapp') IS NOT NULL,'perdas',perdas,'previsao',previsao);
END $$;
REVOKE ALL ON FUNCTION public.relatorio_gestao(timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.relatorio_gestao(timestamptz,timestamptz) TO authenticated,service_role;
INSERT INTO crm_base_private.schema_migrations(version) VALUES('0033_relatorios_de_gestao');
NOTIFY pgrst,'reload schema';
COMMIT;
