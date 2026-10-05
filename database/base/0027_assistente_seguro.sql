BEGIN;
ALTER TABLE public.contatos_dados DROP CONSTRAINT contatos_dados_ia_encaminhada_motivo_check;
ALTER TABLE public.contatos_dados ADD CONSTRAINT contatos_dados_ia_encaminhada_motivo_check CHECK(ia_encaminhada_motivo IN ('equipe','parar','humano'));
ALTER TABLE public.assistente_respostas DROP CONSTRAINT assistente_respostas_estado_check;
ALTER TABLE public.assistente_respostas ADD CONSTRAINT assistente_respostas_estado_check CHECK(estado IN ('processando','respondida','encaminhada','ignorada','falhou','aguardando'));
ALTER TABLE public.assistente_config ADD COLUMN teto_mensal_usd numeric NOT NULL DEFAULT 50 CHECK(teto_mensal_usd BETWEEN 0 AND 10000),
 ADD COLUMN saldo_openai boolean NOT NULL DEFAULT true, ADD COLUMN saldo_anthropic boolean NOT NULL DEFAULT true;
CREATE TABLE public.assistente_tarifas(modelo text PRIMARY KEY CHECK(modelo ~ '^(claude|gpt)-[a-z0-9.-]{1,60}$'),
 entrada numeric NOT NULL CHECK(entrada>0 AND entrada<=10000),saida numeric NOT NULL CHECK(saida>0 AND saida<=10000));
CREATE TABLE public.assistente_consumo(id uuid PRIMARY KEY,modelo text NOT NULL,mes date NOT NULL,
 estado text NOT NULL DEFAULT 'reservado' CHECK(estado IN ('reservado','medido','sem_saldo','incerto')),
 estimativa numeric NOT NULL CHECK(estimativa>=0),custo numeric CHECK(custo>=0),entrada integer,saida integer,
 tarifa_entrada numeric NOT NULL,tarifa_saida numeric NOT NULL,criado_em timestamptz NOT NULL DEFAULT now());
CREATE INDEX assistente_consumo_mes ON public.assistente_consumo(mes);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['assistente_tarifas','assistente_consumo'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
 EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 EXECUTE format('CREATE POLICY gestor_le ON public.%I FOR SELECT TO authenticated USING(public.usuario_e_gestor())',t);
 END LOOP;
END $$;
DROP POLICY equipe_leitura ON public.assistente_config;
CREATE POLICY equipe_leitura ON public.assistente_config FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.usuarios WHERE id=auth.uid() AND ativo));

CREATE FUNCTION public.assistente_financeiro_salvar(p_teto numeric,p_modelo text,p_entrada numeric,p_saida numeric) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ BEGIN
 IF NOT public.usuario_e_gestor() THEN RAISE EXCEPTION 'Só gestor configura custos.' USING errcode='42501'; END IF;
 IF p_teto IS NULL OR p_teto<0 OR p_teto>10000 OR p_entrada IS NULL OR p_saida IS NULL THEN RAISE EXCEPTION 'Valores inválidos.' USING errcode='22023'; END IF;
 UPDATE public.assistente_config SET teto_mensal_usd=p_teto WHERE id;
 PERFORM public.aviso_resolver_auto('assistente_sem_tarifa',p_modelo);
 INSERT INTO public.assistente_tarifas VALUES(p_modelo,p_entrada,p_saida) ON CONFLICT(modelo) DO UPDATE SET entrada=excluded.entrada,saida=excluded.saida;
