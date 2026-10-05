BEGIN;
CREATE TABLE crm_base_private.privacidade_bloqueios(contato_id uuid PRIMARY KEY REFERENCES public.contatos_dados(id) ON DELETE CASCADE,criado_em timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.resultados_anonimos(mes date PRIMARY KEY,ganhos integer NOT NULL DEFAULT 0,perdas integer NOT NULL DEFAULT 0,total numeric NOT NULL DEFAULT 0);
ALTER TABLE public.resultados_anonimos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.resultados_anonimos FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.resultados_anonimos TO authenticated;
GRANT ALL ON public.resultados_anonimos TO service_role;
CREATE POLICY gestor_le ON public.resultados_anonimos FOR SELECT TO authenticated USING(public.usuario_e_gestor());
CREATE TRIGGER auditoria AFTER INSERT OR UPDATE OR DELETE ON public.resultados_anonimos FOR EACH ROW EXECUTE FUNCTION public.auditar_mudanca();
CREATE FUNCTION public.privacidade_preparar(p_contato uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ DECLARE t text;em_curso boolean;BEGIN
 IF NOT public.usuario_e_gestor() THEN RAISE EXCEPTION 'Só gestor remove dados.' USING errcode='42501';END IF;
 PERFORM 1 FROM public.contatos_dados WHERE id=p_contato FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Contato não encontrado.' USING errcode='P0002';END IF;
 FOREACH t IN ARRAY ARRAY['automacao_envios','campanha_destinatarios','gestao_saidas'] LOOP
 IF to_regclass('public.'||t) IS NOT NULL THEN
 EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE contato_id=$1 AND estado IN (''reservado'',''chamando'',''processando''))',t) INTO em_curso USING p_contato;
 IF em_curso THEN RAISE EXCEPTION 'Há um envio em curso. Aguarde sua conclusão antes de remover os dados.' USING errcode='22023';END IF;
 END IF;END LOOP;
 IF to_regclass('public.mensagens_whatsapp') IS NOT NULL THEN EXECUTE 'SELECT EXISTS(SELECT 1 FROM public.mensagens_whatsapp WHERE contato_id=$1 AND autor<>''cliente'' AND estado_envio=''pendente'')' INTO em_curso USING p_contato;IF em_curso THEN RAISE EXCEPTION 'Há um envio aguardando confirmação. Confira o histórico antes de remover.' USING errcode='22023';END IF;END IF;
 INSERT INTO crm_base_private.privacidade_bloqueios(contato_id) VALUES(p_contato) ON CONFLICT DO NOTHING;
END $$;
CREATE TABLE crm_base_private.privacidade_versoes(tx bigint NOT NULL,versao uuid NOT NULL,PRIMARY KEY(tx,versao));
DO $do$ BEGIN IF to_regclass('public.assistente_melhoria_versoes') IS NOT NULL THEN
 EXECUTE $sql$CREATE OR REPLACE FUNCTION public.assistente_revisao_imutavel() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$ BEGIN
 IF tg_table_name='assistente_melhoria_versoes' AND new.conteudo='' AND (to_jsonb(new)-'conteudo')=(to_jsonb(old)-'conteudo') AND EXISTS(SELECT 1 FROM crm_base_private.privacidade_versoes WHERE tx=txid_current() AND versao=old.id) THEN RETURN new;END IF;
 RAISE EXCEPTION 'Crie uma nova proposta ou restaure uma versão.' USING errcode='42501';END $fn$;$sql$;
 END IF;END $do$;

-- Exporta os descendentes do contato pelas FKs, inclusive módulos opcionais.
-- Não inclui tabelas de configuração, segredos ou outros contatos.
CREATE FUNCTION public.privacidade_exportar(p_contato uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public' AS $$
DECLARE caminho record; linhas jsonb; resultado jsonb:='{}'; BEGIN
 IF NOT public.usuario_e_gestor() THEN RAISE EXCEPTION 'Só gestor exporta dados pessoais.' USING errcode='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.contatos_dados WHERE id=p_contato) THEN RAISE EXCEPTION 'Contato não encontrado.' USING errcode='P0002';END IF;
 FOR caminho IN
 WITH RECURSIVE fks AS (
  SELECT c.conrelid filho,c.confrelid pai,t.relname::text COLLATE "default" tabela,
   (SELECT string_agg(format('xFILHO.%I=xPAI.%I',a.attname,b.attname),' AND ' ORDER BY k.i) FROM generate_subscripts(c.conkey,1) k(i) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[k.i] JOIN pg_attribute b ON b.attrelid=c.confrelid AND b.attnum=c.confkey[k.i]) condicao
  FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE c.contype='f' AND n.nspname='public'
 ), caminhos AS (
  SELECT 'public.contatos_dados'::regclass::oid rel,'contatos_dados'::text tabela,ARRAY['public.contatos_dados'::regclass::oid] visitados,0 nivel,'public.contatos_dados x0'::text fontes
  UNION ALL
  SELECT f.filho,f.tabela,p.visitados||f.filho,p.nivel+1,p.fontes||format(' JOIN public.%I x%s ON ',f.tabela,p.nivel+1)||replace(replace(f.condicao,'xFILHO','x'||(p.nivel+1)),'xPAI','x'||p.nivel) COLLATE "default"
  FROM caminhos p JOIN fks f ON f.pai=p.rel WHERE NOT f.filho=ANY(p.visitados) AND p.nivel<12
 ) SELECT * FROM caminhos
 LOOP
  EXECUTE format('SELECT coalesce(jsonb_agg(DISTINCT to_jsonb(x%s)),''[]'') FROM %s WHERE x0.id=$1',caminho.nivel,caminho.fontes) INTO linhas USING p_contato;
  SELECT coalesce(jsonb_agg(DISTINCT v),'[]') INTO linhas FROM jsonb_array_elements(coalesce(resultado->caminho.tabela,'[]')||linhas) v;
  resultado:=jsonb_set(resultado,ARRAY[caminho.tabela],linhas);
 END LOOP;
 INSERT INTO public.auditoria(tabela,registro_id,operacao,usuario_id,campos) VALUES('contatos_dados',p_contato::text,'EXPORT',auth.uid(),'{}');
 RETURN jsonb_build_object('formato',1,'exportado_em',now(),'dados',resultado,'arquivos','Caminhos de mídia constam nas mensagens; os arquivos binários são obtidos separadamente pelo Storage.');
END $$;
-- Uma remoção em cascata elimina identidade, textos, campos, mensagens,
-- propostas e histórico financeiro individual. Não representa decisão legal
-- de retenção: o gestor deve conferir o escopo antes de confirmar.
CREATE FUNCTION public.privacidade_remover(p_contato uuid,p_confirmacao text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ BEGIN
 IF NOT public.usuario_e_gestor() THEN RAISE EXCEPTION 'Só gestor remove dados pessoais.' USING errcode='42501';END IF;
 IF p_confirmacao IS DISTINCT FROM 'REMOVER DADOS' THEN RAISE EXCEPTION 'Confirmação necessária.' USING errcode='22023';END IF;
 PERFORM public.privacidade_preparar(p_contato);
 PERFORM 1 FROM public.contatos_dados WHERE id=p_contato FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Contato não encontrado.' USING errcode='P0002';END IF;
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='midias-whatsapp' AND name LIKE p_contato::text||'/%') THEN RAISE EXCEPTION 'Remova os arquivos pelo servidor antes de apagar a ficha.' USING errcode='22023';END IF;
 -- Versões de melhorias aprovadas podem carregar evidências pessoais e
 -- sobrevivem à FK SET NULL: esvazie-as antes de eliminar sua origem.
 IF to_regclass('public.assistente_melhoria_versoes') IS NOT NULL THEN
  EXECUTE 'WITH RECURSIVE v AS(SELECT id FROM public.assistente_melhoria_versoes WHERE origem_id IN(SELECT id FROM public.assistente_melhorias WHERE contato_id=$1) UNION SELECT b.id FROM public.assistente_melhoria_versoes b JOIN v ON b.anterior_id=v.id) INSERT INTO crm_base_private.privacidade_versoes SELECT txid_current(),id FROM v ON CONFLICT DO NOTHING' USING p_contato;
  EXECUTE 'UPDATE public.assistente_melhoria_versoes SET conteudo='''' WHERE id IN(SELECT versao FROM crm_base_private.privacidade_versoes WHERE tx=txid_current())';
  DELETE FROM crm_base_private.privacidade_versoes WHERE tx=txid_current();
 END IF;
 DELETE FROM public.contatos_dados WHERE id=p_contato;
 INSERT INTO public.auditoria(tabela,registro_id,operacao,usuario_id,campos) VALUES('contatos_dados',p_contato::text,'REMOVE',auth.uid(),'{}');
END $$;
CREATE FUNCTION public.privacidade_anonimizar(p_contato uuid,p_confirmacao text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ BEGIN
 IF NOT public.usuario_e_gestor() THEN RAISE EXCEPTION 'Só gestor anonimiza dados.' USING errcode='42501';END IF;
 IF p_confirmacao IS DISTINCT FROM 'ANONIMIZAR DADOS' THEN RAISE EXCEPTION 'Confirmação necessária.' USING errcode='22023';END IF;
 PERFORM public.privacidade_preparar(p_contato);
 INSERT INTO public.resultados_anonimos(mes,ganhos,perdas,total)
 SELECT date_trunc('month',coalesce(o.fechado_em,(SELECT max(e.created_at) FROM public.oportunidade_eventos e WHERE e.oportunidade_id=o.id AND e.status_novo='perdido'),o.created_at))::date,count(*) FILTER(WHERE o.status='ganho'),count(*) FILTER(WHERE o.status='perdido'),coalesce(sum(o.valor_proposta) FILTER(WHERE o.status='ganho'),0)
 FROM public.oportunidades o WHERE o.contato_id=p_contato AND o.status IN ('ganho','perdido') AND o.cancelado_em IS NULL GROUP BY 1
 ON CONFLICT(mes) DO UPDATE SET ganhos=resultados_anonimos.ganhos+excluded.ganhos,perdas=resultados_anonimos.perdas+excluded.perdas,total=resultados_anonimos.total+excluded.total;
 PERFORM public.privacidade_remover(p_contato,'REMOVER DADOS');
END $$;
REVOKE ALL ON FUNCTION public.privacidade_preparar(uuid),public.privacidade_anonimizar(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.privacidade_preparar(uuid),public.privacidade_anonimizar(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.privacidade_exportar(uuid),public.privacidade_remover(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.privacidade_exportar(uuid),public.privacidade_remover(uuid,text) TO authenticated;
INSERT INTO crm_base_private.schema_migrations(version) VALUES('0035_privacidade');
NOTIFY pgrst,'reload schema';
COMMIT;
