BEGIN;
CREATE TABLE public.proposta_modelos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),nome text NOT NULL CHECK(length(btrim(nome)) BETWEEN 1 AND 80),texto text NOT NULL CHECK(length(texto)<=10000),ativo boolean NOT NULL DEFAULT true);
CREATE TABLE public.propostas(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),contato_id uuid NOT NULL REFERENCES public.contatos_dados(id) ON DELETE CASCADE,
 oportunidade_id uuid NOT NULL,FOREIGN KEY(oportunidade_id,contato_id) REFERENCES public.oportunidades(id,contato_id) ON DELETE CASCADE,
 modelo_id uuid REFERENCES public.proposta_modelos(id),titulo text NOT NULL CHECK(length(btrim(titulo)) BETWEEN 1 AND 160),texto text NOT NULL CHECK(length(texto)<=10000),
 itens jsonb NOT NULL,subtotais jsonb NOT NULL DEFAULT '[]',total numeric(14,2) NOT NULL CHECK(total>=0),validade date NOT NULL,
 estado text NOT NULL DEFAULT 'rascunho' CHECK(estado IN ('rascunho','emitida','aceita','recusada','cancelada')),
 numero text UNIQUE,snapshot jsonb,versao integer NOT NULL DEFAULT 1,criada_em timestamptz NOT NULL DEFAULT now(),emitida_em timestamptz,criada_por uuid NOT NULL REFERENCES public.usuarios(id));
CREATE TABLE crm_base_private.proposta_numeracao(ano integer PRIMARY KEY,ultimo bigint NOT NULL);
CREATE FUNCTION public.proposta_total(p_itens jsonb) RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$ DECLARE i jsonb;t numeric:=0;q numeric;v numeric; BEGIN
 IF jsonb_typeof(p_itens) IS DISTINCT FROM 'array' OR jsonb_array_length(p_itens) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Informe de 1 a 100 itens.' USING errcode='22023';END IF;
 FOR i IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
  IF jsonb_typeof(i) IS DISTINCT FROM 'object' OR jsonb_typeof(i->'descricao') IS DISTINCT FROM 'string' OR length(btrim(i->>'descricao')) NOT BETWEEN 1 AND 500
  OR jsonb_typeof(i->'quantidade') IS DISTINCT FROM 'number' OR jsonb_typeof(i->'preco') IS DISTINCT FROM 'number' OR EXISTS(SELECT 1 FROM jsonb_object_keys(i) k WHERE k NOT IN ('descricao','quantidade','preco')) THEN RAISE EXCEPTION 'Item inválido.' USING errcode='22023';END IF;
  q:=(i->>'quantidade')::numeric;v:=(i->>'preco')::numeric;
  IF q<=0 OR q>1000000 OR q<>round(q,3) OR v<0 OR v>999999999 OR v<>round(v,2) THEN RAISE EXCEPTION 'Quantidade ou preço inválido.' USING errcode='22023';END IF;
  t:=t+round(q*v,2);
 END LOOP;
 IF t>999999999999.99 THEN RAISE EXCEPTION 'Total excede o limite.' USING errcode='22023';END IF;RETURN t;
END $$;
CREATE FUNCTION public.proposta_validar() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$ BEGIN
 IF tg_op='UPDATE' AND old.estado<>'rascunho' THEN
  IF (to_jsonb(new)-'estado'-'versao') IS DISTINCT FROM (to_jsonb(old)-'estado'-'versao') THEN RAISE EXCEPTION 'Proposta emitida preserva seu conteúdo.' USING errcode='22023';END IF;
  IF old.estado<>'emitida' OR new.estado NOT IN ('aceita','recusada','cancelada') THEN RAISE EXCEPTION 'Transição inválida.' USING errcode='22023';END IF;
 END IF;
 IF tg_op='INSERT' OR old.estado='rascunho' THEN new.total:=public.proposta_total(new.itens);SELECT jsonb_agg(round((i->>'quantidade')::numeric*(i->>'preco')::numeric,2) ORDER BY n) INTO new.subtotais FROM jsonb_array_elements(new.itens) WITH ORDINALITY a(i,n);END IF;
 IF tg_op='UPDATE' THEN new.versao:=old.versao+1;END IF;RETURN new;
