BEGIN;
-- MÓDULO CAMPANHAS (disparo de modelo aprovado da Meta para contatos do CRM). Só aplique em
-- instalações que ligarem `campanhas` em VITE_MODULOS. Depende do módulo CONVERSAS (0007):
-- cada envio vira uma mensagem na conversa do contato.
--
-- Princípios (mensagem em massa é o lugar onde um erro vira reclamação e bloqueio do número):
--  * SEM CONSENTIMENTO REGISTRADO NÃO SAI. Quem pediu para parar nunca é reativado por campanha.
--  * O público é CONGELADO antes de começar: o gestor revisa quem vai receber, e o início exige o
--    mesmo `revisao_hash` que ele revisou.
--  * O navegador só configura. Quem envia é a Edge Function (service_role), pela fila abaixo, e
--    cada passo é à prova de repetição: reserva com `pedido_id`, lease com token, e "chamada
--    iniciada" marca o ponto sem volta (depois dele, uma falha vira INCERTO, nunca reenvio).
--  * Limites por minuto e por dia em `campanhas_controle`, e um interruptor geral de pausa.

-- ---------------------------------------------------------------------------
-- Consentimento de marketing (um registro por contato) e sua trilha imutável
-- ---------------------------------------------------------------------------
CREATE TABLE public.marketing_consentimentos (
  contato_id uuid PRIMARY KEY REFERENCES public.contatos_dados(id) ON DELETE CASCADE,
  ativo boolean NOT NULL,
  consentido_em timestamptz,
  revogado_em timestamptz,
  fonte text NOT NULL CHECK (length(btrim(fonte)) BETWEEN 5 AND 500),
  atualizado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  atualizada_em timestamptz NOT NULL DEFAULT now(),
  CHECK ((ativo AND consentido_em IS NOT NULL AND revogado_em IS NULL) OR (NOT ativo AND revogado_em IS NOT NULL))
);
CREATE TABLE public.marketing_preferencias_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_id uuid NOT NULL REFERENCES public.contatos_dados(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('consentimento','revogacao')),
  fonte text NOT NULL,
  usuario_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX marketing_preferencias_contato_idx ON public.marketing_preferencias_eventos(contato_id, criado_em DESC);

CREATE FUNCTION public.marketing_evento_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
begin
  -- Só a exclusão em cascata do contato (LGPD) apaga a trilha; ninguém edita nem apaga uma linha.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'A trilha de consentimento não pode ser alterada.' using errcode = '42501';
end;
$$;
CREATE TRIGGER marketing_evento_imutavel BEFORE UPDATE OR DELETE ON public.marketing_preferencias_eventos
  FOR EACH ROW EXECUTE FUNCTION public.marketing_evento_imutavel();

