DO $$ DECLARE g uuid:=gen_random_uuid();r jsonb;c uuid;o uuid;v uuid;v2 uuid;m uuid;regra uuid;execucao uuid;saida uuid;tok uuid;BEGIN
 INSERT INTO auth.users(id) VALUES(g);UPDATE public.usuarios SET papel='gestor' WHERE id=g;
 PERFORM set_config('request.jwt.claim.sub',g::text,true);PERFORM set_config('request.jwt.claim.role','authenticated',true);SET LOCAL ROLE authenticated;r:=public.diagnostico_base();RESET ROLE;
 IF r->'tabelas_sem_rls'<>'[]' OR r->'tabelas_sem_auditoria'<>'[]' OR r->'tabelas_sem_mfa'<>'[]' OR NOT (r->>'seguranca_api')::boolean THEN RAISE EXCEPTION 'FAIL: cobertura %',r;END IF;
 INSERT INTO public.contatos_dados(nome,email) VALUES('Pessoa a anonimizar','pessoal@example.invalid') RETURNING id INTO c;
 SELECT id INTO o FROM public.oportunidades WHERE contato_id=c;
 UPDATE public.oportunidades SET status='perdido',motivo_perda='sem_orcamento' WHERE id=o;
 IF to_regclass('public.assistente_melhoria_versoes') IS NOT NULL THEN
  EXECUTE 'INSERT INTO public.assistente_melhorias(titulo,contato_id,evidencia,conteudo,criada_por) VALUES(''Ensaio'',$1,''pessoal@example.invalid'',''pessoal@example.invalid'',$2) RETURNING id' INTO m USING c,g;
  EXECUTE 'INSERT INTO public.assistente_melhoria_versoes(conteudo,origem_id,criada_por) VALUES(''pessoal@example.invalid'',$1,$2) RETURNING id' INTO v USING m,g;
  EXECUTE 'INSERT INTO public.assistente_melhoria_versoes(conteudo,anterior_id,criada_por) VALUES(''pessoal@example.invalid'',$1,$2) RETURNING id' INTO v2 USING v,g;
 END IF;
 SET LOCAL ROLE authenticated;
 BEGIN DELETE FROM public.contatos_dados WHERE id=c;RAISE EXCEPTION 'FAIL: remoção direta';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM public.privacidade_preparar(c);RESET ROLE;
 BEGIN INSERT INTO public.tarefas(titulo,vence_em,contato_id) VALUES('Reativar',now(),c);RAISE EXCEPTION 'FAIL: vínculo após bloqueio';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 SET LOCAL ROLE authenticated;PERFORM public.privacidade_anonimizar(c,'ANONIMIZAR DADOS');RESET ROLE;
 IF EXISTS(SELECT 1 FROM public.contatos_dados WHERE id=c) OR NOT EXISTS(SELECT 1 FROM public.resultados_anonimos WHERE perdas=1) THEN RAISE EXCEPTION 'FAIL: anonimização e agregação';END IF;
 IF v IS NOT NULL THEN EXECUTE 'SELECT jsonb_agg(conteudo) FROM public.assistente_melhoria_versoes WHERE id IN($1,$2)' INTO r USING v,v2;IF r::text LIKE '%pessoal@example.invalid%' THEN RAISE EXCEPTION 'FAIL: evidências sobreviveram';END IF;END IF;
 -- Reserva e início repetidos não podem disparar novamente um webhook.
 INSERT INTO public.contatos_dados(nome) VALUES('Fila externa') RETURNING id INTO c;
 SET LOCAL ROLE authenticated;regra:=public.gestao_regra_salvar(NULL,'Avisar ERP',true,'negocio_criado',24,'{}','[{"tipo":"webhook","destino":"erp"}]',NULL);RESET ROLE;
 PERFORM public.gestao_processar();
 SELECT s.id,s.token INTO saida,tok FROM public.gestao_saidas_reivindicar() s WHERE s.contato_id=c;
 IF saida IS NULL THEN RAISE EXCEPTION 'FAIL: saída não reservada';END IF;
 SET LOCAL ROLE authenticated;
 BEGIN PERFORM public.privacidade_preparar(c);RAISE EXCEPTION 'FAIL: remoção durante reserva';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;RESET ROLE;
 IF NOT public.gestao_saida_iniciar(saida,tok) OR public.gestao_saida_iniciar(saida,tok) THEN RAISE EXCEPTION 'FAIL: início duplicado';END IF;
 UPDATE public.gestao_saidas SET reservado_em=now()-interval '6 minutes' WHERE id=saida;
 PERFORM public.gestao_saidas_reivindicar();
 IF NOT EXISTS(SELECT 1 FROM public.gestao_saidas WHERE id=saida AND estado='incerto') THEN RAISE EXCEPTION 'FAIL: chamada vencida não ficou incerta';END IF;
 SET LOCAL ROLE authenticated;PERFORM public.privacidade_remover(c,'REMOVER DADOS');RESET ROLE;
 -- Timers de regras diferentes não cruzam limiares nem duplicam ações.
 SET LOCAL ROLE authenticated;
 PERFORM public.gestao_regra_salvar(NULL,'Silêncio 24h',true,'dias_sem_resposta',24,'{}','[{"tipo":"tarefa","titulo":"Silêncio de um dia"}]',NULL);
 PERFORM public.gestao_regra_salvar(NULL,'Silêncio 48h',true,'dias_sem_resposta',48,'{}','[{"tipo":"tarefa","titulo":"Silêncio de dois dias"}]',NULL);RESET ROLE;
 INSERT INTO public.contatos_dados(nome,ultima_mensagem) VALUES('Timer',now()-interval '25 hours') RETURNING id INTO c;
 PERFORM public.gestao_processar();PERFORM public.gestao_processar();
 IF (SELECT count(*) FROM public.tarefas WHERE contato_id=c AND titulo='Silêncio de um dia')<>1 OR EXISTS(SELECT 1 FROM public.tarefas WHERE contato_id=c AND titulo='Silêncio de dois dias') THEN RAISE EXCEPTION 'FAIL: timer cruzou regra ou repetiu';END IF;
 ALTER TABLE public.tarefas DISABLE ROW LEVEL SECURITY;ALTER TABLE public.tarefas DISABLE TRIGGER auditoria;DROP POLICY sessao_segura ON public.tarefas;
 SET LOCAL ROLE authenticated;r:=public.diagnostico_base();RESET ROLE;
 IF NOT r->'tabelas_sem_rls'?'tarefas' OR NOT r->'tabelas_sem_auditoria'?'tarefas' OR NOT r->'tabelas_sem_mfa'?'tarefas' THEN RAISE EXCEPTION 'FAIL: diagnóstico não detecta falha';END IF;
END $$;
