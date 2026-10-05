BEGIN;
-- Módulo captação, independente de WhatsApp. Primeiro toque apenas de contatos NOVOS.
-- Ideia adaptada do DeskcommCRM (MIT, © 2026 Rafael Melgaço): lib/webhooks/captacao.ts.
CREATE TABLE public.captacao_fontes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 nome text NOT NULL CHECK(length(btrim(nome)) BETWEEN 1 AND 100),
 segredo_hash text NOT NULL CHECK(segredo_hash ~ '^[0-9a-f]{64}$'),
 ativa boolean NOT NULL DEFAULT false,
 criada_em timestamptz NOT NULL DEFAULT now(),
 criada_por uuid NOT NULL REFERENCES public.usuarios(id)
);
CREATE TABLE public.captacao_recebimentos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 fonte_id uuid NOT NULL REFERENCES public.captacao_fontes(id),
 evento text CHECK(length(evento) BETWEEN 1 AND 120),
 contato_id uuid REFERENCES public.contatos_dados(id) ON DELETE CASCADE,
 resultado text NOT NULL CHECK(resultado IN ('criado','existente','recusado')),
 motivo text CHECK(motivo IN ('formato_invalido','telefone_invalido','email_invalido','campo_longo')),
 utm jsonb NOT NULL DEFAULT '{}',
 recebido_em timestamptz NOT NULL DEFAULT now(),
 CHECK((resultado='recusado') = (motivo IS NOT NULL)),
 CHECK((resultado='recusado') = (contato_id IS NULL))
);
CREATE UNIQUE INDEX captacao_evento_unico ON public.captacao_recebimentos(fonte_id,evento) WHERE evento IS NOT NULL;
CREATE INDEX captacao_recebimentos_fonte ON public.captacao_recebimentos(fonte_id,recebido_em DESC);
CREATE INDEX captacao_recebimentos_data ON public.captacao_recebimentos(recebido_em DESC);
CREATE INDEX captacao_recebimentos_contato ON public.captacao_recebimentos(contato_id);
CREATE TABLE public.contato_atribuicoes (
 contato_id uuid PRIMARY KEY REFERENCES public.contatos_dados(id) ON DELETE CASCADE,
 fonte_id uuid NOT NULL REFERENCES public.captacao_fontes(id),
 utm jsonb NOT NULL DEFAULT '{}',
 recebida_em timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['captacao_fontes','captacao_recebimentos','contato_atribuicoes'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
  EXECUTE format('CREATE POLICY equipe_le ON public.%I FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.usuarios WHERE id=auth.uid() AND ativo))',t);
 END LOOP;
END $$;
-- O hash nunca é selecionável por sessão de navegador, nem por gestor.
GRANT SELECT(id,nome,ativa,criada_em,criada_por) ON public.captacao_fontes TO authenticated;
GRANT SELECT ON public.captacao_recebimentos, public.contato_atribuicoes TO authenticated;

CREATE FUNCTION public.captacao_criar_fonte(p_nome text,p_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid; BEGIN
 IF NOT public.usuario_e_gestor() THEN RAISE EXCEPTION 'Só gestor configura a captação.' USING errcode='42501'; END IF;
 INSERT INTO public.captacao_fontes(nome,segredo_hash,criada_por) VALUES(btrim(p_nome),p_hash,auth.uid()) RETURNING id INTO v_id;
 RETURN v_id;
END $$;
CREATE FUNCTION public.captacao_configurar_fonte(p_id uuid,p_ativa boolean,p_hash text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
 IF NOT public.usuario_e_gestor() THEN RAISE EXCEPTION 'Só gestor configura a captação.' USING errcode='42501'; END IF;
 IF p_ativa IS NULL THEN RAISE EXCEPTION 'Informe se a fonte está ativa.' USING errcode='22023'; END IF;
 UPDATE public.captacao_fontes SET ativa=p_ativa,segredo_hash=coalesce(p_hash,segredo_hash) WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Fonte não encontrada.' USING errcode='P0002'; END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.captacao_criar_fonte(text,text),public.captacao_configurar_fonte(uuid,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.captacao_criar_fonte(text,text),public.captacao_configurar_fonte(uuid,boolean,text) TO authenticated;

CREATE FUNCTION public.captacao_receber(p_fonte uuid,p_hash text,p_evento text,p_dados jsonb,p_motivo text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE f public.captacao_fontes; anterior public.captacao_recebimentos; c uuid; novo boolean;
 motivo text := p_motivo; utm jsonb := '{}'; resultado text; v_evento text := nullif(btrim(p_evento),'');
BEGIN
 -- Serializa a fonte: desligamento, troca do segredo, repetição e limite são atômicos.
 SELECT * INTO f FROM public.captacao_fontes WHERE id=p_fonte FOR UPDATE;
 IF f.id IS NULL OR NOT f.ativa OR p_hash IS DISTINCT FROM f.segredo_hash THEN
  RETURN jsonb_build_object('resultado','nao_autorizado');
 END IF;
 IF v_evento IS NOT NULL AND length(v_evento)>120 THEN RAISE EXCEPTION 'Evento muito longo.' USING errcode='22023'; END IF;
 IF v_evento IS NOT NULL THEN
  SELECT * INTO anterior FROM public.captacao_recebimentos WHERE fonte_id=f.id AND captacao_recebimentos.evento=v_evento;
  IF FOUND THEN RETURN jsonb_build_object('resultado',anterior.resultado,'repetido',true); END IF;
 END IF;
 IF (SELECT count(*) FROM public.captacao_recebimentos WHERE fonte_id=f.id AND recebido_em>now()-interval '1 minute')>=120 THEN
  RETURN jsonb_build_object('resultado','limite');
 END IF;
 -- Revalida no banco: a função só é executável pelo servidor, mas não confia no payload.
 IF motivo IS NULL THEN
  IF p_dados IS NULL OR jsonb_typeof(p_dados)<>'object' THEN motivo := 'formato_invalido';
  ELSIF coalesce(p_dados->>'whatsapp','') !~ '^[1-9][0-9]{11,14}$' THEN motivo := 'telefone_invalido';
  ELSIF nullif(p_dados->>'email','') IS NOT NULL AND (p_dados->>'email') !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' THEN motivo := 'email_invalido';
  ELSIF length(coalesce(p_dados->>'nome',''))>200 OR length(coalesce(p_dados->>'empresa',''))>200 OR length(coalesce(p_dados->>'email',''))>254 THEN motivo := 'campo_longo';
  END IF;
 END IF;
 IF motivo IS NULL THEN
  IF jsonb_typeof(p_dados->'utm')='object' THEN
   SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO utm FROM jsonb_each(p_dados->'utm')
    WHERE key IN ('utm_source','utm_medium','utm_campaign','utm_content','utm_term') AND jsonb_typeof(value)='string' AND length(value#>>'{}') BETWEEN 1 AND 200;
  END IF;
  -- Duas fontes enviando o mesmo telefone preservam uma única criação e atribuição.
  PERFORM pg_advisory_xact_lock(hashtext(p_dados->>'whatsapp'));
  INSERT INTO public.contatos_dados(nome,whatsapp,email,empresa)
   VALUES(nullif(btrim(p_dados->>'nome'),''),p_dados->>'whatsapp',nullif(btrim(p_dados->>'email'),''),nullif(btrim(p_dados->>'empresa'),''))
   ON CONFLICT(whatsapp) WHERE whatsapp IS NOT NULL DO NOTHING RETURNING id INTO c;
  novo := c IS NOT NULL;
  IF NOT novo THEN SELECT id INTO c FROM public.contatos_dados WHERE whatsapp=p_dados->>'whatsapp'; END IF;
  resultado := CASE WHEN novo THEN 'criado' ELSE 'existente' END;
  IF novo THEN INSERT INTO public.contato_atribuicoes(contato_id,fonte_id,utm) VALUES(c,f.id,utm); END IF;
 ELSE
  resultado := 'recusado';
  PERFORM public.aviso_abrir('captacao_recusada',f.id::text,'atencao','Formulário recusado',
   'Confira os campos enviados pela fonte '||f.nome||'.','/captacao',NULL,true);
 END IF;
 INSERT INTO public.captacao_recebimentos(fonte_id,evento,contato_id,resultado,motivo,utm) VALUES(f.id,v_evento,c,resultado,motivo,utm);
 RETURN jsonb_build_object('resultado',resultado,'repetido',false);
END $$;
REVOKE EXECUTE ON FUNCTION public.captacao_receber(uuid,text,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.captacao_receber(uuid,text,text,jsonb,text) TO service_role;

INSERT INTO crm_base_private.schema_migrations(version) VALUES('0025_captacao_de_formularios');
NOTIFY pgrst,'reload schema';
COMMIT;
