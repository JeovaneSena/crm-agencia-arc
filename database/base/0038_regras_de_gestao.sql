BEGIN;
CREATE TABLE public.gestao_regras(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),nome text NOT NULL CHECK(length(btrim(nome)) BETWEEN 1 AND 100),ativa boolean NOT NULL DEFAULT false,
 quando text NOT NULL CHECK(quando IN ('negocio_criado','etapa_alterada','dias_na_etapa','dias_sem_resposta','data','etiqueta_adicionada','mensagem_recebida','envio_falhou','reuniao_criada','reuniao_confirmada','reuniao_remarcada','reuniao_cancelada','reuniao_faltou','reuniao_realizada')),
 horas integer NOT NULL DEFAULT 24 CHECK(horas BETWEEN 1 AND 2160),condicoes jsonb NOT NULL DEFAULT '{}',acoes jsonb NOT NULL,versao integer NOT NULL DEFAULT 1);
CREATE TABLE public.gestao_eventos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),raiz uuid NOT NULL,profundidade integer NOT NULL DEFAULT 0 CHECK(profundidade BETWEEN 0 AND 5),tipo text NOT NULL,contato_id uuid NOT NULL REFERENCES public.contatos_dados(id) ON DELETE CASCADE,oportunidade_id uuid REFERENCES public.oportunidades(id) ON DELETE CASCADE,reuniao_id uuid REFERENCES public.reunioes(id) ON DELETE CASCADE,chave text UNIQUE,regra_alvo uuid REFERENCES public.gestao_regras(id),estado text NOT NULL DEFAULT 'pendente' CHECK(estado IN ('pendente','processado')),criado_em timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.gestao_execucoes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),regra_id uuid NOT NULL REFERENCES public.gestao_regras(id),evento_id uuid NOT NULL REFERENCES public.gestao_eventos(id) ON DELETE CASCADE,raiz uuid NOT NULL,estado text NOT NULL CHECK(estado IN ('executada','falhou')),erro text,criado_em timestamptz NOT NULL DEFAULT now(),UNIQUE(regra_id,raiz));
CREATE TABLE public.gestao_saidas(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),execucao_id uuid NOT NULL REFERENCES public.gestao_execucoes(id) ON DELETE CASCADE,contato_id uuid NOT NULL REFERENCES public.contatos_dados(id) ON DELETE CASCADE,acao jsonb NOT NULL,estado text NOT NULL DEFAULT 'pendente' CHECK(estado IN ('pendente','reservado','chamando','enviado','falhou','incerto','cancelado')),token uuid,reservado_em timestamptz,erro text,mensagem_id uuid,criado_em timestamptz NOT NULL DEFAULT now());
CREATE INDEX gestao_eventos_pendentes ON public.gestao_eventos(criado_em) WHERE estado='pendente';
CREATE INDEX gestao_saidas_pendentes ON public.gestao_saidas(criado_em) WHERE estado IN ('pendente','reservado','chamando');
ALTER TABLE public.reunioes ADD COLUMN confirmada_em timestamptz;
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['gestao_regras','gestao_eventos','gestao_execucoes','gestao_saidas'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
 EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 EXECUTE format('CREATE POLICY gestor_le ON public.%I FOR SELECT TO authenticated USING(public.usuario_e_gestor())',t);
 EXECUTE format('CREATE TRIGGER auditoria AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.auditar_mudanca()',t);
END LOOP;END $$;
CREATE FUNCTION public.gestao_regra_salvar(p_id uuid,p_nome text,p_ativa boolean,p_quando text,p_horas integer,p_condicoes jsonb,p_acoes jsonb,p_versao integer DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE i uuid:=coalesce(p_id,gen_random_uuid());a jsonb;t text;BEGIN
 IF NOT public.usuario_e_gestor() THEN RAISE EXCEPTION 'Só gestor configura regras.' USING errcode='42501';END IF;
 IF jsonb_typeof(p_condicoes) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_condicoes) k WHERE k NOT IN ('etapa','etiqueta','responsavel')) OR jsonb_typeof(p_acoes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_acoes) NOT BETWEEN 1 AND 10 OR pg_column_size(p_acoes)>16000 THEN RAISE EXCEPTION 'Condições ou ações inválidas.' USING errcode='22023';END IF;
 IF p_condicoes?'etapa' AND NOT EXISTS(SELECT 1 FROM public.etapas_funil WHERE chave=p_condicoes->>'etapa') THEN RAISE EXCEPTION 'Etapa inválida.' USING errcode='22023';END IF;
 IF p_condicoes?'etiqueta' AND NOT EXISTS(SELECT 1 FROM public.etiquetas WHERE id::text=p_condicoes->>'etiqueta') THEN RAISE EXCEPTION 'Etiqueta inválida.' USING errcode='22023';END IF;
 IF p_condicoes?'responsavel' AND NOT EXISTS(SELECT 1 FROM public.usuarios WHERE id::text=p_condicoes->>'responsavel' AND ativo) THEN RAISE EXCEPTION 'Responsável inválido.' USING errcode='22023';END IF;
 FOR a IN SELECT * FROM jsonb_array_elements(p_acoes) LOOP
 t:=a->>'tipo';
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(a) k WHERE k<>ALL(CASE t WHEN 'etiqueta' THEN ARRAY['tipo','id'] WHEN 'responsavel' THEN ARRAY['tipo','id'] WHEN 'mover_negocio' THEN ARRAY['tipo','etapa'] WHEN 'criar_negocio' THEN ARRAY['tipo','titulo'] WHEN 'tarefa' THEN ARRAY['tipo','titulo'] WHEN 'whatsapp' THEN ARRAY['tipo','texto'] WHEN 'mensagem_ia' THEN ARRAY['tipo','instrucao'] WHEN 'followup' THEN ARRAY['tipo','regra'] ELSE ARRAY['tipo','destino'] END)) THEN RAISE EXCEPTION 'Parâmetro de ação desconhecido.' USING errcode='22023';END IF;
 IF jsonb_typeof(a) IS DISTINCT FROM 'object' OR t IS NULL OR t NOT IN ('etiqueta','responsavel','mover_negocio','criar_negocio','tarefa','whatsapp','mensagem_ia','followup','webhook') THEN RAISE EXCEPTION 'Ação inválida.' USING errcode='22023';END IF;
 IF t IN ('whatsapp','mensagem_ia','followup') AND to_regclass('public.automacao_permissoes') IS NULL THEN RAISE EXCEPTION 'Esta ação exige o módulo conversas.' USING errcode='22023';END IF;
 IF t='mensagem_ia' AND to_regclass('public.assistente_config') IS NULL THEN RAISE EXCEPTION 'Esta ação exige assistente.' USING errcode='22023';END IF;
 IF t='etiqueta' AND NOT EXISTS(SELECT 1 FROM public.etiquetas WHERE id::text=a->>'id') THEN RAISE EXCEPTION 'Etiqueta inválida.' USING errcode='22023';END IF;
 IF t='responsavel' AND NOT EXISTS(SELECT 1 FROM public.usuarios WHERE id::text=a->>'id' AND ativo) THEN RAISE EXCEPTION 'Responsável inválido.' USING errcode='22023';END IF;
 IF t='mover_negocio' AND NOT EXISTS(SELECT 1 FROM public.etapas_funil WHERE chave=a->>'etapa' AND tipo='aberta') THEN RAISE EXCEPTION 'Só mova para etapas abertas.' USING errcode='22023';END IF;
 IF t IN ('tarefa','criar_negocio') AND coalesce(length(btrim(a->>'titulo')),0) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'Informe o título.' USING errcode='22023';END IF;
 IF t='whatsapp' AND coalesce(length(btrim(a->>'texto')),0) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Informe o texto.' USING errcode='22023';END IF;
 IF t='mensagem_ia' AND coalesce(length(btrim(a->>'instrucao')),0) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Informe a instrução.' USING errcode='22023';END IF;
 IF t='webhook' AND coalesce(a->>'destino','') !~ '^[a-z][a-z0-9_]{1,39}$' THEN RAISE EXCEPTION 'Informe o nome do destino configurado no servidor.' USING errcode='22023';END IF;
 IF t='followup' THEN IF NOT EXISTS(SELECT 1 FROM public.automacao_regras WHERE id::text=a->>'regra' AND tipo='followup') THEN RAISE EXCEPTION 'Regra de follow-up inválida.' USING errcode='22023';END IF;END IF;
 END LOOP;
 IF p_id IS NULL AND (SELECT count(*) FROM public.gestao_regras)>=100 THEN RAISE EXCEPTION 'Limite de 100 regras.' USING errcode='22023';END IF;
 IF p_id IS NULL THEN INSERT INTO public.gestao_regras(id,nome,ativa,quando,horas,condicoes,acoes) VALUES(i,btrim(p_nome),p_ativa,p_quando,p_horas,p_condicoes,p_acoes);
 ELSE UPDATE public.gestao_regras SET nome=btrim(p_nome),ativa=p_ativa,quando=p_quando,horas=p_horas,condicoes=p_condicoes,acoes=p_acoes,versao=versao+1 WHERE id=i AND versao=p_versao;
 IF NOT FOUND THEN RAISE EXCEPTION 'Regra mudou. Atualize.' USING errcode='22023';END IF;END IF;RETURN i;