-- Registrar consentimento: só o gestor (é ele que responde pela autorização do contato). Revogar:
-- qualquer pessoa ativa da equipe, e o servidor (opt-out recebido pelo WhatsApp, auth.uid() nulo).
CREATE FUNCTION public.marketing_registrar_preferencia(p_contato uuid, p_ativo boolean, p_fonte text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_usuario uuid := auth.uid();
begin
  if v_usuario is not null then
    if not exists (select 1 from public.usuarios where id = v_usuario and ativo) then raise exception 'Sem acesso.' using errcode = '42501'; end if;
    if p_ativo and not public.usuario_e_gestor() then raise exception 'Só o gestor registra a autorização de um contato.' using errcode = '42501'; end if;
  end if;
  if p_fonte is null or length(btrim(p_fonte)) < 5 then raise exception 'Informe a origem da autorização (por exemplo, "pediu pelo WhatsApp em 10/10").' using errcode = '22023'; end if;
  if not exists (select 1 from public.contatos_dados where id = p_contato) then raise exception 'Contato não encontrado.' using errcode = 'P0002'; end if;
  insert into public.marketing_consentimentos(contato_id, ativo, consentido_em, revogado_em, fonte, atualizado_por, atualizada_em)
  values (p_contato, p_ativo, case when p_ativo then now() end, case when not p_ativo then now() end, btrim(p_fonte), v_usuario, now())
  on conflict (contato_id) do update set ativo = excluded.ativo, consentido_em = excluded.consentido_em, revogado_em = excluded.revogado_em,
    fonte = excluded.fonte, atualizado_por = excluded.atualizado_por, atualizada_em = excluded.atualizada_em;
  insert into public.marketing_preferencias_eventos(contato_id, tipo, fonte, usuario_id)
  values (p_contato, case when p_ativo then 'consentimento' else 'revogacao' end, btrim(p_fonte), v_usuario);
end;
$$;

-- ---------------------------------------------------------------------------
-- Controle global do envio (um registro) e campanhas
-- ---------------------------------------------------------------------------
CREATE TABLE public.campanhas_controle (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  pausado boolean NOT NULL DEFAULT false,
  pausa_motivo text,
  limite_por_minuto integer NOT NULL DEFAULT 30 CHECK (limite_por_minuto BETWEEN 1 AND 1000),
  -- 250 é o teto inicial da Meta para números novos; suba só depois de a Meta liberar mais.
  limite_diario integer NOT NULL DEFAULT 250 CHECK (limite_diario BETWEEN 1 AND 1000000),
  dia_controle date NOT NULL DEFAULT current_date,
  usados_no_dia integer NOT NULL DEFAULT 0 CHECK (usados_no_dia >= 0),
  proximo_disparo_em timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.campanhas_controle DEFAULT VALUES;

CREATE TABLE public.campanhas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 160),
  objetivo text CHECK (objetivo IS NULL OR length(btrim(objetivo)) BETWEEN 1 AND 1000),
  estado text NOT NULL DEFAULT 'rascunho' CHECK (estado IN ('rascunho','pronta','enviando','pausada','concluida','cancelada')),
  -- O modelo é o aprovado na Meta. O snapshot serve só para a tela mostrar; quem manda é a versão
  -- que a Meta devolve na hora do envio (se ficou reprovada ou mudou, o envio para).
  modelo_id text NOT NULL CHECK (length(btrim(modelo_id)) BETWEEN 1 AND 200),
  modelo_nome text NOT NULL CHECK (length(btrim(modelo_nome)) BETWEEN 1 AND 512),
  modelo_idioma text NOT NULL CHECK (length(btrim(modelo_idioma)) BETWEEN 2 AND 35),
  modelo_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(modelo_snapshot) = 'object'),
  -- [{tipo:'body'|'header', posicao:1, origem:'nome'|'primeiro_nome'|'empresa'|'fixo', valor?:'texto'}]
  mapeamento_parametros jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(mapeamento_parametros) = 'array'),
  -- {status?:[...], interesse?:'texto', contato_ids?:[uuid...]}. Um "teste" é uma campanha com o seu
  -- próprio contato em contato_ids.
  filtros_publico jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(filtros_publico) = 'object'),
  publico_congelado_em timestamptz,
  revisao_hash text,
  limite_destinatarios integer NOT NULL DEFAULT 1000 CHECK (limite_destinatarios BETWEEN 1 AND 100000),
  -- Não manda se o contato recebeu qualquer campanha nas últimas N horas.
  intervalo_minimo_horas integer NOT NULL DEFAULT 24 CHECK (intervalo_minimo_horas BETWEEN 0 AND 8760),
  criada_por uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  criada_em timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz NOT NULL DEFAULT now(),
  versao bigint NOT NULL DEFAULT 1,
  iniciada_em timestamptz, pausada_em timestamptz, cancelada_em timestamptz, concluida_em timestamptz,
  motivo text,
  CHECK ((estado IN ('pronta','enviando','pausada','concluida')) = (publico_congelado_em IS NOT NULL) OR estado = 'cancelada')
);
CREATE INDEX campanhas_lista_idx ON public.campanhas(criada_em DESC, id);
CREATE INDEX campanhas_fila_idx ON public.campanhas(estado, iniciada_em) WHERE estado = 'enviando';

CREATE TABLE public.campanha_destinatarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id uuid NOT NULL REFERENCES public.campanhas(id) ON DELETE CASCADE,
  contato_id uuid NOT NULL REFERENCES public.contatos_dados(id) ON DELETE CASCADE,
  whatsapp text CHECK (whatsapp IS NULL OR whatsapp ~ '^\d{6,16}$'),
  nome text,
  -- Parâmetros já resolvidos, no formato que o modelo espera: {"body":["Maria","Acme"],"header":[]}
  valores jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(valores) = 'object'),
  apto boolean NOT NULL DEFAULT false,
  motivo_exclusao text,
  estado text NOT NULL DEFAULT 'pendente' CHECK (estado IN (
    'excluido','pendente','processando','aceito','retido','falhou','incerto','ignorado','cancelado','enviado','entregue','lido')),
  erro text,
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  proxima_tentativa timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expira_em timestamptz,
  reivindicado_em timestamptz,
  reservado_em timestamptz,
  chamada_iniciada_em timestamptz,
  aceito_em timestamptz,
  finalizado_em timestamptz,
  pedido_id uuid UNIQUE,
  mensagem_id uuid UNIQUE REFERENCES public.mensagens_whatsapp(id) ON DELETE SET NULL,
  criada_em timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campanha_id, contato_id),
  CHECK (apto = (pedido_id IS NOT NULL)),
  CHECK (apto OR estado = 'excluido'),
  CHECK (NOT apto OR whatsapp IS NOT NULL),
  CHECK (estado <> 'processando' OR lease_token IS NOT NULL)
);
CREATE INDEX campanha_destinatarios_fila_idx ON public.campanha_destinatarios(estado, proxima_tentativa, campanha_id) WHERE estado IN ('pendente','processando');
CREATE INDEX campanha_destinatarios_lista_idx ON public.campanha_destinatarios(campanha_id, criada_em, id);
CREATE INDEX campanha_destinatarios_contato_idx ON public.campanha_destinatarios(contato_id, criada_em DESC);

CREATE TABLE public.campanha_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id uuid NOT NULL REFERENCES public.campanhas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (length(btrim(tipo)) BETWEEN 2 AND 60),
  descricao text,
  usuario_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX campanha_eventos_lista_idx ON public.campanha_eventos(campanha_id, criado_em DESC, id DESC);