END $$;
CREATE TRIGGER proposta_validar BEFORE INSERT OR UPDATE ON public.propostas FOR EACH ROW EXECUTE FUNCTION public.proposta_validar();
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['proposta_modelos','propostas'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
 EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 EXECUTE format('CREATE POLICY equipe_le ON public.%I FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.usuarios WHERE id=auth.uid() AND ativo))',t);
 EXECUTE format('CREATE TRIGGER auditoria AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.auditar_mudanca()',t);
END LOOP;END $$;
CREATE FUNCTION public.proposta_modelo_salvar(p_id uuid,p_nome text,p_texto text,p_ativo boolean) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE i uuid:=coalesce(p_id,gen_random_uuid());BEGIN
 IF NOT public.usuario_e_gestor() THEN RAISE EXCEPTION 'Só gestor configura modelos.' USING errcode='42501';END IF;
 INSERT INTO public.proposta_modelos VALUES(i,btrim(p_nome),p_texto,p_ativo) ON CONFLICT(id) DO UPDATE SET nome=excluded.nome,texto=excluded.texto,ativo=excluded.ativo;RETURN i;
END $$;
CREATE FUNCTION public.proposta_salvar(p_id uuid,p_oportunidade uuid,p_titulo text,p_texto text,p_itens jsonb,p_validade date,p_modelo uuid,p_versao integer DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE i uuid:=coalesce(p_id,gen_random_uuid());o public.oportunidades;BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.usuarios WHERE id=auth.uid() AND ativo) THEN RAISE EXCEPTION 'Sem acesso.' USING errcode='42501';END IF;
 SELECT * INTO o FROM public.oportunidades WHERE id=p_oportunidade FOR SHARE;
 IF o.id IS NULL OR o.fechado_em IS NOT NULL OR o.status='perdido' THEN RAISE EXCEPTION 'Escolha uma negociação aberta.' USING errcode='22023';END IF;
 IF p_validade IS NULL OR p_validade<(now() AT TIME ZONE 'UTC')::date THEN RAISE EXCEPTION 'Confira a validade.' USING errcode='22023';END IF;
 IF p_modelo IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.proposta_modelos WHERE id=p_modelo AND ativo) THEN RAISE EXCEPTION 'Modelo indisponível.' USING errcode='22023';END IF;
 IF p_id IS NULL THEN INSERT INTO public.propostas(id,contato_id,oportunidade_id,modelo_id,titulo,texto,itens,total,validade,criada_por) VALUES(i,o.contato_id,o.id,p_modelo,btrim(p_titulo),p_texto,p_itens,0,p_validade,auth.uid());
 ELSE UPDATE public.propostas SET titulo=btrim(p_titulo),texto=p_texto,itens=p_itens,validade=p_validade,modelo_id=p_modelo WHERE id=i AND oportunidade_id=o.id AND estado='rascunho' AND versao=p_versao;
 IF NOT FOUND THEN RAISE EXCEPTION 'A proposta mudou. Atualize.' USING errcode='22023';END IF;END IF;RETURN i;
END $$;
CREATE FUNCTION public.proposta_emitir(p_id uuid,p_versao integer) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE p public.propostas;n bigint;a integer:=extract(year FROM (now() AT TIME ZONE 'UTC')::date);s jsonb;BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.usuarios WHERE id=auth.uid() AND ativo) THEN RAISE EXCEPTION 'Sem acesso.' USING errcode='42501';END IF;
 SELECT * INTO p FROM public.propostas WHERE id=p_id FOR UPDATE;
 IF p.id IS NULL OR p.versao IS DISTINCT FROM p_versao OR p.estado<>'rascunho' OR p.validade<(now() AT TIME ZONE 'UTC')::date THEN RAISE EXCEPTION 'Proposta indisponível. Atualize.' USING errcode='22023';END IF;
 PERFORM 1 FROM public.oportunidades WHERE id=p.oportunidade_id AND fechado_em IS NULL AND status<>'perdido' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'A negociação foi encerrada.' USING errcode='22023';END IF;
 INSERT INTO crm_base_private.proposta_numeracao VALUES(a,1) ON CONFLICT(ano) DO UPDATE SET ultimo=proposta_numeracao.ultimo+1 RETURNING ultimo INTO n;
 SELECT jsonb_build_object('cliente',jsonb_build_object('nome',c.nome,'empresa',c.empresa,'email',c.email),'empresa',(SELECT to_jsonb(e) FROM public.configuracoes_negocio e LIMIT 1)) INTO s FROM public.contatos_dados c WHERE c.id=p.contato_id;
 UPDATE public.propostas SET estado='emitida',numero=a::text||'-'||lpad(n::text,greatest(6,length(n::text)),'0'),snapshot=s,emitida_em=now() WHERE id=p.id RETURNING numero INTO p.numero;RETURN p.numero;
END $$;
CREATE FUNCTION public.proposta_resultado(p_id uuid,p_estado text,p_versao integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.usuarios WHERE id=auth.uid() AND ativo) THEN RAISE EXCEPTION 'Sem acesso.' USING errcode='42501';END IF;
 IF p_estado NOT IN ('aceita','recusada','cancelada') THEN RAISE EXCEPTION 'Resultado inválido.' USING errcode='22023';END IF;
 UPDATE public.propostas SET estado=p_estado WHERE id=p_id AND estado='emitida' AND versao=p_versao AND (p_estado<>'aceita' OR validade>=(now() AT TIME ZONE 'UTC')::date);
 IF NOT FOUND THEN RAISE EXCEPTION 'Proposta mudou ou venceu. Atualize.' USING errcode='22023';END IF;
 PERFORM public.aviso_resolver_auto('proposta_vencida',p_id::text);
END $$;
CREATE FUNCTION public.propostas_vigiar() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE p public.propostas;n integer:=0;BEGIN
 FOR p IN SELECT * FROM public.propostas WHERE estado='emitida' AND validade<(now() AT TIME ZONE 'UTC')::date LOOP
 PERFORM public.aviso_abrir('proposta_vencida',p.id::text,'atencao','Uma proposta venceu','Confira a proposta e registre o resultado.','/propostas',p.contato_id,false);n:=n+1;END LOOP;RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.proposta_total(jsonb),public.proposta_modelo_salvar(uuid,text,text,boolean),public.proposta_salvar(uuid,uuid,text,text,jsonb,date,uuid,integer),public.proposta_emitir(uuid,integer),public.proposta_resultado(uuid,text,integer),public.propostas_vigiar() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.proposta_modelo_salvar(uuid,text,text,boolean),public.proposta_salvar(uuid,uuid,text,text,jsonb,date,uuid,integer),public.proposta_emitir(uuid,integer),public.proposta_resultado(uuid,text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.propostas_vigiar() TO service_role;
INSERT INTO crm_base_private.schema_migrations(version) VALUES('0036_modulo_propostas');
NOTIFY pgrst,'reload schema';
COMMIT;
