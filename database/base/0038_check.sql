DO $$ DECLARE g uuid:=gen_random_uuid();c uuid;o uuid;r uuid;n integer;BEGIN
 INSERT INTO auth.users(id) VALUES(g);UPDATE public.usuarios SET papel='gestor' WHERE id=g;
 PERFORM set_config('request.jwt.claim.sub',g::text,true);SET LOCAL ROLE authenticated;
 r:=public.gestao_regra_salvar(NULL,'Próximo passo',true,'negocio_criado',24,'{}','[{"tipo":"tarefa","titulo":"Ligar"},{"tipo":"criar_negocio","titulo":"Outra venda"}]',NULL);RESET ROLE;
 INSERT INTO public.contatos_dados(nome) VALUES('Teste regras') RETURNING id INTO c;
 PERFORM public.gestao_processar();PERFORM public.gestao_processar();PERFORM public.gestao_processar();
 IF (SELECT count(*) FROM public.oportunidades WHERE contato_id=c)<>2 OR (SELECT count(*) FROM public.tarefas WHERE contato_id=c)<>1 THEN RAISE EXCEPTION 'FAIL: laço ou duplicação';END IF;
 IF (SELECT count(*) FROM public.gestao_execucoes WHERE regra_id=r)<>1 THEN RAISE EXCEPTION 'FAIL: execução repetida';END IF;
 DELETE FROM public.contatos_dados WHERE id=c;
 IF EXISTS(SELECT 1 FROM public.gestao_eventos WHERE contato_id=c) THEN RAISE EXCEPTION 'FAIL: privacidade fila';END IF;
END $$;