-- A mensagem enviada por campanha aparece na conversa do contato, com a origem marcada.
ALTER TABLE public.mensagens_whatsapp
  ADD COLUMN campanha_id uuid REFERENCES public.campanhas(id) ON DELETE SET NULL,
  DROP CONSTRAINT mensagens_whatsapp_origem_envio_check,
  ADD CONSTRAINT mensagens_whatsapp_origem_envio_check CHECK (origem_envio IN ('agente','atendimento','campanha'));
CREATE INDEX mensagens_campanha_idx ON public.mensagens_whatsapp(campanha_id, criada_em) WHERE campanha_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Gatilhos: configuração só enquanto não começou; versão e hora sempre novas
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.campanhas_validar() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare k text;
begin
  for k in select jsonb_object_keys(new.filtros_publico) loop
    if k not in ('status','interesse','contato_ids') then raise exception 'Filtro desconhecido: %.', k using errcode = '22023'; end if;
  end loop;
  if new.filtros_publico ? 'status' and jsonb_typeof(new.filtros_publico->'status') <> 'array' then raise exception 'O filtro de etapa deve ser uma lista.' using errcode = '22023'; end if;
  if new.filtros_publico ? 'contato_ids' and jsonb_typeof(new.filtros_publico->'contato_ids') <> 'array' then raise exception 'O filtro de contatos deve ser uma lista.' using errcode = '22023'; end if;
  if tg_op = 'INSERT' then
    new.criada_por := coalesce(auth.uid(), new.criada_por);
    new.estado := 'rascunho'; new.publico_congelado_em := null; new.revisao_hash := null; new.versao := 1;
    new.iniciada_em := null; new.pausada_em := null; new.cancelada_em := null; new.concluida_em := null;
  else
    new.criada_por := old.criada_por; new.criada_em := old.criada_em;
    if row(new.nome, new.objetivo, new.modelo_id, new.modelo_nome, new.modelo_idioma, new.modelo_snapshot, new.mapeamento_parametros,
           new.filtros_publico, new.limite_destinatarios, new.intervalo_minimo_horas)
       is distinct from row(old.nome, old.objetivo, old.modelo_id, old.modelo_nome, old.modelo_idioma, old.modelo_snapshot, old.mapeamento_parametros,
           old.filtros_publico, old.limite_destinatarios, old.intervalo_minimo_horas) then
      if old.estado not in ('rascunho','pronta') then raise exception 'Campanha já iniciada: não dá para mudar a configuração.' using errcode = '55000'; end if;
      -- Mudou o que a revisão cobria: volta a rascunho e o público congelado é descartado.
      if old.estado = 'pronta' then
        new.estado := 'rascunho'; new.publico_congelado_em := null; new.revisao_hash := null;
        delete from public.campanha_destinatarios where campanha_id = old.id;
      end if;
    end if;
    new.versao := old.versao + 1;
  end if;
  new.atualizada_em := clock_timestamp();
  return new;
end;
$$;
REVOKE EXECUTE ON FUNCTION public.campanhas_validar() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER campanhas_validar BEFORE INSERT OR UPDATE ON public.campanhas FOR EACH ROW EXECUTE FUNCTION public.campanhas_validar();

CREATE FUNCTION public.campanhas_so_rascunho_apaga() RETURNS trigger LANGUAGE plpgsql AS $$
begin
  if old.estado <> 'rascunho' then raise exception 'Só rascunho pode ser apagado; use cancelar.' using errcode = '55000'; end if;
  return old;
end;
$$;
CREATE TRIGGER campanhas_so_rascunho_apaga BEFORE DELETE ON public.campanhas FOR EACH ROW EXECUTE FUNCTION public.campanhas_so_rascunho_apaga();

CREATE FUNCTION public.campanha_destinatarios_tocar() RETURNS trigger LANGUAGE plpgsql AS $$
begin new.atualizada_em := clock_timestamp(); return new; end;
$$;
CREATE TRIGGER campanha_destinatarios_tocar BEFORE UPDATE ON public.campanha_destinatarios FOR EACH ROW EXECUTE FUNCTION public.campanha_destinatarios_tocar();

