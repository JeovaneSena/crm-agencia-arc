BEGIN;
-- Fila comum de lembretes e follow-up. Opcional: módulo conversas; Meta requer campanhas.
-- Regra inspirada nos lembretes e follow-up do DeskcommCRM (MIT, © 2026 Rafael Melgaço).
-- Nada envia de fábrica. Gestor ativa regras e registra autorização por contato.
CREATE TABLE public.automacao_permissoes (
 contato_id uuid PRIMARY KEY REFERENCES public.contatos_dados(id) ON DELETE CASCADE,
 autorizado boolean NOT NULL DEFAULT false,
 fonte text NOT NULL CHECK(length(btrim(fonte)) BETWEEN 5 AND 500),
 atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.automacao_regras (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 nome text NOT NULL CHECK(length(btrim(nome)) BETWEEN 1 AND 100),
 tipo text NOT NULL CHECK(tipo IN ('lembrete','followup')),
 ativa boolean NOT NULL DEFAULT false,
 canal text NOT NULL CHECK(canal IN ('uazapi','meta')),
 minutos integer NOT NULL CHECK(minutos BETWEEN 15 AND 10080),
 etapa text REFERENCES public.etapas_funil(chave),
 texto text NOT NULL CHECK(length(btrim(texto)) BETWEEN 1 AND 1000),
 modelo_nome text, modelo_idioma text NOT NULL DEFAULT 'pt_BR',
 parametros jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(parametros)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(tipo<>'followup' OR etapa IS NOT NULL),
 CHECK(canal<>'meta' OR modelo_nome IS NOT NULL AND modelo_nome ~ '^[a-z][a-z0-9_]{0,511}$')
);
CREATE TABLE public.automacao_envios (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 regra_id uuid NOT NULL REFERENCES public.automacao_regras(id) ON DELETE CASCADE,
 contato_id uuid NOT NULL REFERENCES public.contatos_dados(id) ON DELETE CASCADE,
 reuniao_id uuid REFERENCES public.reunioes(id) ON DELETE CASCADE,
 oportunidade_id uuid REFERENCES public.oportunidades(id) ON DELETE CASCADE,
 referencia_em timestamptz NOT NULL,
 vence_em timestamptz NOT NULL, expira_em timestamptz NOT NULL,
 estado text NOT NULL DEFAULT 'pendente' CHECK(estado IN ('pendente','reservado','chamando','enviado','falhou','incerto','cancelado')),
 token uuid, reservado_em timestamptz, mensagem_id uuid REFERENCES public.mensagens_whatsapp(id) ON DELETE SET NULL,
 erro text, finalizado_em timestamptz,
 CHECK((reuniao_id IS NOT NULL)::integer+(oportunidade_id IS NOT NULL)::integer=1),
 UNIQUE(regra_id,reuniao_id,referencia_em), UNIQUE(regra_id,oportunidade_id,referencia_em)
);
CREATE INDEX automacao_fila_idx ON public.automacao_envios(vence_em) WHERE estado IN ('pendente','reservado','chamando');
ALTER TABLE public.automacao_regras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automacao_permissoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automacao_envios ENABLE ROW LEVEL SECURITY;
CREATE POLICY equipe_le ON public.automacao_regras FOR SELECT TO authenticated USING(true);
CREATE POLICY gestor_escreve ON public.automacao_regras FOR ALL TO authenticated USING(public.usuario_e_gestor()) WITH CHECK(public.usuario_e_gestor());
CREATE POLICY equipe_le ON public.automacao_permissoes FOR SELECT TO authenticated USING(true);
CREATE POLICY gestor_escreve ON public.automacao_permissoes FOR ALL TO authenticated USING(public.usuario_e_gestor()) WITH CHECK(public.usuario_e_gestor());
CREATE POLICY equipe_le ON public.automacao_envios FOR SELECT TO authenticated USING(true);
REVOKE ALL ON public.automacao_regras,public.automacao_permissoes,public.automacao_envios FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.automacao_regras,public.automacao_permissoes TO authenticated;
GRANT SELECT ON public.automacao_envios TO authenticated;
GRANT ALL ON public.automacao_regras,public.automacao_permissoes,public.automacao_envios TO service_role;

-- Usado pelos dois webhooks, antes de ignorar uma entrega duplicada: a parada é durável.
CREATE FUNCTION public.automacao_bloquear(p_contato uuid,p_marketing boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
 insert into public.automacao_permissoes(contato_id,autorizado,fonte)
 values(p_contato,false,'Pedido de parada recebido pelo WhatsApp.')
 on conflict(contato_id) do update set autorizado=false,fonte=excluded.fonte,atualizado_em=now();
 update public.automacao_envios set estado='cancelado',erro='Pedido de parada.',finalizado_em=now()
 where contato_id=p_contato AND estado IN ('pendente','reservado');
 if p_marketing AND to_regprocedure('public.marketing_registrar_preferencia(uuid,boolean,text)') IS NOT NULL then
 execute 'select public.marketing_registrar_preferencia($1,false,$2)' using p_contato,'Pedido de parada recebido pelo WhatsApp.';
 end if;
end;
$$;
REVOKE EXECUTE ON FUNCTION public.automacao_bloquear(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automacao_bloquear(uuid,boolean) TO service_role;

-- Última conferência no banco, inclusive depois de reservado e antes do HTTP.
CREATE FUNCTION public.automacao_elegivel(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
 SELECT EXISTS(
 SELECT 1 FROM public.automacao_envios e JOIN public.automacao_regras a ON a.id=e.regra_id
 JOIN public.contatos_dados c ON c.id=e.contato_id JOIN public.automacao_permissoes p ON p.contato_id=c.id
 LEFT JOIN public.reunioes r ON r.id=e.reuniao_id LEFT JOIN public.oportunidades o ON o.id=e.oportunidade_id
 WHERE e.id=p_id AND a.ativa AND p.autorizado AND c.whatsapp ~ '^[0-9]{6,16}$'
 AND e.vence_em<=now() AND e.expira_em>now()
 AND (a.canal<>'meta' OR EXISTS(SELECT 1 FROM crm_base_private.schema_migrations WHERE version='0010_modulo_campanhas'))
 AND ((a.tipo='lembrete' AND r.status='agendada' AND r.data_reuniao=e.referencia_em AND r.data_reuniao>now())
 OR (a.tipo='followup' AND o.status=a.etapa AND EXISTS(SELECT 1 FROM public.etapas_funil f WHERE f.chave=o.status AND f.tipo='aberta')
 AND coalesce((SELECT max(v.created_at) FROM public.oportunidade_eventos v WHERE v.oportunidade_id=o.id),o.created_at)=e.referencia_em
 AND c.assumido_por IS NULL AND (c.adiada_ate IS NULL OR c.adiada_ate<=now())
 AND NOT EXISTS(SELECT 1 FROM public.mensagens_whatsapp m WHERE m.contato_id=c.id AND (m.autor='cliente' OR (m.autor='atendente' AND m.enviada_por IS NOT NULL)) AND m.criada_em>e.referencia_em)
 AND NOT EXISTS(SELECT 1 FROM public.reunioes rr WHERE rr.contato_id=c.id AND rr.status='agendada' AND rr.data_reuniao>now())))
 );
$$;
CREATE FUNCTION public.automacao_reivindicar(p_limite integer DEFAULT 10) RETURNS SETOF public.automacao_envios
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare vencido record;
begin
 -- Após HTTP iniciado, nunca reenviar. Reserva que não iniciou pode voltar à fila.
 for vencido in update public.automacao_envios set estado='incerto',erro='Envio sem confirmação; confira o histórico.',finalizado_em=now()
 where estado='chamando' AND reservado_em<now()-interval '5 minutes' returning id loop
 perform public.aviso_abrir('automacao_envio',vencido.id::text,'atencao','Uma mensagem automática precisa de revisão.');
 end loop;
 update public.mensagens_whatsapp m set estado_envio='incerto',erro_envio=e.erro
 from public.automacao_envios e where e.mensagem_id=m.id AND e.estado='incerto' AND m.estado_envio='pendente';
 update public.automacao_envios set estado='pendente',token=null where estado='reservado' AND reservado_em<now()-interval '5 minutes';
 insert into public.automacao_envios(regra_id,contato_id,reuniao_id,referencia_em,vence_em,expira_em)
 select a.id,r.contato_id,r.id,r.data_reuniao,r.data_reuniao-make_interval(mins=>a.minutos),
 least(r.data_reuniao,r.data_reuniao-make_interval(mins=>a.minutos)+interval '15 minutes')
 from public.automacao_regras a JOIN public.reunioes r ON r.status='agendada'
 where a.ativa AND a.tipo='lembrete' AND r.data_reuniao-make_interval(mins=>a.minutos)<=now() AND r.data_reuniao-make_interval(mins=>a.minutos)>now()-interval '15 minutes'
 on conflict do nothing;
 insert into public.automacao_envios(regra_id,contato_id,oportunidade_id,referencia_em,vence_em,expira_em)
 select a.id,o.contato_id,o.id,v.em,v.em+make_interval(mins=>a.minutos),v.em+make_interval(mins=>a.minutos)+interval '24 hours'
 from public.automacao_regras a JOIN public.oportunidades o ON o.status=a.etapa
 CROSS JOIN LATERAL(SELECT coalesce(max(ev.created_at),o.created_at) em FROM public.oportunidade_eventos ev WHERE ev.oportunidade_id=o.id) v
 where a.ativa AND a.tipo='followup' AND v.em+make_interval(mins=>a.minutos)<=now() AND v.em+make_interval(mins=>a.minutos)>now()-interval '24 hours'
 on conflict do nothing;
 update public.automacao_envios set estado='cancelado',erro='Prazo vencido ou contato sem elegibilidade.',finalizado_em=now()
 where estado IN ('pendente','reservado') AND NOT public.automacao_elegivel(id);
 -- Uma mensagem por contato por rodada; limita insistência entre regras e negócios.
 return query WITH candidatas AS (
 select e.id FROM public.automacao_envios e WHERE e.estado='pendente' AND public.automacao_elegivel(e.id)
 AND NOT EXISTS(SELECT 1 FROM public.automacao_envios x WHERE x.contato_id=e.contato_id AND
 (x.estado IN ('reservado','chamando') OR (x.estado='enviado' AND x.finalizado_em>now()-interval '1 hour')))
 AND e.id=(SELECT ee.id FROM public.automacao_envios ee WHERE ee.contato_id=e.contato_id AND ee.estado='pendente' ORDER BY ee.vence_em,ee.id LIMIT 1)
 ORDER BY e.vence_em,e.id LIMIT greatest(1,least(coalesce(p_limite,10),20)) FOR UPDATE SKIP LOCKED)
 update public.automacao_envios e set estado='reservado',token=gen_random_uuid(),reservado_em=now()
 from candidatas c WHERE e.id=c.id returning e.*;
end;
$$;
CREATE FUNCTION public.automacao_marcar_chamada(p_id uuid,p_token uuid,p_texto text,p_numero text,p_regra jsonb,p_marketing boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare e public.automacao_envios; a public.automacao_regras; m uuid; consentido boolean:=false;
begin
 select * into e from public.automacao_envios where id=p_id FOR UPDATE;
 if e.estado IS DISTINCT FROM 'reservado' OR e.token IS DISTINCT FROM p_token OR e.reservado_em<now()-interval '5 minutes' then return null; end if;
 if NOT public.automacao_elegivel(e.id) then
 update public.automacao_envios set estado='cancelado',finalizado_em=now(),erro='Elegibilidade mudou antes do envio.' where id=e.id; return null; end if;
 select * into a from public.automacao_regras where id=e.regra_id;
 if to_jsonb(a) IS DISTINCT FROM p_regra OR NOT EXISTS(SELECT 1 FROM public.contatos_dados WHERE id=e.contato_id AND whatsapp=p_numero) then
 update public.automacao_envios set estado='cancelado',erro='Configuração mudou durante a preparação.',finalizado_em=now() where id=e.id; return null; end if;
 if p_marketing then
 if to_regclass('public.marketing_consentimentos') IS NOT NULL then
 execute 'select exists(select 1 from public.marketing_consentimentos where contato_id=$1 AND ativo)' into consentido using e.contato_id;
 end if;
 if not consentido then update public.automacao_envios set estado='cancelado',erro='Marketing sem consentimento ativo.',finalizado_em=now() where id=e.id; return null; end if;
 end if;
 if p_texto IS NULL OR length(btrim(p_texto)) NOT BETWEEN 1 AND 4000 then raise exception 'Texto inválido.'; end if;
 insert into public.mensagens_whatsapp(contato_id,autor,conteudo,provedor,pedido_id,estado_envio,origem_envio,lida)
 values(e.contato_id,'atendente',p_texto,a.canal,e.id,'pendente','atendimento',true) returning id into m;
 update public.automacao_envios set estado='chamando',mensagem_id=m,reservado_em=now() where id=e.id;
 return m;
end;
$$;
CREATE FUNCTION public.automacao_finalizar(p_id uuid,p_token uuid,p_estado text,p_externo text DEFAULT null,p_erro text DEFAULT null) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare e public.automacao_envios;
begin
 if p_estado NOT IN ('enviado','falhou','incerto','cancelado') then raise exception 'Estado inválido.'; end if;
 select * into e from public.automacao_envios where id=p_id FOR UPDATE;
 if e.token IS DISTINCT FROM p_token OR e.estado NOT IN ('reservado','chamando') then return; end if;
 update public.automacao_envios set estado=p_estado,erro=left(p_erro,500),finalizado_em=now() where id=e.id;
 update public.mensagens_whatsapp set estado_envio=case when p_estado='cancelado' then 'falhou' else p_estado end,id_externo=p_externo,erro_envio=left(p_erro,500) where id=e.mensagem_id;
 if p_estado IN ('falhou','incerto') then perform public.aviso_abrir('automacao_envio',e.id::text,'atencao','Uma mensagem automática precisa de revisão.'); end if;
end;
$$;
REVOKE EXECUTE ON FUNCTION public.automacao_elegivel(uuid),public.automacao_reivindicar(integer),public.automacao_marcar_chamada(uuid,uuid,text,text,jsonb,boolean),public.automacao_finalizar(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automacao_elegivel(uuid),public.automacao_reivindicar(integer),public.automacao_marcar_chamada(uuid,uuid,text,text,jsonb,boolean),public.automacao_finalizar(uuid,uuid,text,text,text) TO service_role;
INSERT INTO crm_base_private.schema_migrations(version) VALUES ('0024_automacoes_de_envio');
NOTIFY pgrst,'reload schema';
COMMIT;