END $$;
CREATE FUNCTION public.gestao_evento(p_tipo text,p_contato uuid,p_oportunidade uuid DEFAULT NULL,p_reuniao uuid DEFAULT NULL,p_chave text DEFAULT NULL,p_regra uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE raiz uuid:=coalesce(nullif(current_setting('crm.gestao_raiz',true),'')::uuid,gen_random_uuid());nivel integer:=coalesce(nullif(current_setting('crm.gestao_nivel',true),'')::integer,0);BEGIN
 IF nivel>5 THEN RETURN;END IF;
 INSERT INTO public.gestao_eventos(raiz,profundidade,tipo,contato_id,oportunidade_id,reuniao_id,chave,regra_alvo) VALUES(raiz,nivel,p_tipo,p_contato,p_oportunidade,p_reuniao,p_chave,p_regra) ON CONFLICT(chave) DO NOTHING;
END $$;
CREATE FUNCTION public.reuniao_confirmar(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$ BEGIN
 UPDATE public.reunioes SET confirmada_em=now() WHERE id=p_id AND status='agendada' AND data_reuniao>now() AND confirmada_em IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reunião mudou ou já foi confirmada.' USING errcode='22023';END IF;
END $$;
REVOKE ALL ON FUNCTION public.reuniao_confirmar(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reuniao_confirmar(uuid) TO authenticated;
CREATE FUNCTION public.reuniao_confirmacao_redefinir() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF new.data_reuniao IS DISTINCT FROM old.data_reuniao THEN new.confirmada_em:=NULL;END IF;RETURN new;
END $$;
CREATE TRIGGER reuniao_confirmacao_redefinir BEFORE UPDATE ON public.reunioes FOR EACH ROW EXECUTE FUNCTION public.reuniao_confirmacao_redefinir();
CREATE FUNCTION public.gestao_gatilho() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE t text;BEGIN
 IF tg_table_name='oportunidades' THEN IF tg_op='INSERT' THEN t:='negocio_criado';ELSIF new.status IS DISTINCT FROM old.status THEN t:='etapa_alterada';END IF;
 IF t IS NOT NULL THEN PERFORM public.gestao_evento(t,new.contato_id,new.id);END IF;
 ELSIF tg_table_name='contato_etiquetas' THEN PERFORM public.gestao_evento('etiqueta_adicionada',new.contato_id);
 ELSIF tg_table_name='reunioes' THEN
 IF tg_op='INSERT' THEN t:='reuniao_criada';
 ELSIF new.status IS DISTINCT FROM old.status THEN t:='reuniao_'||new.status;
 ELSIF new.data_reuniao IS DISTINCT FROM old.data_reuniao THEN t:='reuniao_remarcada';
 ELSIF new.confirmada_em IS NOT NULL AND old.confirmada_em IS NULL THEN t:='reuniao_confirmada';END IF;
 IF t IS NOT NULL THEN PERFORM public.gestao_evento(t,new.contato_id,new.oportunidade_id,new.id);END IF;
 ELSIF tg_table_name='mensagens_whatsapp' THEN
 IF tg_op='INSERT' AND new.estado_envio='falhou' THEN t:='envio_falhou';ELSIF tg_op='INSERT' AND new.autor='cliente' THEN t:='mensagem_recebida';ELSIF tg_op='UPDATE' AND new.estado_envio='falhou' AND old.estado_envio IS DISTINCT FROM 'falhou' THEN t:='envio_falhou';END IF;
 IF t IS NOT NULL THEN PERFORM public.gestao_evento(t,new.contato_id);END IF;
 END IF;RETURN new;
END $$;
CREATE TRIGGER gestao_evento AFTER INSERT OR UPDATE ON public.oportunidades FOR EACH ROW EXECUTE FUNCTION public.gestao_gatilho();
CREATE TRIGGER gestao_evento AFTER INSERT OR UPDATE ON public.reunioes FOR EACH ROW EXECUTE FUNCTION public.gestao_gatilho();
CREATE TRIGGER gestao_evento AFTER INSERT ON public.contato_etiquetas FOR EACH ROW EXECUTE FUNCTION public.gestao_gatilho();
DO $$ BEGIN IF to_regclass('public.mensagens_whatsapp') IS NOT NULL THEN CREATE TRIGGER gestao_evento AFTER INSERT OR UPDATE ON public.mensagens_whatsapp FOR EACH ROW EXECUTE FUNCTION public.gestao_gatilho();END IF;END $$;
CREATE FUNCTION public.gestao_agendar() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE x record;BEGIN
 FOR x IN SELECT r.id regra,r.quando,o.id,o.contato_id,CASE WHEN r.quando='dias_sem_resposta' THEN coalesce(c.ultima_mensagem,o.updated_at) ELSE coalesce((SELECT max(e.created_at) FROM public.oportunidade_eventos e WHERE e.oportunidade_id=o.id),o.created_at) END referencia
 FROM public.gestao_regras r JOIN public.oportunidades o ON o.fechado_em IS NULL JOIN public.etapas_funil f ON f.chave=o.status AND f.tipo='aberta' JOIN public.contatos_dados c ON c.id=o.contato_id
 WHERE r.ativa AND r.quando IN ('dias_na_etapa','dias_sem_resposta','data') AND ((r.quando='data' AND o.fechamento_previsto=(now() AT TIME ZONE 'UTC')::date) OR (r.quando<>'data' AND CASE WHEN r.quando='dias_sem_resposta' THEN coalesce(c.ultima_mensagem,o.updated_at) ELSE coalesce((SELECT max(e.created_at) FROM public.oportunidade_eventos e WHERE e.oportunidade_id=o.id),o.created_at) END <=now()-make_interval(hours=>r.horas))) LIMIT 1000 LOOP
 PERFORM public.gestao_evento(x.quando,x.contato_id,x.id,NULL,x.regra::text||':'||x.id::text||':'||CASE WHEN x.quando='data' THEN ((now() AT TIME ZONE 'UTC')::date)::text ELSE extract(epoch FROM x.referencia)::text END,x.regra);
 END LOOP;
END $$;
CREATE FUNCTION public.gestao_processar(p_limite integer DEFAULT 50) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE e public.gestao_eventos;r public.gestao_regras;a jsonb;o public.oportunidades;i uuid;alvo uuid;n integer:=0;BEGIN
 PERFORM public.gestao_agendar();
 FOR e IN SELECT * FROM public.gestao_eventos WHERE estado='pendente' ORDER BY criado_em,id LIMIT least(greatest(p_limite,1),100) FOR UPDATE SKIP LOCKED LOOP
 PERFORM set_config('crm.gestao_raiz',e.raiz::text,true);PERFORM set_config('crm.gestao_nivel',(e.profundidade+1)::text,true);
 FOR r IN SELECT * FROM public.gestao_regras WHERE ativa AND quando=e.tipo AND (e.regra_alvo IS NULL OR id=e.regra_alvo) ORDER BY id LOOP
 alvo:=e.oportunidade_id;SELECT * INTO o FROM public.oportunidades WHERE id=alvo;
 IF (r.condicoes?'etapa' AND o.status IS DISTINCT FROM r.condicoes->>'etapa') OR (r.condicoes?'responsavel' AND o.responsavel_id::text IS DISTINCT FROM r.condicoes->>'responsavel') OR (r.condicoes?'etiqueta' AND NOT EXISTS(SELECT 1 FROM public.contato_etiquetas WHERE contato_id=e.contato_id AND etiqueta_id::text=r.condicoes->>'etiqueta')) THEN CONTINUE;END IF;
 IF EXISTS(SELECT 1 FROM public.gestao_execucoes WHERE regra_id=r.id AND raiz=e.raiz) THEN CONTINUE;END IF;
 BEGIN
 INSERT INTO public.gestao_execucoes(regra_id,evento_id,raiz,estado) VALUES(r.id,e.id,e.raiz,'executada') RETURNING id INTO i;
 FOR a IN SELECT * FROM jsonb_array_elements(r.acoes) LOOP
 IF a->>'tipo' IN ('responsavel','mover_negocio','followup') AND alvo IS NULL THEN RAISE EXCEPTION 'Este evento não aponta um negócio. Crie um negócio antes desta ação.' USING errcode='22023';END IF;
 CASE a->>'tipo'
 WHEN 'etiqueta' THEN IF NOT EXISTS(SELECT 1 FROM public.contato_etiquetas WHERE contato_id=e.contato_id AND etiqueta_id=(a->>'id')::uuid) THEN INSERT INTO public.contato_etiquetas(contato_id,etiqueta_id) VALUES(e.contato_id,(a->>'id')::uuid);END IF;
 WHEN 'responsavel' THEN UPDATE public.oportunidades SET responsavel_id=(a->>'id')::uuid WHERE id=alvo;
 WHEN 'mover_negocio' THEN UPDATE public.oportunidades SET status=a->>'etapa' WHERE id=alvo AND fechado_em IS NULL AND status<>'perdido' AND status IS DISTINCT FROM a->>'etapa';
 WHEN 'criar_negocio' THEN INSERT INTO public.oportunidades(contato_id,nome) VALUES(e.contato_id,a->>'titulo') RETURNING id INTO alvo;SELECT * INTO o FROM public.oportunidades WHERE id=alvo;
 WHEN 'tarefa' THEN INSERT INTO public.tarefas(titulo,vence_em,contato_id,oportunidade_id,responsavel_id,origem) VALUES(a->>'titulo',now()+make_interval(hours=>r.horas),e.contato_id,alvo,o.responsavel_id,'sistema');
 WHEN 'followup' THEN EXECUTE 'INSERT INTO public.automacao_envios(regra_id,contato_id,oportunidade_id,referencia_em,vence_em,expira_em) SELECT a.id,o.contato_id,o.id,v.em,v.em+make_interval(mins=>a.minutos),v.em+make_interval(mins=>a.minutos)+interval ''24 hours'' FROM public.automacao_regras a JOIN public.oportunidades o ON o.id=$1 CROSS JOIN LATERAL(SELECT coalesce(max(ev.created_at),o.created_at) em FROM public.oportunidade_eventos ev WHERE ev.oportunidade_id=o.id) v WHERE a.id=$2 AND a.ativa AND a.tipo=''followup'' AND a.etapa=o.status ON CONFLICT DO NOTHING' USING alvo,(a->>'regra')::uuid;
 ELSE INSERT INTO public.gestao_saidas(execucao_id,contato_id,acao) VALUES(i,e.contato_id,a);
 END CASE;
 END LOOP;
 EXCEPTION WHEN unique_violation THEN NULL;WHEN OTHERS THEN INSERT INTO public.gestao_execucoes(regra_id,evento_id,raiz,estado,erro) VALUES(r.id,e.id,e.raiz,'falhou',SQLSTATE) ON CONFLICT DO NOTHING;PERFORM public.aviso_abrir('regra_falhou',r.id::text,'atencao','Uma regra de gestão falhou','Confira a condição e as ações da regra.','/regras',e.contato_id,true);
 END;
 END LOOP;
 UPDATE public.gestao_eventos SET estado='processado' WHERE id=e.id;n:=n+1;
 END LOOP;
 PERFORM set_config('crm.gestao_raiz','',true);PERFORM set_config('crm.gestao_nivel','',true);RETURN n;
END $$;
CREATE FUNCTION public.gestao_saida_elegivel(p_id uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE s public.gestao_saidas;ok boolean;BEGIN
 SELECT b.* INTO s FROM public.gestao_saidas b JOIN public.gestao_execucoes e ON e.id=b.execucao_id JOIN public.gestao_regras r ON r.id=e.regra_id AND r.ativa JOIN public.contatos_dados c ON c.id=b.contato_id WHERE b.id=p_id;
 IF s.id IS NULL OR EXISTS(SELECT 1 FROM crm_base_private.privacidade_bloqueios WHERE contato_id=s.contato_id) THEN RETURN false;END IF;
 IF s.acao->>'tipo'='webhook' THEN RETURN true;END IF;
 IF to_regclass('public.automacao_permissoes') IS NULL THEN RETURN false;END IF;
 EXECUTE 'SELECT EXISTS(SELECT 1 FROM public.automacao_permissoes p JOIN public.contatos_dados c ON c.id=p.contato_id WHERE p.contato_id=$1 AND p.autorizado AND c.whatsapp ~ ''^[0-9]{6,16}$'' AND c.assumido_por IS NULL AND EXISTS(SELECT 1 FROM public.conversas_config WHERE provedor=''uazapi''))' INTO ok USING s.contato_id;RETURN ok;
END $$;
CREATE FUNCTION public.gestao_saidas_reivindicar() RETURNS SETOF public.gestao_saidas LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ BEGIN
 UPDATE public.gestao_saidas SET estado='incerto',erro='Chamada sem confirmação.' WHERE estado='chamando' AND reservado_em<now()-interval '5 minutes';
 IF to_regclass('public.mensagens_whatsapp') IS NOT NULL THEN EXECUTE 'UPDATE public.mensagens_whatsapp m SET estado_envio=''incerto'' FROM public.gestao_saidas s WHERE s.mensagem_id=m.id AND s.estado=''incerto'' AND m.estado_envio=''pendente''';END IF;
 UPDATE public.gestao_saidas SET estado='cancelado' WHERE estado='pendente' AND criado_em<=now()-interval '24 hours';
 UPDATE public.gestao_saidas SET estado='pendente',token=NULL WHERE estado='reservado' AND reservado_em<now()-interval '5 minutes';
 UPDATE public.gestao_saidas SET estado='cancelado' WHERE estado IN ('pendente','reservado') AND NOT public.gestao_saida_elegivel(id);
 RETURN QUERY WITH lote AS(SELECT id FROM public.gestao_saidas WHERE estado='pendente' AND criado_em>now()-interval '24 hours' ORDER BY criado_em,id LIMIT 10 FOR UPDATE SKIP LOCKED) UPDATE public.gestao_saidas s SET estado='reservado',token=gen_random_uuid(),reservado_em=now() FROM lote WHERE s.id=lote.id RETURNING s.*;
END $$;
CREATE FUNCTION public.gestao_saida_iniciar(p_id uuid,p_token uuid,p_texto text DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE s public.gestao_saidas;m uuid;BEGIN
 SELECT * INTO s FROM public.gestao_saidas WHERE id=p_id AND token=p_token AND estado='reservado' FOR UPDATE;
 IF s.id IS NULL OR s.reservado_em<now()-interval '5 minutes' OR NOT public.gestao_saida_elegivel(s.id) THEN RETURN false;END IF;
 IF s.acao->>'tipo'<>'webhook' THEN
 IF p_texto IS NULL OR length(btrim(p_texto)) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'Mensagem inválida.' USING errcode='22023';END IF;
 EXECUTE 'INSERT INTO public.mensagens_whatsapp(contato_id,autor,tipo,conteudo,provedor,estado_envio,origem_envio,pedido_id,lida) VALUES($1,''agente'',''texto'',$2,''uazapi'',''pendente'',''agente'',$3,true) RETURNING id' INTO m USING s.contato_id,p_texto,s.id;
 END IF;
 UPDATE public.gestao_saidas SET estado='chamando',mensagem_id=m WHERE id=s.id;RETURN true;
END $$;
CREATE FUNCTION public.gestao_saida_finalizar(p_id uuid,p_token uuid,p_estado text,p_externo text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE s public.gestao_saidas;BEGIN
 IF p_estado NOT IN ('enviado','falhou','incerto','cancelado') THEN RAISE EXCEPTION 'Estado inválido.';END IF;
 UPDATE public.gestao_saidas SET estado=p_estado WHERE id=p_id AND token=p_token AND estado IN ('reservado','chamando') AND (p_estado<>'enviado' OR estado='chamando') AND (p_estado<>'falhou' OR estado='reservado') RETURNING * INTO s;
 IF s.id IS NULL THEN RETURN;END IF;
 IF s.mensagem_id IS NOT NULL THEN EXECUTE 'UPDATE public.mensagens_whatsapp SET estado_envio=$1,id_externo=$2 WHERE id=$3' USING CASE WHEN p_estado='enviado' THEN 'enviado' ELSE 'incerto' END,p_externo,s.mensagem_id;END IF;
 IF p_estado IN ('falhou','incerto') THEN PERFORM public.aviso_abrir('regra_saida',s.id::text,'atencao','Uma ação automática precisa de revisão','Confira o histórico; uma chamada incerta não será repetida.','/regras',s.contato_id,true);END IF;
END $$;
DO $$ DECLARE f record;BEGIN FOR f IN SELECT oid::regprocedure assinatura,proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'gestao_%' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.assinatura);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.assinatura);IF f.proname='gestao_regra_salvar' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.assinatura);END IF;END LOOP;END $$;
INSERT INTO crm_base_private.schema_migrations(version) VALUES('0038_regras_de_gestao');
NOTIFY pgrst,'reload schema';
COMMIT;
