DO $$ DECLARE g uuid:=gen_random_uuid();c uuid;o uuid;p uuid;p2 uuid;n text;n2 text;BEGIN
 INSERT INTO auth.users(id) VALUES(g);UPDATE public.usuarios SET papel='gestor' WHERE id=g;
 INSERT INTO public.contatos_dados(nome) VALUES('Cliente proposta') RETURNING id INTO c;SELECT id INTO o FROM public.oportunidades WHERE contato_id=c;
 IF public.proposta_total('[{"descricao":"Serviço","quantidade":1.005,"preco":1}]')<>1.01 THEN RAISE EXCEPTION 'FAIL: arredondamento decimal';END IF;
 IF public.proposta_total('[{"descricao":"Serviço","quantidade":3,"preco":0.1}]')<>0.30 THEN RAISE EXCEPTION 'FAIL: total decimal';END IF;
 PERFORM set_config('request.jwt.claim.sub',g::text,true);SET LOCAL ROLE authenticated;
 p:=public.proposta_salvar(NULL,o,'Proposta','Termos','[{"descricao":"Serviço","quantidade":2,"preco":50}]',current_date+7,NULL,NULL);
 n:=public.proposta_emitir(p,1);
 BEGIN PERFORM public.proposta_emitir(p,1);RAISE EXCEPTION 'FAIL: emissão repetida';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 p2:=public.proposta_salvar(NULL,o,'Proposta 2','','[{"descricao":"Serviço","quantidade":1,"preco":10}]',current_date+7,NULL,NULL);n2:=public.proposta_emitir(p2,1);
 IF n=n2 THEN RAISE EXCEPTION 'FAIL: número duplicado';END IF;
 PERFORM public.proposta_resultado(p,'aceita',2);RESET ROLE;
 IF NOT EXISTS(SELECT 1 FROM public.propostas WHERE id=p AND total=100 AND subtotais='[100.00]'::jsonb AND snapshot->'cliente'->>'nome'='Cliente proposta') THEN RAISE EXCEPTION 'FAIL: snapshot/total';END IF;
 BEGIN UPDATE public.propostas SET texto='Alterado' WHERE id=p;RAISE EXCEPTION 'FAIL: conteúdo editável';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 DELETE FROM public.contatos_dados WHERE id=c;
 IF EXISTS(SELECT 1 FROM public.propostas WHERE id=p) THEN RAISE EXCEPTION 'FAIL: privacidade propostas';END IF;
END $$;
