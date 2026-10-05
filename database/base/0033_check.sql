DO $$ DECLARE g uuid:=gen_random_uuid();u uuid:=gen_random_uuid();c uuid;o uuid;r jsonb; BEGIN
 INSERT INTO auth.users(id) VALUES(g),(u);UPDATE public.usuarios SET papel='gestor' WHERE id=g;UPDATE public.usuarios SET papel='consultor' WHERE id=u;
 INSERT INTO public.contatos_dados(nome) VALUES('Ensaio gestão') RETURNING id INTO c;SELECT id INTO o FROM public.oportunidades WHERE contato_id=c;
 UPDATE public.etapas_funil SET probabilidade=50 WHERE chave='proposta';
 UPDATE public.oportunidades SET status='proposta',valor_proposta=1000,fechamento_previsto=current_date,responsavel_id=g WHERE id=o;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);SET LOCAL ROLE authenticated;
 BEGIN PERFORM public.relatorio_gestao(now()-interval '1 day',now()+interval '2 days');RAISE EXCEPTION 'FAIL: consultor lê gestão';EXCEPTION WHEN insufficient_privilege THEN NULL;END;RESET ROLE;
 PERFORM set_config('request.jwt.claim.sub',g::text,true);SET LOCAL ROLE authenticated;r:=public.relatorio_gestao(now()-interval '1 day',now()+interval '2 days');RESET ROLE;
 IF (r->'previsao'->>'ponderado')::numeric<>500 THEN RAISE EXCEPTION 'FAIL: previsão %',r;END IF;
 UPDATE public.oportunidades SET status='perdido',motivo_perda='sem_orcamento' WHERE id=o;
 IF NOT EXISTS(SELECT 1 FROM public.oportunidades WHERE id=o AND etapa_perda='proposta') THEN RAISE EXCEPTION 'FAIL: etapa da perda';END IF;
 SET LOCAL ROLE authenticated;r:=public.relatorio_gestao(now()-interval '1 day',now()+interval '2 days');RESET ROLE;
 IF r->'perdas'->0->>'motivo'<>'Sem orçamento' OR (r->'previsao'->>'quantidade')::integer<>0 THEN RAISE EXCEPTION 'FAIL: perdas/previsão';END IF;
 IF to_regclass('public.mensagens_whatsapp') IS NOT NULL THEN
  EXECUTE 'INSERT INTO public.mensagens_whatsapp(contato_id,autor,conteudo,criada_em) VALUES($1,''cliente'',''Olá'',now()-interval ''10 minutes'')' USING c;
  EXECUTE 'INSERT INTO public.mensagens_whatsapp(contato_id,autor,conteudo,criada_em,enviada_por,estado_envio) VALUES($1,''atendente'',''Resposta'',now()-interval ''5 minutes'',$2,''entregue'')' USING c,g;
  SET LOCAL ROLE authenticated;r:=public.relatorio_gestao(now()-interval '1 day',now()+interval '2 days');RESET ROLE;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'conversas') x WHERE x->>'id'=g::text AND (x->>'conversas')::integer=1 AND (x->>'primeira_resposta_minutos')::numeric=5) THEN RAISE EXCEPTION 'FAIL: confirmação e primeira resposta %',r;END IF;
 END IF;
END $$;