-- ---------------------------------------------------------------------------
-- Congelar o público: quem recebe, quem fica de fora e por quê
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.campanha_congelar_publico(p_campanha uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare c public.campanhas; v_hash text; v_resumo jsonb;
begin
  if not public.usuario_e_gestor() then raise exception 'Só o gestor controla campanhas.' using errcode = '42501'; end if;
  select * into c from public.campanhas where id = p_campanha for update;
  if c.id is null then raise exception 'Campanha não encontrada.' using errcode = 'P0002'; end if;
  if c.estado not in ('rascunho','pronta') then raise exception 'O público só pode ser congelado antes de começar.' using errcode = '55000'; end if;
  if jsonb_array_length(c.mapeamento_parametros) = 0 and c.modelo_snapshot = '{}'::jsonb then raise exception 'Escolha o modelo antes de congelar o público.' using errcode = '22023'; end if;

  delete from public.campanha_destinatarios where campanha_id = c.id;

  insert into public.campanha_destinatarios(campanha_id, contato_id, whatsapp, nome, valores, apto, motivo_exclusao, estado, pedido_id)
  select c.id, x.id, x.whatsapp, x.nome, case when x.motivo is null then x.valores else '{}'::jsonb end, x.motivo is null, x.motivo,
         case when x.motivo is null then 'pendente' else 'excluido' end, case when x.motivo is null then gen_random_uuid() end
  from (
    select q.id, q.whatsapp, q.nome, q.valores,
      -- O limite só "gasta" posição com quem já passou em todos os outros filtros.
      coalesce(q.motivo0, case when row_number() over (partition by (q.motivo0 is null) order by q.criado, q.id) > c.limite_destinatarios then 'acima_do_limite' end) as motivo
    from (
      select d.id, d.whatsapp, d.nome, d.created_at as criado, p.valores,
        case
          when d.whatsapp is null or d.whatsapp !~ '^\d{6,16}$' then 'sem_whatsapp'
          when mc.ativo is null then 'sem_consentimento'
          when not mc.ativo then 'pediu_para_parar'
          when exists (select 1 from public.mensagens_whatsapp m where m.contato_id = d.id and m.origem_envio = 'campanha'
                         and m.criada_em > now() - make_interval(hours => c.intervalo_minimo_horas)) then 'recebeu_campanha_recentemente'
          when p.faltando then 'parametro_vazio'
        end as motivo0
      from public.contatos_dados d
      left join public.marketing_consentimentos mc on mc.contato_id = d.id
      cross join lateral (
        select coalesce(jsonb_object_agg(t.tipo, t.itens), '{}'::jsonb) as valores, coalesce(bool_or(t.vazio), false) as faltando
        from (
          select m->>'tipo' as tipo, jsonb_agg(coalesce(v.valor, '') order by (m->>'posicao')::int) as itens, bool_or(v.valor is null) as vazio
          from jsonb_array_elements(c.mapeamento_parametros) m
          cross join lateral (select case m->>'origem'
              when 'nome' then nullif(btrim(d.nome), '')
              when 'primeiro_nome' then nullif(split_part(btrim(d.nome), ' ', 1), '')
              when 'empresa' then nullif(btrim(d.empresa), '')
              when 'fixo' then nullif(btrim(m->>'valor'), '')
            end as valor) v
          group by m->>'tipo'
        ) t
      ) p
      where (coalesce(jsonb_array_length(c.filtros_publico->'status'), 0) = 0
             or d.status = any (array(select jsonb_array_elements_text(c.filtros_publico->'status'))))
        and (c.filtros_publico->>'interesse' is null or c.filtros_publico->>'interesse' = any (d.interesses))
        and (coalesce(jsonb_array_length(c.filtros_publico->'contato_ids'), 0) = 0
             or d.id = any (array(select (jsonb_array_elements_text(c.filtros_publico->'contato_ids'))::uuid)))
    ) q
  ) x;

  select encode(sha256(convert_to(c.modelo_id || '|' || c.mapeamento_parametros::text || '|' || coalesce(string_agg(d.contato_id::text || ':' || d.valores::text, ',' order by d.contato_id), ''), 'UTF8')), 'hex')
    into v_hash from public.campanha_destinatarios d where d.campanha_id = c.id and d.apto;

  update public.campanhas set estado = 'pronta', publico_congelado_em = now(), revisao_hash = v_hash where id = c.id;
  insert into public.campanha_eventos(campanha_id, tipo, descricao, usuario_id) values (c.id, 'publico_congelado', 'Público congelado para revisão.', auth.uid());

  select jsonb_build_object(
    'revisao_hash', v_hash,
    'aptos', count(*) filter (where apto),
    'excluidos', count(*) filter (where not apto),
    'motivos', coalesce((select jsonb_object_agg(motivo_exclusao, n) from (select motivo_exclusao, count(*) n from public.campanha_destinatarios where campanha_id = c.id and not apto group by 1) m), '{}'::jsonb)
  ) into v_resumo from public.campanha_destinatarios where campanha_id = c.id;
  return v_resumo;
end;
$$;

-- ---------------------------------------------------------------------------
-- Controle: iniciar, pausar, retomar, cancelar (todos só do gestor)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.campanha_iniciar(p_campanha uuid, p_revisao_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare c public.campanhas; v_aptos integer; v_pausa boolean;
begin
  if not public.usuario_e_gestor() then raise exception 'Só o gestor controla campanhas.' using errcode = '42501'; end if;
  select * into c from public.campanhas where id = p_campanha for update;
  if c.id is null then raise exception 'Campanha não encontrada.' using errcode = 'P0002'; end if;
  if c.estado <> 'pronta' then raise exception 'A campanha precisa estar pronta (público congelado e revisado).' using errcode = '55000'; end if;
  if c.revisao_hash is distinct from p_revisao_hash then raise exception 'A revisão mudou. Revise o público de novo antes de iniciar.' using errcode = '55000'; end if;
  select count(*) into v_aptos from public.campanha_destinatarios where campanha_id = c.id and apto;
  if v_aptos = 0 then raise exception 'Nenhum contato apto a receber.' using errcode = '22023'; end if;
  select pausado into v_pausa from public.campanhas_controle;
  if v_pausa then raise exception 'Os envios de campanha estão pausados para toda a instalação.' using errcode = '55000'; end if;
  update public.campanhas set estado = 'enviando', iniciada_em = now() where id = c.id;
  update public.campanha_destinatarios set proxima_tentativa = now() where campanha_id = c.id and estado = 'pendente';
  insert into public.campanha_eventos(campanha_id, tipo, descricao, usuario_id) values (c.id, 'iniciada', v_aptos || ' contato(s) na fila.', auth.uid());
end;
$$;

CREATE FUNCTION public.campanha_pausar(p_campanha uuid, p_motivo text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if not public.usuario_e_gestor() then raise exception 'Só o gestor controla campanhas.' using errcode = '42501'; end if;
  update public.campanhas set estado = 'pausada', pausada_em = now(), motivo = nullif(btrim(p_motivo), '') where id = p_campanha and estado = 'enviando';
  if not found then raise exception 'Só uma campanha em envio pode ser pausada.' using errcode = '55000'; end if;
  insert into public.campanha_eventos(campanha_id, tipo, descricao, usuario_id) values (p_campanha, 'pausada', nullif(btrim(p_motivo), ''), auth.uid());
end;
$$;

CREATE FUNCTION public.campanha_retomar(p_campanha uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_pausa boolean;
begin
  if not public.usuario_e_gestor() then raise exception 'Só o gestor controla campanhas.' using errcode = '42501'; end if;
  select pausado into v_pausa from public.campanhas_controle;
  if v_pausa then raise exception 'Os envios de campanha estão pausados para toda a instalação.' using errcode = '55000'; end if;
  update public.campanhas set estado = 'enviando', pausada_em = null, motivo = null where id = p_campanha and estado = 'pausada';
  if not found then raise exception 'Só uma campanha pausada pode ser retomada.' using errcode = '55000'; end if;
  insert into public.campanha_eventos(campanha_id, tipo, usuario_id) values (p_campanha, 'retomada', auth.uid());
end;
$$;

CREATE FUNCTION public.campanha_cancelar(p_campanha uuid, p_motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare c public.campanhas;
begin
  if not public.usuario_e_gestor() then raise exception 'Só o gestor controla campanhas.' using errcode = '42501'; end if;
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'Informe o motivo do cancelamento.' using errcode = '22023'; end if;
  select * into c from public.campanhas where id = p_campanha for update;
  if c.id is null then raise exception 'Campanha não encontrada.' using errcode = 'P0002'; end if;
  if c.estado not in ('rascunho','pronta','enviando','pausada') then raise exception 'Esta campanha já terminou.' using errcode = '55000'; end if;
  update public.campanhas set estado = 'cancelada', cancelada_em = now(), motivo = btrim(p_motivo) where id = c.id;
  -- Quem ainda não foi reivindicado nunca sai. Quem já está sendo enviado termina o que começou.
  update public.campanha_destinatarios set estado = 'cancelado', finalizado_em = now() where campanha_id = c.id and estado = 'pendente';
  insert into public.campanha_eventos(campanha_id, tipo, descricao, usuario_id) values (c.id, 'cancelada', btrim(p_motivo), auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- A fila (só o servidor chama): reivindicar, reservar, marcar chamada, finalizar
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.campanha_fechar_se_terminou(p_campanha uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  update public.campanhas set estado = 'concluida', concluida_em = now()
   where id = p_campanha and estado = 'enviando'
     and not exists (select 1 from public.campanha_destinatarios where campanha_id = p_campanha and estado in ('pendente','processando'));
  if found then insert into public.campanha_eventos(campanha_id, tipo) values (p_campanha, 'concluida'); end if;
end;
$$;

CREATE FUNCTION public.campanha_reivindicar(p_limite integer DEFAULT 10)
RETURNS TABLE(destinatario_id uuid, campanha_id uuid, contato_id uuid, whatsapp text, valores jsonb, lease_token uuid,
              modelo_id text, modelo_nome text, modelo_idioma text, pedido_id uuid, tentativas integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
#variable_conflict use_column
declare k public.campanhas_controle; v_hoje date; v_n integer; v_pegos integer; v_ids uuid[]; v_camp uuid;
begin
  -- Lease vencida: se a chamada à Meta nunca começou, volta para a fila; se começou, pode ter saído
  -- e fica INCERTO (conferir à mão; jamais reenviar sozinho).
  update public.campanha_destinatarios set estado = case when chamada_iniciada_em is null then 'pendente' else 'incerto' end,
         erro = case when chamada_iniciada_em is null then erro else 'O envio foi interrompido; confira se a mensagem saiu.' end,
         lease_token = null, lease_expira_em = null,
         finalizado_em = case when chamada_iniciada_em is null then null else now() end
   where estado = 'processando' and lease_expira_em < now();
  for v_camp in select distinct d.campanha_id from public.campanha_destinatarios d where d.estado = 'incerto' and d.finalizado_em > now() - interval '1 minute' loop
    perform public.campanha_fechar_se_terminou(v_camp);
  end loop;

  select * into k from public.campanhas_controle for update;
  if k.pausado or now() < k.proximo_disparo_em then return; end if;
  v_hoje := (now() at time zone coalesce((select max(fuso_horario) from public.configuracoes_negocio), 'America/Sao_Paulo'))::date;
  if k.dia_controle <> v_hoje then k.dia_controle := v_hoje; k.usados_no_dia := 0; end if;
  v_n := least(greatest(coalesce(p_limite, 10), 1), k.limite_por_minuto, k.limite_diario - k.usados_no_dia);
  if v_n <= 0 then
    update public.campanhas_controle set dia_controle = k.dia_controle, usados_no_dia = k.usados_no_dia, atualizada_em = now();
    return;
  end if;

  select array_agg(s.id) into v_ids from (
    select d.id from public.campanha_destinatarios d join public.campanhas c on c.id = d.campanha_id
     where c.estado = 'enviando' and d.estado = 'pendente' and d.proxima_tentativa <= now()
     order by c.iniciada_em, d.criada_em, d.id for update of d skip locked limit v_n) s;
  if v_ids is null then
    update public.campanhas_controle set dia_controle = k.dia_controle, usados_no_dia = k.usados_no_dia, atualizada_em = now();
    return;
  end if;

  update public.campanha_destinatarios d set estado = 'processando', lease_token = gen_random_uuid(), lease_expira_em = now() + interval '5 minutes',
         tentativas = d.tentativas + 1, reivindicado_em = now()
   where d.id = any (v_ids);
  get diagnostics v_pegos = row_count;

  -- Ritmo: reservar o tempo que esse lote consome do limite por minuto.
  update public.campanhas_controle set dia_controle = k.dia_controle, usados_no_dia = k.usados_no_dia + v_pegos,
         proximo_disparo_em = now() + (v_pegos::numeric / k.limite_por_minuto) * interval '1 minute', atualizada_em = now();

  return query select d.id, d.campanha_id, d.contato_id, d.whatsapp, d.valores, d.lease_token, c.modelo_id, c.modelo_nome, c.modelo_idioma, d.pedido_id, d.tentativas
    from public.campanha_destinatarios d join public.campanhas c on c.id = d.campanha_id where d.id = any (v_ids) order by d.criada_em, d.id;
end;
$$;

-- Reserva: confere TUDO de novo no último instante (campanha ainda enviando, consentimento ainda ativo)
-- e grava a mensagem na conversa. Repetir a chamada devolve a mesma mensagem.
CREATE FUNCTION public.campanha_reservar(p_destinatario uuid, p_token uuid, p_texto text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare d public.campanha_destinatarios; c public.campanhas; v_ativo boolean; v_msg uuid;
begin
  select * into d from public.campanha_destinatarios where id = p_destinatario for update;
  if d.id is null or d.estado <> 'processando' or d.lease_token is distinct from p_token then
    return jsonb_build_object('ok', false, 'motivo', 'lease_invalida');
  end if;
  select * into c from public.campanhas where id = d.campanha_id;
  if c.estado <> 'enviando' then
    -- Pausada: volta para a fila. Cancelada ou concluída: não sai.
    update public.campanha_destinatarios set estado = case when c.estado = 'pausada' then 'pendente' else 'cancelado' end,
           lease_token = null, lease_expira_em = null, finalizado_em = case when c.estado = 'pausada' then null else now() end where id = d.id;
    return jsonb_build_object('ok', false, 'motivo', 'campanha_' || c.estado);
  end if;
  select ativo into v_ativo from public.marketing_consentimentos where contato_id = d.contato_id;
  if v_ativo is distinct from true then
    update public.campanha_destinatarios set estado = 'ignorado', erro = 'Sem consentimento ativo no momento do envio.', lease_token = null, lease_expira_em = null, finalizado_em = now() where id = d.id;
    perform public.campanha_fechar_se_terminou(d.campanha_id);
    return jsonb_build_object('ok', false, 'motivo', 'sem_consentimento');
  end if;
  if p_texto is null or btrim(p_texto) = '' then raise exception 'Texto da mensagem ausente.' using errcode = '22023'; end if;

  insert into public.mensagens_whatsapp(contato_id, autor, tipo, conteudo, provedor, estado_envio, origem_envio, lida, pedido_id, campanha_id)
  values (d.contato_id, 'agente', 'texto', p_texto, 'meta', 'pendente', 'campanha', true, d.pedido_id, d.campanha_id)
  on conflict (pedido_id) do nothing returning id into v_msg;
  if v_msg is null then select id into v_msg from public.mensagens_whatsapp where pedido_id = d.pedido_id; end if;
  update public.campanha_destinatarios set mensagem_id = v_msg, reservado_em = coalesce(reservado_em, now()) where id = d.id;
  return jsonb_build_object('ok', true, 'mensagem_id', v_msg);
end;
$$;

-- Ponto sem volta: a partir daqui, qualquer dúvida sobre o resultado é INCERTO, nunca reenvio.
CREATE FUNCTION public.campanha_marcar_chamada(p_destinatario uuid, p_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  update public.campanha_destinatarios set chamada_iniciada_em = now(), lease_expira_em = now() + interval '5 minutes'
   where id = p_destinatario and estado = 'processando' and lease_token = p_token and reservado_em is not null;
  return found;
end;
$$;

CREATE FUNCTION public.campanha_finalizar(p_destinatario uuid, p_token uuid, p_resultado text, p_id_externo text DEFAULT NULL,
                                          p_erro text DEFAULT NULL, p_repetir_em interval DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare d public.campanha_destinatarios; v_estado text;
begin
  if p_resultado not in ('aceito','retido','falhou','incerto','repetir') then raise exception 'Resultado inválido.' using errcode = '22023'; end if;
  select * into d from public.campanha_destinatarios where id = p_destinatario for update;
  if d.id is null or d.estado <> 'processando' or d.lease_token is distinct from p_token then raise exception 'Reserva inválida ou vencida.' using errcode = '55000'; end if;

  -- Repetir (limite temporário da Meta, ou falha antes da chamada) tem teto: na 5ª tentativa vira falha.
  if p_resultado = 'repetir' and d.tentativas >= 5 then p_resultado := 'falhou'; p_erro := coalesce(p_erro, 'Muitas tentativas.'); end if;

  if p_resultado = 'repetir' then
    update public.campanha_destinatarios set estado = 'pendente', erro = left(p_erro, 500), lease_token = null, lease_expira_em = null,
           chamada_iniciada_em = null, proxima_tentativa = now() + coalesce(p_repetir_em, interval '5 minutes') where id = d.id;
    return;
  end if;

  v_estado := p_resultado;
  update public.campanha_destinatarios set estado = v_estado, erro = left(p_erro, 500), lease_token = null, lease_expira_em = null,
         aceito_em = case when v_estado in ('aceito','retido') then now() end, finalizado_em = now() where id = d.id;
  if d.mensagem_id is not null then
    update public.mensagens_whatsapp set id_externo = coalesce(id_externo, p_id_externo),
           estado_envio = case v_estado when 'aceito' then 'enviado' when 'retido' then 'pendente' when 'incerto' then 'incerto' else 'falhou' end,
           erro_envio = case when v_estado in ('falhou','incerto') then left(coalesce(p_erro, 'Falha no envio.'), 500) end
     where id = d.mensagem_id;
  end if;
  perform public.campanha_fechar_se_terminou(d.campanha_id);
end;
$$;

-- Pausa feita pelo próprio sistema (modelo reprovado/alterado na Meta, número com problema): o gestor
-- vê o motivo na campanha e decide. Só o servidor chama.
CREATE FUNCTION public.campanha_pausar_sistema(p_campanha uuid, p_motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  update public.campanhas set estado = 'pausada', pausada_em = now(), motivo = left(btrim(p_motivo), 500) where id = p_campanha and estado = 'enviando';
  if found then insert into public.campanha_eventos(campanha_id, tipo, descricao) values (p_campanha, 'pausada_automatica', left(btrim(p_motivo), 500)); end if;
end;
$$;

-- Recibo da Meta (enviado/entregue/lido/falhou), em ordem monotônica: um recibo atrasado nunca desfaz um mais novo.
CREATE FUNCTION public.campanha_status_meta(p_id_externo text, p_status text, p_erro text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare m public.mensagens_whatsapp; v_novo text; v_ordem integer; v_antes integer;
begin
  select * into m from public.mensagens_whatsapp where provedor = 'meta' and id_externo = p_id_externo for update;
  if m.id is null then return false; end if;
  v_novo := case p_status when 'sent' then 'enviado' when 'delivered' then 'entregue' when 'read' then 'lido' when 'failed' then 'falhou' end;
  if v_novo is null then return true; end if;
  v_ordem := case v_novo when 'lido' then 4 when 'entregue' then 3 when 'falhou' then 2 else 1 end;
  v_antes := case m.estado_envio when 'lido' then 4 when 'entregue' then 3 when 'falhou' then 2 when 'enviado' then 1 else 0 end;
  if v_ordem >= v_antes then
    update public.mensagens_whatsapp set estado_envio = v_novo, erro_envio = case when v_novo = 'falhou' then left(p_erro, 500) end where id = m.id;
    update public.campanha_destinatarios set estado = v_novo, erro = case when v_novo = 'falhou' then left(p_erro, 500) end,
           finalizado_em = coalesce(finalizado_em, now())
     where mensagem_id = m.id and estado in ('aceito','retido','enviado','entregue','lido','incerto');
  end if;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Painel: uma linha por campanha, com os números
-- ---------------------------------------------------------------------------
CREATE VIEW public.campanhas_lista WITH (security_invoker = true) AS
SELECT c.id, c.nome, c.objetivo, c.estado, c.modelo_nome, c.criada_em, c.iniciada_em, c.concluida_em, c.motivo, c.revisao_hash,
  count(d.id) FILTER (WHERE d.apto) AS aptos,
  count(d.id) FILTER (WHERE NOT d.apto) AS excluidos,
  count(d.id) FILTER (WHERE d.estado IN ('pendente','processando')) AS na_fila,
  count(d.id) FILTER (WHERE d.estado IN ('aceito','retido','enviado','entregue','lido')) AS aceitos,
  count(d.id) FILTER (WHERE d.estado IN ('entregue','lido')) AS entregues,
  count(d.id) FILTER (WHERE d.estado = 'lido') AS lidos,
  count(d.id) FILTER (WHERE d.estado = 'falhou') AS falhas,
  count(d.id) FILTER (WHERE d.estado = 'incerto') AS incertos
FROM public.campanhas c LEFT JOIN public.campanha_destinatarios d ON d.campanha_id = c.id
GROUP BY c.id;

-- ---------------------------------------------------------------------------
-- Acesso: a equipe lê; só o gestor configura; o servidor faz o resto
-- ---------------------------------------------------------------------------
ALTER TABLE public.marketing_consentimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_preferencias_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campanhas_controle ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campanhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campanha_destinatarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campanha_eventos ENABLE ROW LEVEL SECURITY;
CREATE POLICY equipe_leitura ON public.marketing_consentimentos FOR SELECT TO authenticated USING (true);
CREATE POLICY equipe_leitura ON public.marketing_preferencias_eventos FOR SELECT TO authenticated USING (true);
CREATE POLICY equipe_leitura ON public.campanhas_controle FOR SELECT TO authenticated USING (true);
CREATE POLICY gestor_atualiza ON public.campanhas_controle FOR UPDATE TO authenticated USING (public.usuario_e_gestor()) WITH CHECK (public.usuario_e_gestor());
CREATE POLICY equipe_leitura ON public.campanhas FOR SELECT TO authenticated USING (true);
CREATE POLICY gestor_cria ON public.campanhas FOR INSERT TO authenticated WITH CHECK (public.usuario_e_gestor());
CREATE POLICY gestor_atualiza ON public.campanhas FOR UPDATE TO authenticated USING (public.usuario_e_gestor()) WITH CHECK (public.usuario_e_gestor());
CREATE POLICY gestor_apaga ON public.campanhas FOR DELETE TO authenticated USING (public.usuario_e_gestor());
CREATE POLICY equipe_leitura ON public.campanha_destinatarios FOR SELECT TO authenticated USING (true);
CREATE POLICY equipe_leitura ON public.campanha_eventos FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.marketing_consentimentos, public.marketing_preferencias_eventos, public.campanhas_controle, public.campanhas,
  public.campanha_destinatarios, public.campanha_eventos, public.campanhas_lista FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.marketing_consentimentos, public.marketing_preferencias_eventos, public.campanhas_controle, public.campanhas,
  public.campanha_destinatarios, public.campanha_eventos, public.campanhas_lista TO authenticated;
GRANT INSERT (nome, objetivo, modelo_id, modelo_nome, modelo_idioma, modelo_snapshot, mapeamento_parametros, filtros_publico, limite_destinatarios, intervalo_minimo_horas)
  ON public.campanhas TO authenticated;
GRANT UPDATE (nome, objetivo, modelo_id, modelo_nome, modelo_idioma, modelo_snapshot, mapeamento_parametros, filtros_publico, limite_destinatarios, intervalo_minimo_horas)
  ON public.campanhas TO authenticated;
GRANT DELETE ON public.campanhas TO authenticated;
GRANT UPDATE (pausado, pausa_motivo, limite_por_minuto, limite_diario) ON public.campanhas_controle TO authenticated;
GRANT ALL ON public.marketing_consentimentos, public.marketing_preferencias_eventos, public.campanhas_controle, public.campanhas,
  public.campanha_destinatarios, public.campanha_eventos TO service_role;
GRANT SELECT ON public.campanhas_lista TO service_role;

-- Funções: as da tela (gestor) ficam para a equipe autenticada; as da fila, só para o servidor.
REVOKE EXECUTE ON FUNCTION public.campanha_reivindicar(integer), public.campanha_reservar(uuid, uuid, text), public.campanha_marcar_chamada(uuid, uuid),
  public.campanha_finalizar(uuid, uuid, text, text, text, interval), public.campanha_status_meta(text, text, text), public.campanha_fechar_se_terminou(uuid),
  public.campanha_pausar_sistema(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.campanha_reivindicar(integer), public.campanha_reservar(uuid, uuid, text), public.campanha_marcar_chamada(uuid, uuid),
  public.campanha_finalizar(uuid, uuid, text, text, text, interval), public.campanha_status_meta(text, text, text), public.campanha_fechar_se_terminou(uuid),
  public.campanha_pausar_sistema(uuid, text)
  TO service_role;
REVOKE EXECUTE ON FUNCTION public.campanha_congelar_publico(uuid), public.campanha_iniciar(uuid, text), public.campanha_pausar(uuid, text),
  public.campanha_retomar(uuid), public.campanha_cancelar(uuid, text), public.marketing_registrar_preferencia(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.campanha_congelar_publico(uuid), public.campanha_iniciar(uuid, text), public.campanha_pausar(uuid, text),
  public.campanha_retomar(uuid), public.campanha_cancelar(uuid, text), public.marketing_registrar_preferencia(uuid, boolean, text) TO authenticated, service_role;

ALTER PUBLICATION supabase_realtime ADD TABLE public.campanhas;

INSERT INTO crm_base_private.schema_migrations(version) VALUES ('0010_modulo_campanhas');
NOTIFY pgrst, 'reload schema';
COMMIT;
