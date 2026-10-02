BEGIN;
-- Esquema inicial da base. Derivado do esquema final do Arc CRM (projeto
-- jfbswfhubiebisbefufi), não do caminho histórico clínica -> agência: sem
-- marca, sem dado de cliente, sem colunas mortas (ver ORIGEM.md/PLANO_BASE.md).
-- Núcleo apenas: usuários e papéis, contatos, oportunidades, histórico,
-- agenda e dashboard. Conversas, campanhas, agente de IA e projetos de
-- entrega são módulos futuros e não têm tabela aqui.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS crm_base_private;
REVOKE ALL ON SCHEMA crm_base_private FROM PUBLIC, anon, authenticated;
CREATE TABLE crm_base_private.schema_migrations (
  version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- 1. USUÁRIOS E PAPÉIS
-- =============================================================================
CREATE TABLE public.profissionais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL, sobrenome text NOT NULL DEFAULT '',
  cor text NOT NULL DEFAULT '#1E6E8C' CHECK (cor ~ '^#[0-9A-Fa-f]{6}$'),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profissionais_ativo_idx ON public.profissionais(ativo, nome);

CREATE TABLE public.usuarios (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome text NOT NULL DEFAULT '', avatar_url text,
  papel text NOT NULL DEFAULT 'consultor' CHECK (papel IN ('gestor','consultor')),
  ativo boolean NOT NULL DEFAULT true,
  profissional_id uuid REFERENCES public.profissionais(id) ON DELETE SET NULL,
  convidado_em timestamptz, ultimo_acesso_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX usuarios_profissional_unico ON public.usuarios(profissional_id) WHERE profissional_id IS NOT NULL;

-- A primeira conta autenticada vira gestora por necessidade: sem isso, não
-- haveria quem convidasse a segunda.
CREATE FUNCTION public.usuario_e_gestor(p_usuario uuid DEFAULT auth.uid()) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS(SELECT 1 FROM public.usuarios WHERE id = p_usuario AND papel = 'gestor' AND ativo);
$$;

CREATE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_papel text := lower(trim(coalesce(new.raw_user_meta_data ->> 'papel', '')));
begin
  if v_papel not in ('gestor','consultor') then v_papel := 'consultor'; end if;
  if not exists (select 1 from public.usuarios where papel = 'gestor' and ativo) then v_papel := 'gestor'; end if;
  insert into public.usuarios (id, nome, papel) values (new.id, coalesce(new.raw_user_meta_data ->> 'nome', ''), v_papel);
  return new;
end;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE FUNCTION public.usuarios_proteger_ultimo_gestor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_restantes integer;
begin
  if not (old.papel = 'gestor' and old.ativo) then return case tg_op when 'DELETE' then old else new end; end if;
  if tg_op = 'UPDATE' and new.papel = 'gestor' and new.ativo then return new; end if;
  select count(*) into v_restantes from public.usuarios where papel = 'gestor' and ativo and id <> old.id;
  if v_restantes = 0 then
    raise exception 'A base precisa de pelo menos um gestor ativo.' using errcode = '23514';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$$;
CREATE TRIGGER usuarios_ultimo_gestor BEFORE DELETE OR UPDATE ON public.usuarios
  FOR EACH ROW EXECUTE FUNCTION public.usuarios_proteger_ultimo_gestor();

-- Varre dinamicamente toda FK apontando para usuarios/auth.users: continua
-- correta mesmo depois que módulos futuros adicionarem novas tabelas.
CREATE FUNCTION public.usuario_tem_historico(p_usuario uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
declare v_ref record; v_existe boolean;
begin
  for v_ref in
    select n.nspname as esquema, t.relname as tabela, a.attname as coluna
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_class t on t.oid = c.conrelid
      join pg_catalog.pg_namespace n on n.oid = t.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid = t.oid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.confrelid in ('auth.users'::regclass, 'public.usuarios'::regclass)
       and array_length(c.conkey, 1) = 1 and n.nspname <> 'auth'
       and not (n.nspname = 'public' and t.relname = 'usuarios' and a.attname = 'id')
  loop
    execute format('select exists(select 1 from %I.%I where %I = $1)', v_ref.esquema, v_ref.tabela, v_ref.coluna)
      into v_existe using p_usuario;
    if v_existe then return true; end if;
  end loop;
  if exists (select 1 from public.oportunidade_eventos where usuario_id = p_usuario) then return true; end if;
  return false;
end;
$$;
CREATE FUNCTION public.usuarios_bloquear_exclusao_com_historico() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
begin
  if public.usuario_tem_historico(old.id) then
    raise exception 'Esta conta possui histórico no CRM. Desligue-a para preservar a autoria.' using errcode = '23503';
  end if;
  return old;
end;
$$;
CREATE TRIGGER usuarios_bloquear_exclusao_com_historico BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.usuarios_bloquear_exclusao_com_historico();

CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
begin new.updated_at = now(); return new; end;
$$;
CREATE TRIGGER profissionais_updated_at BEFORE UPDATE ON public.profissionais FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- 2. CATÁLOGO E CONFIGURAÇÃO DO NEGÓCIO
-- =============================================================================
CREATE TABLE public.catalogo_servicos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL, descricao text NOT NULL DEFAULT '', descricao_longa text,
  ativo boolean NOT NULL DEFAULT true, arquivado boolean NOT NULL DEFAULT false,
  exige_reuniao_previa boolean NOT NULL DEFAULT true, e_reuniao_previa boolean NOT NULL DEFAULT false,
  preco_a_partir_de numeric, duracao_minutos integer NOT NULL DEFAULT 60,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX catalogo_servicos_created_at_idx ON public.catalogo_servicos(created_at);
-- No máximo um serviço marca "é a reunião prévia": é para onde a agenda
-- redireciona quando o serviço pedido exige reunião prévia.
CREATE UNIQUE INDEX catalogo_servicos_reuniao_previa_unica ON public.catalogo_servicos(e_reuniao_previa) WHERE e_reuniao_previa;

CREATE FUNCTION public.servico_existe(p_nome text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS(SELECT 1 FROM public.catalogo_servicos WHERE lower(trim(nome)) = lower(trim(p_nome)));
$$;

CREATE TABLE public.configuracoes_negocio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_negocio text, logo_url text,
  fuso_horario text NOT NULL DEFAULT 'America/Sao_Paulo',
  endereco text, bairro text, cidade text,
  estado text CHECK (estado IS NULL OR estado = ANY (ARRAY['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'])),
  cep text CHECK (cep IS NULL OR cep ~ '^\d{8}$'),
  google_maps_url text, instagram_url text, site_url text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX configuracoes_negocio_singleton ON public.configuracoes_negocio((true));
CREATE TRIGGER configuracoes_negocio_updated_at BEFORE UPDATE ON public.configuracoes_negocio FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.horario_comercial (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dia_semana smallint NOT NULL UNIQUE CHECK (dia_semana BETWEEN 0 AND 6),
  hora_inicio time NOT NULL, hora_fim time NOT NULL, ativo boolean NOT NULL DEFAULT true
);

CREATE TABLE public.profissional_horarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profissional_id uuid NOT NULL REFERENCES public.profissionais(id) ON DELETE CASCADE,
  dia_semana smallint NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  hora_inicio time NOT NULL, hora_fim time NOT NULL CHECK (hora_fim > hora_inicio),
  ativo boolean NOT NULL DEFAULT true,
  UNIQUE(profissional_id, dia_semana)
);
CREATE INDEX profissional_horarios_prof_idx ON public.profissional_horarios(profissional_id);

CREATE TABLE public.profissional_bloqueios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profissional_id uuid REFERENCES public.profissionais(id) ON DELETE CASCADE,
  inicio timestamptz NOT NULL, fim timestamptz NOT NULL CHECK (fim > inicio),
  motivo text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profissional_bloqueios_prof_idx ON public.profissional_bloqueios(profissional_id, inicio);
CREATE INDEX profissional_bloqueios_periodo_idx ON public.profissional_bloqueios(inicio, fim);

CREATE FUNCTION public.dentro_da_jornada(p_profissional uuid, p_inicio timestamptz, p_duracao integer) RETURNS boolean
LANGUAGE sql STABLE AS $$
  with cfg as (select coalesce(max(fuso_horario), 'America/Sao_Paulo') as fuso from public.configuracoes_negocio),
  quando as (select (p_inicio at time zone c.fuso) as local from cfg c)
  select exists (
    select 1 from public.profissional_horarios h cross join quando q
     where h.profissional_id = p_profissional and h.ativo
       and h.dia_semana = extract(dow from q.local)::smallint
       and extract(epoch from q.local::time) >= extract(epoch from h.hora_inicio)
       and extract(epoch from q.local::time) + (p_duracao * 60) <= extract(epoch from h.hora_fim)
  );
$$;

CREATE FUNCTION public.jornada_texto(p_profissional uuid DEFAULT NULL) RETURNS text
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  with dias as (
    select case when h.dia_semana = 0 then 7 else h.dia_semana end as ordem, h.dia_semana, h.hora_inicio, h.hora_fim
      from public.horario_comercial h where p_profissional is null and h.ativo
    union all
    select case when j.dia_semana = 0 then 7 else j.dia_semana end as ordem, j.dia_semana, j.hora_inicio, j.hora_fim
      from public.profissional_horarios j where j.profissional_id = p_profissional and j.ativo
  ),
  ilhas as (select d.*, d.ordem - (row_number() over (partition by d.hora_inicio, d.hora_fim order by d.ordem))::int as grupo from dias d),
  faixas as (
    select min(i.ordem) as ini_ordem, (array_agg(i.dia_semana order by i.ordem))[1] as dia_ini,
           (array_agg(i.dia_semana order by i.ordem desc))[1] as dia_fim, i.hora_inicio, i.hora_fim
      from ilhas i group by i.grupo, i.hora_inicio, i.hora_fim
  )
  select string_agg(
    case when f.dia_ini = f.dia_fim then (array['domingo','segunda','terça','quarta','quinta','sexta','sábado'])[f.dia_ini + 1]
    else (array['domingo','segunda','terça','quarta','quinta','sexta','sábado'])[f.dia_ini + 1]
      || ' a ' || (array['domingo','segunda','terça','quarta','quinta','sexta','sábado'])[f.dia_fim + 1] end
    || ' das ' || substring(f.hora_inicio::text from 1 for 5) || ' às ' || substring(f.hora_fim::text from 1 for 5),
    ', ' order by f.ini_ordem)
  from faixas f;
$$;

-- =============================================================================
-- 3. CONTATOS
-- =============================================================================
CREATE TABLE public.contatos_dados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text, whatsapp text, empresa text, email text,
  anotacoes text, resumo_conversa text,
  interesses text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'novo_lead'
    CHECK (status = ANY (ARRAY['novo_lead','qualificacao','diagnostico','diagnostico_realizado','proposta','negociacao','ganho','perdido'])),
  inicio_atendimento timestamptz DEFAULT now(), ultima_mensagem timestamptz,
  -- cliente_desde: somente leitura, mantido por resumir_contato a partir das oportunidades.
  cliente_desde timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX contatos_whatsapp_unico ON public.contatos_dados(whatsapp) WHERE whatsapp IS NOT NULL;
CREATE INDEX contatos_created_at_idx ON public.contatos_dados(created_at DESC);
CREATE INDEX contatos_status_idx ON public.contatos_dados(status);
CREATE INDEX contatos_inicio_idx ON public.contatos_dados(inicio_atendimento);

CREATE FUNCTION public.normalizar_whatsapp() RETURNS trigger LANGUAGE plpgsql AS $$
begin
  if new.whatsapp is not null then new.whatsapp := nullif(regexp_replace(new.whatsapp, '[^0-9]', '', 'g'), ''); end if;
  return new;
end;
$$;
CREATE TRIGGER contatos_normaliza_whatsapp BEFORE INSERT OR UPDATE OF whatsapp ON public.contatos_dados
  FOR EACH ROW EXECUTE FUNCTION public.normalizar_whatsapp();

CREATE FUNCTION public.valida_interesses() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_item text;
begin
  if new.interesses is null then new.interesses := '{}'; return new; end if;
  foreach v_item in array new.interesses loop
    if not public.servico_existe(v_item) then
      raise exception 'serviço fora do catálogo: %. Cadastre em catalogo_servicos antes.', v_item using errcode = '23514';
    end if;
  end loop;
  -- Grava sempre o nome exato do catálogo, para não duplicar linha por causa
  -- de maiúscula/espaço.
  select coalesce(array_agg(distinct s.nome order by s.nome), '{}') into new.interesses
    from public.catalogo_servicos s where lower(trim(s.nome)) in (select lower(trim(x)) from unnest(new.interesses) x);
  return new;
end;
$$;
CREATE TRIGGER contatos_interesses_validos BEFORE INSERT OR UPDATE OF interesses ON public.contatos_dados
  FOR EACH ROW EXECUTE FUNCTION public.valida_interesses();

CREATE FUNCTION public.proteger_resumo() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'novo_lead' or new.cliente_desde is not null then
      raise exception 'Cadastre o contato e registre a venda em oportunidades.';
    end if;
  elsif pg_trigger_depth() = 1 and row(new.status,new.cliente_desde) is distinct from row(old.status,old.cliente_desde) then
    raise exception 'Edite a oportunidade: o resumo comercial do contato é somente leitura.';
  end if;
  return new;
end;
$$;
CREATE TRIGGER contatos_protege_resumo BEFORE INSERT OR UPDATE ON public.contatos_dados
  FOR EACH ROW EXECUTE FUNCTION public.proteger_resumo();

-- =============================================================================
-- 4. OPORTUNIDADES E HISTÓRICO
-- =============================================================================
CREATE TABLE public.oportunidades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_id uuid NOT NULL REFERENCES public.contatos_dados(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'novo_lead'
    CHECK (status = ANY (ARRAY['novo_lead','qualificacao','diagnostico','diagnostico_realizado','proposta','negociacao','ganho','perdido'])),
  valor_proposta numeric CHECK (valor_proposta >= 0),
  servicos_contratados text[] NOT NULL DEFAULT '{}', escopo text NOT NULL DEFAULT '',
  origem text NOT NULL DEFAULT 'contato_direto' CHECK (origem = ANY (ARRAY['anuncio','indicacao','contato_direto'])),
  motivo_perda text CHECK (motivo_perda = ANY (ARRAY['sem_orcamento','nao_e_o_momento','escolheu_outra','parou_de_responder','nao_decide','sem_perfil'])),
  retomar_em date, faltou_em timestamptz,
  fechado_em timestamptz, cancelado_em timestamptz, motivo_cancelamento text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id, contato_id),
  CHECK (cancelado_em IS NULL OR (status = 'perdido' AND fechado_em IS NOT NULL AND motivo_cancelamento IS NOT NULL AND length(trim(motivo_cancelamento)) >= 5))
);
CREATE INDEX oportunidades_contato_idx ON public.oportunidades(contato_id, created_at);
CREATE INDEX oportunidades_fechamento_idx ON public.oportunidades(fechado_em) WHERE status = 'ganho';
CREATE INDEX oportunidades_retomar_idx ON public.oportunidades(retomar_em) WHERE retomar_em IS NOT NULL;

CREATE TABLE public.oportunidade_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oportunidade_id uuid NOT NULL REFERENCES public.oportunidades(id) ON DELETE CASCADE,
  status_anterior text, status_novo text NOT NULL, motivo text, usuario_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.rotulo_perda(p_motivo text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE p_motivo
    WHEN 'sem_orcamento' THEN 'Sem orçamento' WHEN 'nao_e_o_momento' THEN 'Não é o momento'
    WHEN 'escolheu_outra' THEN 'Escolheu outra solução' WHEN 'parou_de_responder' THEN 'Parou de responder'
    WHEN 'nao_decide' THEN 'Não é quem decide' WHEN 'sem_perfil' THEN 'Não tem o perfil'
  END
$$;

-- Contato novo sempre recebe uma oportunidade inicial (não há base de
-- prospecção sem oportunidade: isso é do módulo campanhas).
CREATE FUNCTION public.contato_inicial() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
begin
  insert into oportunidades(contato_id, nome, status)
  values (new.id, left(coalesce(nullif(new.empresa,''), nullif(new.nome,''), 'Contato') || ' — oportunidade inicial', 160), 'novo_lead');
  return new;
end;
$$;
CREATE TRIGGER contato_inicial AFTER INSERT ON public.contatos_dados FOR EACH ROW EXECUTE FUNCTION public.contato_inicial();

CREATE FUNCTION public.resumir_contato(p_contato uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  update public.contatos_dados d set
    cliente_desde = coalesce(d.cliente_desde, (select min(fechado_em) from oportunidades where contato_id = p_contato)),
    status = case when d.cliente_desde is not null or exists(select 1 from oportunidades where contato_id = p_contato and fechado_em is not null) then 'ganho'
      else coalesce((select status from oportunidades where contato_id = p_contato order by created_at desc, id limit 1), 'novo_lead') end
  where d.id = p_contato;
end;
$$;

CREATE FUNCTION public.validar_oportunidade() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
declare item text;
begin
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    if new.id <> old.id then raise exception 'O identificador não pode ser alterado.'; end if;
    if new.contato_id <> old.contato_id then raise exception 'Não é permitido transferir uma oportunidade entre contatos.'; end if;
    if old.fechado_em is not null then
      if row(new.nome,new.valor_proposta,new.servicos_contratados,new.escopo) is distinct from row(old.nome,old.valor_proposta,old.servicos_contratados,old.escopo) then
        raise exception 'Venda encerrada: preserve o histórico e crie uma nova oportunidade.';
      end if;
      if new.status <> old.status and not (old.status = 'ganho' and new.status = 'perdido' and length(trim(coalesce(new.motivo_cancelamento,''))) >= 5) then
        raise exception 'Para cancelar uma venda, informe o motivo. Uma nova compra exige outra oportunidade.';
      end if;
      new.fechado_em := old.fechado_em;
      new.cancelado_em := case when old.status = 'ganho' and new.status = 'perdido' then now() else old.cancelado_em end;
      if new.cancelado_em is not distinct from old.cancelado_em then new.motivo_cancelamento := old.motivo_cancelamento; end if;
      new.motivo_perda := old.motivo_perda; new.updated_at := clock_timestamp();
      return new;
    end if;
  end if;
  foreach item in array new.servicos_contratados loop
    if not exists(select 1 from public.catalogo_servicos where nome = item and ativo and not arquivado and not e_reuniao_previa) then
      raise exception 'Escolha serviços ativos do catálogo para a contratação.';
    end if;
  end loop;
  select coalesce(array_agg(distinct s order by s), '{}') into new.servicos_contratados from unnest(new.servicos_contratados) s;
  if new.status = 'ganho' and (new.valor_proposta is null or cardinality(new.servicos_contratados) = 0) then
    raise exception 'Informe o valor e os serviços contratados antes de marcar Ganho.';
  end if;
  if new.status = 'perdido' then
    if new.motivo_perda is null and (tg_op = 'INSERT' or old.status <> 'perdido') then raise exception 'Informe o motivo da perda.'; end if;
    if new.motivo_perda = 'nao_e_o_momento' and new.retomar_em is null then raise exception 'Informe quando retomar o contato.'; end if;
  else
    new.motivo_perda := null;
  end if;
  if new.status not in ('novo_lead','qualificacao') then new.faltou_em := null; end if;
  new.fechado_em := case when new.status = 'ganho' then now() end;
  new.cancelado_em := null; new.motivo_cancelamento := null; new.updated_at := clock_timestamp();
  return new;
end;
$$;
CREATE TRIGGER oportunidade_validar BEFORE INSERT OR UPDATE ON public.oportunidades FOR EACH ROW EXECUTE FUNCTION public.validar_oportunidade();

CREATE FUNCTION public.apos_oportunidade() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if tg_op = 'DELETE' then perform resumir_contato(old.contato_id); return old; end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into oportunidade_eventos(oportunidade_id, status_anterior, status_novo, motivo, usuario_id)
    values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status,
      coalesce(new.motivo_cancelamento, rotulo_perda(new.motivo_perda),
        case when new.faltou_em is not null and (tg_op = 'INSERT' or old.faltou_em is null) then 'Faltou ao diagnóstico' end),
      auth.uid());
  end if;
  perform resumir_contato(new.contato_id);
  return new;
end;
$$;
CREATE TRIGGER oportunidade_apos AFTER INSERT OR DELETE OR UPDATE ON public.oportunidades FOR EACH ROW EXECUTE FUNCTION public.apos_oportunidade();

-- Brecha consciente: service_role (auth.uid() nulo) segue liberado, para
-- funções de borda e trabalhadores; só a sessão de um usuário exige gestor.
CREATE FUNCTION public.cancelamento_so_gestor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if new.cancelado_em is null or old.cancelado_em is not null then return new; end if;
  if auth.uid() is null then return new; end if;
  if not public.usuario_e_gestor() then
    raise exception 'Somente um gestor pode cancelar uma venda ganha.' using errcode = '42501';
  end if;
  return new;
end;
$$;
CREATE TRIGGER oportunidades_cancelamento_gestor BEFORE UPDATE ON public.oportunidades FOR EACH ROW EXECUTE FUNCTION public.cancelamento_so_gestor();

-- =============================================================================
-- 5. AGENDA (REUNIÕES)
-- =============================================================================
CREATE TABLE public.reunioes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_id uuid NOT NULL REFERENCES public.contatos_dados(id) ON DELETE CASCADE,
  oportunidade_id uuid, profissional_id uuid REFERENCES public.profissionais(id) ON DELETE RESTRICT,
  assunto text NOT NULL, interesse text,
  data_reuniao timestamptz NOT NULL, duracao_minutos integer NOT NULL DEFAULT 60 CHECK (duracao_minutos > 0 AND duracao_minutos <= 600),
  data_fim timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'agendada' CHECK (status = ANY (ARRAY['agendada','realizada','cancelada','faltou'])),
  origem text NOT NULL DEFAULT 'equipe' CHECK (origem = ANY (ARRAY['equipe','agente_ia'])),
  chave_externa text, cancelado_em timestamptz, motivo_cancelamento text, observacoes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (oportunidade_id, contato_id) REFERENCES public.oportunidades(id, contato_id)
);
CREATE UNIQUE INDEX reunioes_chave_externa_idx ON public.reunioes(chave_externa) WHERE chave_externa IS NOT NULL;
CREATE INDEX reunioes_contato_data_idx ON public.reunioes(contato_id, data_reuniao DESC);
CREATE INDEX reunioes_profissional_data_idx ON public.reunioes(profissional_id, data_reuniao);
CREATE INDEX reunioes_data_idx ON public.reunioes(data_reuniao);
ALTER TABLE public.reunioes ADD CONSTRAINT reunioes_sem_sobreposicao
  EXCLUDE USING gist (profissional_id WITH =, tstzrange(data_reuniao, data_fim) WITH &&)
  WHERE (status = 'agendada' AND profissional_id IS NOT NULL);

CREATE VIEW public.contatos WITH (security_invoker = true) AS
SELECT id, nome, whatsapp, interesses,
  nullif(array_to_string(interesses, ', '), '') AS interesses_texto,
  anotacoes, resumo_conversa, inicio_atendimento, ultima_mensagem, status,
  CASE WHEN ultima_mensagem IS NULL THEN NULL ELSE floor(extract(epoch FROM now() - ultima_mensagem) / 60)::integer END AS minutos_ultima_mensagem,
  (SELECT max(r.data_reuniao) FROM public.reunioes r WHERE r.contato_id = d.id AND r.status = 'realizada') AS ultima_reuniao,
  empresa, email, cliente_desde, created_at
FROM public.contatos_dados d;

CREATE TRIGGER reunioes_updated_at BEFORE UPDATE ON public.reunioes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE FUNCTION public.calcular_fim_reuniao() RETURNS trigger LANGUAGE plpgsql AS $$
begin new.data_fim := new.data_reuniao + make_interval(mins => new.duracao_minutos); return new; end;
$$;
CREATE TRIGGER reunioes_data_fim BEFORE INSERT OR UPDATE OF data_reuniao, duracao_minutos ON public.reunioes
  FOR EACH ROW EXECUTE FUNCTION public.calcular_fim_reuniao();

CREATE FUNCTION public.reuniao_valida_assunto() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if not public.servico_existe(new.assunto) then
    raise exception 'assunto fora do catálogo: %. Cadastre em catalogo_servicos antes.', new.assunto using errcode = '23514';
  end if;
  select s.nome into new.assunto from public.catalogo_servicos s where lower(trim(s.nome)) = lower(trim(new.assunto));
  if nullif(trim(coalesce(new.interesse,'')), '') is not null then
    if not public.servico_existe(new.interesse) then
      raise exception 'interesse fora do catálogo: %. Cadastre em catalogo_servicos antes.', new.interesse using errcode = '23514';
    end if;
    select s.nome into new.interesse from public.catalogo_servicos s where lower(trim(s.nome)) = lower(trim(new.interesse));
  end if;
  return new;
end;
$$;
CREATE TRIGGER reunioes_assunto_valido BEFORE INSERT OR UPDATE OF assunto, interesse ON public.reunioes
  FOR EACH ROW EXECUTE FUNCTION public.reuniao_valida_assunto();

CREATE FUNCTION public.reunioes_confere_jornada() RETURNS trigger LANGUAGE plpgsql AS $$
declare v_nome text;
begin
  if new.status <> 'agendada' or new.profissional_id is null then return new; end if;
  if public.dentro_da_jornada(new.profissional_id, new.data_reuniao, new.duracao_minutos) then return new; end if;
  select trim(nome || ' ' || sobrenome) into v_nome from public.profissionais where id = new.profissional_id;
  raise exception '% não atende neste dia e horário.', coalesce(nullif(v_nome,''), 'Esse profissional')
    using errcode = 'JOR01', hint = 'Escolha outro horário, outra agenda, ou ajuste a jornada em Profissionais.';
end;
$$;
CREATE TRIGGER reunioes_jornada BEFORE INSERT OR UPDATE OF data_reuniao, duracao_minutos, profissional_id, status ON public.reunioes
  FOR EACH ROW EXECUTE FUNCTION public.reunioes_confere_jornada();

-- Vincula à única oportunidade aberta do contato, se houver exatamente uma.
CREATE FUNCTION public.vincular_reuniao() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
declare ids uuid[];
begin
  if new.oportunidade_id is null and (tg_op = 'INSERT' or new.contato_id is distinct from old.contato_id) then
    select array_agg(id) into ids from oportunidades where contato_id = new.contato_id and status not in ('ganho','perdido');
    if cardinality(ids) = 1 then new.oportunidade_id := ids[1]; end if;
  end if;
  return new;
end;
$$;
CREATE TRIGGER reunioes_vinculo BEFORE INSERT OR UPDATE ON public.reunioes FOR EACH ROW EXECUTE FUNCTION public.vincular_reuniao();

CREATE FUNCTION public.reuniao_sincronizar_interesse() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_interesse text;
begin
  select s.nome into v_interesse from public.catalogo_servicos s
   where s.ativo and lower(trim(s.nome)) = lower(trim(new.interesse)) limit 1;
  if v_interesse is null then return new; end if;
  update public.contatos_dados d set interesses = array(
    select distinct x from unnest(coalesce(d.interesses,'{}') || array[v_interesse]) x where nullif(trim(x),'') is not null
  ) where d.id = new.contato_id and not (v_interesse = any(coalesce(d.interesses,'{}')));
  return new;
end;
$$;
CREATE TRIGGER reunioes_interesse AFTER INSERT OR UPDATE OF interesse, contato_id ON public.reunioes
  FOR EACH ROW EXECUTE FUNCTION public.reuniao_sincronizar_interesse();

-- Funil acompanha a agenda sozinho: marcada avança para diagnóstico,
-- realizada para diagnóstico_realizado, falta/cancelamento sem outra reunião
-- marcada devolve a qualificação.
CREATE FUNCTION public.reunioes_sincroniza_funil() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
begin
  if tg_op <> 'DELETE' and new.oportunidade_id is not null then
    if new.status = 'agendada' then
      update oportunidades set status = 'diagnostico', faltou_em = null
       where id = new.oportunidade_id and status in ('novo_lead','qualificacao');
    elsif new.status = 'realizada' then
      update oportunidades set status = 'diagnostico_realizado'
       where id = new.oportunidade_id and status in ('novo_lead','qualificacao','diagnostico');
    elsif new.status in ('faltou','cancelada') and tg_op = 'UPDATE' and old.status = 'agendada'
      and not exists (select 1 from reunioes r where r.oportunidade_id = new.oportunidade_id and r.status = 'agendada' and r.id <> new.id) then
      update oportunidades set status = 'qualificacao', faltou_em = case when new.status = 'faltou' then now() end
       where id = new.oportunidade_id and status = 'diagnostico';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
CREATE TRIGGER reunioes_sincroniza_funil AFTER INSERT OR DELETE OR UPDATE ON public.reunioes
  FOR EACH ROW EXECUTE FUNCTION public.reunioes_sincroniza_funil();

CREATE FUNCTION public.agenda_profissionais_livres(p_inicio timestamptz, p_duracao integer DEFAULT 60)
RETURNS TABLE(profissional_id uuid, nome text) LANGUAGE sql STABLE AS $$
  with janela as (select p_inicio as ini, p_inicio + make_interval(mins => p_duracao) as fim)
  select p.id, trim(p.nome || ' ' || p.sobrenome) from public.profissionais p cross join janela j
   where p.ativo and public.dentro_da_jornada(p.id, j.ini, p_duracao)
     and not exists (select 1 from public.reunioes r where r.profissional_id = p.id and r.status = 'agendada'
       and tstzrange(r.data_reuniao, r.data_fim) && tstzrange(j.ini, j.fim))
     and not exists (select 1 from public.profissional_bloqueios b where (b.profissional_id is null or b.profissional_id = p.id)
       and tstzrange(b.inicio, b.fim) && tstzrange(j.ini, j.fim))
   order by p.nome;
$$;

CREATE FUNCTION public.agenda_horarios_disponiveis(p_data date, p_profissional uuid DEFAULT NULL, p_duracao integer DEFAULT 60, p_passo integer DEFAULT 30)
RETURNS TABLE(horario timestamptz) LANGUAGE sql STABLE AS $$
  with cfg as (select coalesce(max(fuso_horario), 'America/Sao_Paulo') as fuso from public.configuracoes_negocio),
  jornada as (
    select h.profissional_id, h.hora_inicio, h.hora_fim from public.profissional_horarios h join public.profissionais p on p.id = h.profissional_id
     where h.ativo and p.ativo and h.dia_semana = extract(dow from p_data)::smallint and (p_profissional is null or h.profissional_id = p_profissional)
  ),
  slots as (
    select j.profissional_id, (s at time zone cfg.fuso) as inicio from jornada j cross join cfg
     cross join lateral generate_series((p_data + j.hora_inicio)::timestamp, (p_data + j.hora_fim)::timestamp - make_interval(mins => p_duracao), make_interval(mins => p_passo)) as s
  )
  select distinct s.inicio from slots s
   where s.inicio > now()
     and not exists (select 1 from public.reunioes r where r.profissional_id = s.profissional_id and r.status = 'agendada'
       and tstzrange(r.data_reuniao, r.data_fim) && tstzrange(s.inicio, s.inicio + make_interval(mins => p_duracao)))
     and not exists (select 1 from public.profissional_bloqueios b where (b.profissional_id is null or b.profissional_id = s.profissional_id)
       and tstzrange(b.inicio, b.fim) && tstzrange(s.inicio, s.inicio + make_interval(mins => p_duracao)))
   order by 1;
$$;

CREATE FUNCTION public.agenda_proxima_vaga(p_a_partir_de date, p_profissional uuid DEFAULT NULL, p_duracao integer DEFAULT 60) RETURNS timestamptz
LANGUAGE plpgsql STABLE AS $$
declare v_dia date; v_horario timestamptz;
begin
  for i in 0..60 loop
    v_dia := p_a_partir_de + i;
    select h.horario into v_horario from public.agenda_horarios_disponiveis(v_dia, p_profissional, p_duracao) h limit 1;
    if v_horario is not null then return v_horario; end if;
  end loop;
  return null;
end;
$$;

-- Porta de entrada da agenda: usada pela equipe e por integrações futuras
-- (agente de IA). Recusa de negócio (serviço fora do catálogo, exige reunião
-- prévia, fora de expediente) volta como `motivo`, nunca como exceção — quem
-- chama de fora precisa distinguir "não consegui" de "não pode".
CREATE FUNCTION public.agenda_marcar(
  p_nome text, p_whatsapp text, p_servico text, p_data_hora timestamptz,
  p_profissional_id uuid DEFAULT NULL, p_duracao integer DEFAULT NULL,
  p_chave_externa text DEFAULT NULL, p_interesse text DEFAULT NULL
) RETURNS TABLE(ok boolean, motivo text, reuniao_id uuid, data_hora timestamptz, profissional text, sugestao text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_whats text; v_contato uuid; v_prof uuid; v_nome text; v_id uuid; v_fuso text; v_serv record; v_porta text; v_dur integer;
begin
  if p_chave_externa is not null then
    select r.id, r.data_reuniao, trim(coalesce(pr.nome,'') || ' ' || coalesce(pr.sobrenome,''))
      into v_id, data_hora, v_nome from public.reunioes r left join public.profissionais pr on pr.id = r.profissional_id
     where r.chave_externa = p_chave_externa;
    if v_id is not null then return query select true, null::text, v_id, data_hora, nullif(v_nome,''), null::text; return; end if;
  end if;

  v_whats := regexp_replace(coalesce(p_whatsapp, ''), '[^0-9]', '', 'g');
  if length(v_whats) < 10 then
    return query select false, 'whatsapp_invalido', null::uuid, null::timestamptz, null::text, null::text; return;
  end if;
  if p_data_hora is null or p_servico is null or trim(p_servico) = '' then
    return query select false, 'dados_invalidos', null::uuid, null::timestamptz, null::text, null::text; return;
  end if;

  select s.nome, s.exige_reuniao_previa, s.duracao_minutos, s.e_reuniao_previa into v_serv
    from public.catalogo_servicos s where lower(trim(s.nome)) = lower(trim(p_servico)) and s.ativo limit 1;
  if not found then
    return query select false, 'servico_desconhecido', null::uuid, null::timestamptz, null::text, null::text; return;
  end if;
  p_servico := v_serv.nome;

  if v_serv.exige_reuniao_previa then
    select a.nome into v_porta from public.catalogo_servicos a where a.e_reuniao_previa and a.ativo limit 1;
    if v_porta is not null then
      return query select false, 'exige_reuniao_previa', null::uuid, null::timestamptz, null::text, v_porta; return;
    end if;
  end if;

  v_dur := coalesce(p_duracao, v_serv.duracao_minutos, 60);
  select coalesce(max(fuso_horario), 'America/Sao_Paulo') into v_fuso from public.configuracoes_negocio;

  if p_profissional_id is null then
    select l.profissional_id, l.nome into v_prof, v_nome from public.agenda_profissionais_livres(p_data_hora, v_dur) l limit 1;
    if v_prof is null then
      return query select false, 'sem_profissional_livre', null::uuid, null::timestamptz, null::text, null::text; return;
    end if;
  else
    if not exists (select 1 from public.profissionais where id = p_profissional_id and ativo) then
      return query select false, 'profissional_inexistente', null::uuid, null::timestamptz, null::text, null::text; return;
    end if;
    if not public.dentro_da_jornada(p_profissional_id, p_data_hora, v_dur) then
      return query select false, 'fora_expediente', null::uuid, null::timestamptz, null::text, null::text; return;
    end if;
    if exists (select 1 from public.profissional_bloqueios b where (b.profissional_id is null or b.profissional_id = p_profissional_id)
        and tstzrange(b.inicio, b.fim) && tstzrange(p_data_hora, p_data_hora + make_interval(mins => v_dur))) then
      return query select false, 'fora_expediente', null::uuid, null::timestamptz, null::text, null::text; return;
    end if;
    v_prof := p_profissional_id;
    select trim(nome || ' ' || sobrenome) into v_nome from public.profissionais where id = v_prof;
  end if;

  select id into v_contato from public.contatos_dados where whatsapp = v_whats;
  if v_contato is null then
    insert into public.contatos_dados (nome, whatsapp, status, inicio_atendimento)
    values (nullif(trim(coalesce(p_nome,'')), ''), v_whats, 'novo_lead', now()) returning id into v_contato;
  else
    -- Só preenche o nome se a ficha ainda não tiver um; não sobrescreve o que
    -- a equipe já digitou.
    update public.contatos_dados set nome = nullif(trim(coalesce(p_nome, '')), '')
     where id = v_contato and nullif(trim(coalesce(nome, '')), '') is null and nullif(trim(coalesce(p_nome, '')), '') is not null;
  end if;

  if nullif(trim(coalesce(p_interesse, '')), '') is null and coalesce(v_serv.e_reuniao_previa, false) then
    select nullif(trim(coalesce(d.interesses[1], '')), '') into p_interesse from public.contatos_dados d where d.id = v_contato;
  end if;

  begin
    insert into public.reunioes (contato_id, profissional_id, assunto, data_reuniao, duracao_minutos, status, origem, chave_externa, interesse)
    values (v_contato, v_prof, trim(p_servico), p_data_hora, v_dur, 'agendada', 'agente_ia', p_chave_externa, nullif(trim(coalesce(p_interesse, '')), ''))
    returning id into v_id;
  exception
    when exclusion_violation then
      return query select false, 'horario_ocupado', null::uuid, null::timestamptz, null::text, null::text; return;
  end;

  return query select true, null::text, v_id, p_data_hora, v_nome, null::text;
end;
$$;

CREATE FUNCTION public.agenda_remarcar(p_reuniao_id uuid, p_nova_data_hora timestamptz, p_profissional_id uuid DEFAULT NULL, p_whatsapp text DEFAULT NULL)
RETURNS TABLE(ok boolean, motivo text, data_hora timestamptz, profissional text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_r record; v_whats text; v_prof uuid; v_nome text; v_dur integer;
begin
  select r.id, r.status, r.duracao_minutos, r.profissional_id, d.whatsapp into v_r
    from public.reunioes r join public.contatos_dados d on d.id = r.contato_id where r.id = p_reuniao_id;
  if v_r is null then return query select false, 'nao_encontrada', null::timestamptz, null::text; return; end if;
  if p_whatsapp is not null then
    v_whats := regexp_replace(p_whatsapp, '[^0-9]', '', 'g');
    if v_r.whatsapp is distinct from v_whats then return query select false, 'nao_pertence', null::timestamptz, null::text; return; end if;
  end if;
  if v_r.status <> 'agendada' then return query select false, 'nao_encontrada', null::timestamptz, null::text; return; end if;

  v_dur := v_r.duracao_minutos;
  v_prof := coalesce(p_profissional_id, v_r.profissional_id);
  if v_prof is null then
    select l.profissional_id, l.nome into v_prof, v_nome from public.agenda_profissionais_livres(p_nova_data_hora, v_dur) l limit 1;
    if v_prof is null then return query select false, 'sem_profissional_livre', null::timestamptz, null::text; return; end if;
  else
    if not public.dentro_da_jornada(v_prof, p_nova_data_hora, v_dur) then
      return query select false, 'fora_expediente', null::timestamptz, null::text; return;
    end if;
    if exists (select 1 from public.reunioes r where r.profissional_id = v_prof and r.status = 'agendada' and r.id <> p_reuniao_id
        and tstzrange(r.data_reuniao, r.data_fim) && tstzrange(p_nova_data_hora, p_nova_data_hora + make_interval(mins => v_dur))) then
      return query select false, 'horario_ocupado', null::timestamptz, null::text; return;
    end if;
    select trim(nome || ' ' || sobrenome) into v_nome from public.profissionais where id = v_prof;
  end if;

  begin
    update public.reunioes set data_reuniao = p_nova_data_hora, profissional_id = v_prof where id = p_reuniao_id;
  exception
    when exclusion_violation then return query select false, 'horario_ocupado', null::timestamptz, null::text; return;
  end;
  return query select true, null::text, p_nova_data_hora, v_nome;
end;
$$;

CREATE FUNCTION public.agenda_cancelar(p_reuniao_id uuid, p_whatsapp text DEFAULT NULL, p_motivo text DEFAULT NULL)
RETURNS TABLE(ok boolean, motivo text, data_hora timestamptz, profissional text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_r record; v_whats text;
begin
  select r.id, r.status, r.data_reuniao, r.contato_id, trim(coalesce(pr.nome,'') || ' ' || coalesce(pr.sobrenome,'')) as prof, d.whatsapp
    into v_r from public.reunioes r join public.contatos_dados d on d.id = r.contato_id
    left join public.profissionais pr on pr.id = r.profissional_id where r.id = p_reuniao_id;
  if v_r is null then return query select false, 'nao_encontrada', null::timestamptz, null::text; return; end if;
  if p_whatsapp is not null then
    v_whats := regexp_replace(p_whatsapp, '[^0-9]', '', 'g');
    if v_r.whatsapp is distinct from v_whats then return query select false, 'nao_pertence', null::timestamptz, null::text; return; end if;
  end if;
  if v_r.status = 'cancelada' then return query select false, 'ja_cancelada', v_r.data_reuniao, nullif(v_r.prof,''); return; end if;
  -- `faltou` é tão passado quanto `realizada`: cancelar apagaria a falta da estatística.
  if v_r.status in ('realizada','faltou') then return query select false, 'nao_cancelavel', v_r.data_reuniao, nullif(v_r.prof,''); return; end if;

  update public.reunioes set status = 'cancelada', cancelado_em = now(), motivo_cancelamento = p_motivo where id = p_reuniao_id;
  return query select true, null::text, v_r.data_reuniao, nullif(v_r.prof,'');
end;
$$;

-- =============================================================================
-- 6. DASHBOARD
-- =============================================================================
CREATE FUNCTION public.resumo_periodo(p_inicio timestamptz, p_fim timestamptz)
RETURNS TABLE(novos_contatos bigint, reunioes_agendadas bigint, vendas_ganhas bigint, conversao numeric, valor_fechado numeric, em_negociacao bigint)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  select
    (select count(*) from contatos_dados where inicio_atendimento between p_inicio and p_fim),
    (select count(*) from reunioes where created_at between p_inicio and p_fim and status in ('agendada','realizada')),
    (select count(*) from oportunidades where status = 'ganho' and fechado_em between p_inicio and p_fim),
    (select coalesce(round(100.0 * count(*) filter (where status = 'ganho') / nullif(count(*),0), 1), 0) from oportunidades where created_at between p_inicio and p_fim),
    (select coalesce(sum(valor_proposta), 0) from oportunidades where status = 'ganho' and fechado_em between p_inicio and p_fim),
    (select count(*) from oportunidades where status in ('proposta','negociacao'));
$$;

-- =============================================================================
-- 7. RLS E PRIVILÉGIOS
-- =============================================================================
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['usuarios','contatos_dados','oportunidades','oportunidade_eventos','reunioes',
    'profissionais','profissional_horarios','profissional_bloqueios','horario_comercial','catalogo_servicos','configuracoes_negocio'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;
REVOKE ALL ON public.contatos FROM PUBLIC, anon;
GRANT ALL ON public.contatos TO service_role;

-- Operacional: leitura para a equipe toda, escrita para a equipe toda.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contatos_dados TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contatos TO authenticated;
CREATE POLICY equipe_leitura ON public.contatos_dados FOR SELECT TO authenticated USING (true);
CREATE POLICY equipe_insere ON public.contatos_dados FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY equipe_atualiza ON public.contatos_dados FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY gestor_apaga ON public.contatos_dados FOR DELETE TO authenticated USING (public.usuario_e_gestor());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.oportunidades TO authenticated;
CREATE POLICY equipe_opera ON public.oportunidades FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT ON public.oportunidade_eventos TO authenticated;
CREATE POLICY equipe_leitura ON public.oportunidade_eventos FOR SELECT TO authenticated USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reunioes TO authenticated;
CREATE POLICY equipe_opera ON public.reunioes FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Configuração/catálogo/equipe: leitura para todos, escrita só do gestor.
GRANT SELECT ON public.usuarios TO authenticated;
GRANT UPDATE ON public.usuarios TO authenticated;
CREATE POLICY equipe_leitura ON public.usuarios FOR SELECT TO authenticated USING (true);
CREATE POLICY proprio_perfil ON public.usuarios FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['profissionais','profissional_horarios','profissional_bloqueios','horario_comercial','catalogo_servicos','configuracoes_negocio'] LOOP
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', t);
    EXECUTE format('CREATE POLICY equipe_leitura ON public.%I FOR SELECT TO authenticated USING (true)', t);
    EXECUTE format('CREATE POLICY gestor_escreve ON public.%I FOR ALL TO authenticated USING (public.usuario_e_gestor()) WITH CHECK (public.usuario_e_gestor())', t);
  END LOOP;
END $$;

-- =============================================================================
-- 8. CONFIGURAÇÃO NEUTRA (sem marca, sem dado de cliente)
-- =============================================================================
INSERT INTO public.configuracoes_negocio DEFAULT VALUES;
-- Valores placeholder, totalmente editáveis em Configurações -> Horários.
INSERT INTO public.horario_comercial (dia_semana, hora_inicio, hora_fim, ativo) VALUES
  (0, '08:00', '12:00', false),
  (1, '08:00', '18:00', true),
  (2, '08:00', '18:00', true),
  (3, '08:00', '18:00', true),
  (4, '08:00', '18:00', true),
  (5, '08:00', '18:00', true),
  (6, '08:00', '12:00', false);

INSERT INTO crm_base_private.schema_migrations(version) VALUES ('0001_base');
NOTIFY pgrst, 'reload schema';
COMMIT;