END $$;
CREATE FUNCTION public.assistente_recarga_confirmar(p_provedor text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ BEGIN
 IF NOT public.usuario_e_gestor() THEN RAISE EXCEPTION 'Só gestor confirma recarga.' USING errcode='42501'; END IF;
 IF p_provedor IS NULL OR p_provedor NOT IN ('openai','anthropic') THEN RAISE EXCEPTION 'Provedor inválido.' USING errcode='22023'; END IF;
 UPDATE public.assistente_config SET saldo_openai=CASE WHEN p_provedor='openai' THEN true ELSE saldo_openai END,
 saldo_anthropic=CASE WHEN p_provedor='anthropic' THEN true ELSE saldo_anthropic END WHERE id;
 PERFORM public.aviso_resolver_auto('assistente_sem_saldo',p_provedor);
END $$;
CREATE FUNCTION public.assistente_consumo_reservar(p_id uuid,p_modelo text,p_entrada integer,p_saida integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c public.assistente_config; t public.assistente_tarifas; gasto numeric; custo numeric; v_mes date:=date_trunc('month',now() AT TIME ZONE 'UTC')::date; prov text:=CASE WHEN p_modelo LIKE 'claude-%' THEN 'anthropic' ELSE 'openai' END;
BEGIN
 IF p_id IS NULL OR p_entrada IS NULL OR p_saida IS NULL OR p_entrada NOT BETWEEN 0 AND 2000000 OR p_saida NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'Reserva inválida.' USING errcode='22023'; END IF;
 SELECT * INTO c FROM public.assistente_config WHERE id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.assistente_consumo WHERE id=p_id) THEN RETURN jsonb_build_object('ok',false,'motivo','reserva_repetida'); END IF;
 IF (prov='openai' AND NOT c.saldo_openai) OR (prov='anthropic' AND NOT c.saldo_anthropic) THEN RETURN jsonb_build_object('ok',false,'motivo','sem_saldo'); END IF;
 SELECT * INTO t FROM public.assistente_tarifas WHERE modelo=p_modelo;
 IF NOT FOUND THEN
  PERFORM public.aviso_abrir('assistente_sem_tarifa',p_modelo,'atencao','Configure o custo do modelo','Cadastre tarifas por milhão de tokens antes de usar a IA.','/assistente-ia',NULL,true);
  RETURN jsonb_build_object('ok',false,'motivo','sem_tarifa');
 END IF;
 custo:=ceil((p_entrada*t.entrada+p_saida*t.saida)/1000000*100000000)/100000000;
 SELECT coalesce(sum(coalesce(x.custo,x.estimativa)),0) INTO gasto FROM public.assistente_consumo x WHERE x.mes=v_mes;
 IF gasto+custo>c.teto_mensal_usd THEN
  PERFORM public.aviso_abrir('assistente_teto','mensal','atencao','A IA atingiu o limite disponível','Uma nova chamada ultrapassaria o teto mensal. Ajuste o teto ou aguarde o próximo mês.','/assistente-ia',NULL,true);
  RETURN jsonb_build_object('ok',false,'motivo','teto_mensal');
 END IF;
 INSERT INTO public.assistente_consumo(id,modelo,mes,estimativa,tarifa_entrada,tarifa_saida) VALUES(p_id,p_modelo,v_mes,custo,t.entrada,t.saida);
 IF gasto+custo<c.teto_mensal_usd THEN PERFORM public.aviso_resolver_auto('assistente_teto','mensal'); END IF;
 IF gasto+custo<c.teto_mensal_usd*0.8 THEN PERFORM public.aviso_resolver_auto('assistente_80','mensal'); END IF;
 IF gasto+custo>=c.teto_mensal_usd*0.8 THEN PERFORM public.aviso_abrir('assistente_80','mensal','atencao','A IA consumiu 80% do teto','Consumo e reservas chegaram a 80% do teto mensal.','/assistente-ia',NULL,true); END IF;
 RETURN jsonb_build_object('ok',true);
END $$;
CREATE FUNCTION public.assistente_consumo_finalizar(p_id uuid,p_uso jsonb,p_estado text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.assistente_consumo; e integer; s integer; prov text;
BEGIN
 -- Mesma ordem de trava da reserva; finalização repetida não soma novamente.
 PERFORM 1 FROM public.assistente_config WHERE id FOR UPDATE;
 SELECT * INTO r FROM public.assistente_consumo WHERE id=p_id FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Reserva não encontrada.' USING errcode='P0002'; END IF;
 IF r.estado<>'reservado' THEN RETURN; END IF;
 IF p_estado='medido' THEN
  IF jsonb_typeof(p_uso->'entrada') IS DISTINCT FROM 'number' OR jsonb_typeof(p_uso->'saida') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Uso inválido.' USING errcode='22023'; END IF;
  e:=(p_uso->>'entrada')::integer; s:=(p_uso->>'saida')::integer;
  IF e<0 OR s<0 THEN RAISE EXCEPTION 'Uso inválido.' USING errcode='22023'; END IF;
  UPDATE public.assistente_consumo SET estado='medido',entrada=e,saida=s,custo=ceil((e*r.tarifa_entrada+s*r.tarifa_saida)/1000000*100000000)/100000000 WHERE id=p_id;
 ELSIF p_estado='sem_saldo' THEN
  prov:=CASE WHEN r.modelo LIKE 'claude-%' THEN 'anthropic' ELSE 'openai' END;
  UPDATE public.assistente_consumo SET estado='sem_saldo',custo=0 WHERE id=p_id;
  UPDATE public.assistente_config SET saldo_openai=CASE WHEN prov='openai' THEN false ELSE saldo_openai END,saldo_anthropic=CASE WHEN prov='anthropic' THEN false ELSE saldo_anthropic END WHERE id;
  PERFORM public.aviso_abrir('assistente_sem_saldo',prov,'atencao','O provedor de IA precisa de recarga','Respostas aguardam a confirmação de recarga pelo gestor.','/assistente-ia',NULL,true);
 ELSIF p_estado='incerto' THEN UPDATE public.assistente_consumo SET estado='incerto' WHERE id=p_id;
 ELSE RAISE EXCEPTION 'Estado inválido.' USING errcode='22023'; END IF;
 IF (SELECT coalesce(sum(coalesce(x.custo,x.estimativa)),0) FROM public.assistente_consumo x WHERE x.mes=date_trunc('month',now() AT TIME ZONE 'UTC')::date)>=(SELECT teto_mensal_usd FROM public.assistente_config WHERE id) THEN
  PERFORM public.aviso_abrir('assistente_teto','mensal','atencao','A IA atingiu o teto mensal','Novas chamadas ficam aguardando orçamento disponível.','/assistente-ia',NULL,true);
 END IF;
END $$;
CREATE FUNCTION public.assistente_resposta_reservar(p_mensagem uuid,p_contato uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.mensagens_whatsapp WHERE id=p_mensagem AND contato_id=p_contato AND autor='cliente') THEN RETURN false; END IF;
 INSERT INTO public.assistente_respostas(mensagem_id,contato_id) VALUES(p_mensagem,p_contato)
 ON CONFLICT(mensagem_id) DO UPDATE SET estado='processando',motivo=NULL,updated_at=now() WHERE assistente_respostas.estado='aguardando';
 RETURN FOUND;
END $$;
CREATE FUNCTION public.assistente_pendentes() RETURNS TABLE(mensagem_id uuid,contato_id uuid,whatsapp text,conteudo text,tipo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ BEGIN
 UPDATE public.assistente_consumo SET estado='incerto' WHERE estado='reservado' AND criado_em<now()-interval '5 minutes';
 UPDATE public.assistente_respostas SET estado='ignorada',motivo='espera_expirada' WHERE estado='aguardando' AND created_at<now()-interval '24 hours';
 RETURN QUERY SELECT m.id,m.contato_id,c.whatsapp,m.conteudo,m.tipo FROM public.assistente_respostas r
 JOIN public.mensagens_whatsapp m ON m.id=r.mensagem_id JOIN public.contatos_dados c ON c.id=m.contato_id
 JOIN public.assistente_config cfg ON cfg.id JOIN public.assistente_tarifas t ON t.modelo=cfg.modelo
 WHERE r.estado='aguardando' AND CASE WHEN cfg.modelo LIKE 'claude-%' THEN cfg.saldo_anthropic ELSE cfg.saldo_openai END
 ORDER BY r.created_at LIMIT 3;
END $$;
CREATE FUNCTION public.assistente_consumo_resumo() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ BEGIN
 IF NOT public.usuario_e_gestor() THEN RAISE EXCEPTION 'Só gestor consulta custos.' USING errcode='42501'; END IF;
 RETURN (SELECT jsonb_build_object('gasto',coalesce(sum(custo) FILTER(WHERE estado='medido'),0),'reservado',coalesce(sum(estimativa) FILTER(WHERE estado IN ('reservado','incerto')),0),'chamadas',count(*)) FROM public.assistente_consumo WHERE mes=date_trunc('month',now() AT TIME ZONE 'UTC')::date);
END $$;
CREATE FUNCTION public.assistente_encaminhar(p_contato uuid,p_resumo text,p_motivo text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE tem_casos boolean:=to_regprocedure('public.assistente_caso_abrir(uuid,text,text)') IS NOT NULL; BEGIN
 IF p_resumo IS NULL OR length(btrim(p_resumo)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Resumo inválido.' USING errcode='22023'; END IF;
 PERFORM 1 FROM public.contatos_dados WHERE id=p_contato FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Contato não encontrado.' USING errcode='P0002'; END IF;
 UPDATE public.contatos_dados SET ia_ligada=false,ia_encaminhada_em=now(),ia_encaminhada_motivo=CASE WHEN p_motivo IS NOT NULL OR tem_casos THEN 'humano' ELSE 'equipe' END,ia_resumo=p_resumo WHERE id=p_contato;
 IF tem_casos THEN EXECUTE 'SELECT public.assistente_caso_abrir($1,$2,$3)' USING p_contato,coalesce(p_motivo,'modelo'),p_resumo; END IF;
 PERFORM public.aviso_abrir('assistente_encaminhou',p_contato::text,'atencao','Uma conversa precisa da equipe',p_resumo,'/conversas?lead='||p_contato::text,p_contato,false);
END $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure assinatura,proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('assistente_financeiro_salvar','assistente_recarga_confirmar','assistente_consumo_reservar','assistente_consumo_finalizar','assistente_resposta_reservar','assistente_pendentes','assistente_consumo_resumo','assistente_encaminhar') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.assinatura);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.assinatura);
 IF f.proname IN ('assistente_financeiro_salvar','assistente_recarga_confirmar','assistente_consumo_resumo') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.assinatura); END IF;
 END LOOP;
END $$;
INSERT INTO crm_base_private.schema_migrations(version) VALUES('0027_assistente_seguro');
NOTIFY pgrst,'reload schema';
COMMIT;
