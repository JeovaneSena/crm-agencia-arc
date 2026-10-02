BEGIN;
-- Gráficos do Dashboard. Os números do topo já vêm de `resumo_periodo` (0001);
-- aqui ficam as quatro séries. Todas SECURITY INVOKER: valem o que a RLS do
-- usuário que chama deixar ler. O dia é sempre o do fuso de
-- `configuracoes_negocio` (padrão America/Sao_Paulo), nunca o do servidor.

CREATE FUNCTION public.fuso_do_negocio() RETURNS text
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  select coalesce((select nullif(trim(c.fuso_horario), '') from public.configuracoes_negocio c limit 1), 'America/Sao_Paulo')
$$;

-- Um ponto por dia: contatos que chegaram e reuniões marcadas (pela data em
-- que foram criadas). Teto de 370 dias, para um período enorme não gerar
-- milhares de linhas.
CREATE FUNCTION public.dashboard_por_dia(p_inicio timestamptz, p_fim timestamptz)
RETURNS TABLE(dia date, atendimentos bigint, agendamentos bigint)
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
declare
  v_tz text := public.fuso_do_negocio();
  v_fim date := (p_fim at time zone public.fuso_do_negocio())::date;
  v_ini date;
begin
  v_ini := greatest((p_inicio at time zone v_tz)::date, v_fim - 369);
  return query
  with dias as (select generate_series(v_ini, v_fim, interval '1 day')::date as dia),
  atend as (
    select (d.inicio_atendimento at time zone v_tz)::date as dia, count(*) as n
      from public.contatos_dados d where d.inicio_atendimento between p_inicio and p_fim group by 1),
  agend as (
    select (r.created_at at time zone v_tz)::date as dia, count(*) as n
      from public.reunioes r where r.created_at between p_inicio and p_fim and r.status in ('agendada','realizada') group by 1)
  select s.dia, coalesce(a.n, 0)::bigint, coalesce(g.n, 0)::bigint
    from dias s left join atend a on a.dia = s.dia left join agend g on g.dia = s.dia
   order by s.dia;
end;
$$;

-- Contatos por dia da semana (0 = domingo, como o getDay() do JS). Os sete
-- dias sempre saem, zerados quando não houve ninguém.
CREATE FUNCTION public.dashboard_dia_semana(p_inicio timestamptz, p_fim timestamptz)
RETURNS TABLE(dia_semana integer, contatos bigint)
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
declare v_tz text := public.fuso_do_negocio();
begin
  return query
  with todos as (select generate_series(0, 6) as dia_semana),
  cont as (
    select extract(dow from (d.inicio_atendimento at time zone v_tz))::int as dia_semana, count(*) as n
      from public.contatos_dados d where d.inicio_atendimento between p_inicio and p_fim group by 1)
  select t.dia_semana, coalesce(c.n, 0)::bigint from todos t left join cont c on c.dia_semana = t.dia_semana order by t.dia_semana;
end;
$$;

-- Reuniões por profissional, pela data da reunião. Agendada e realizada contam;
-- cancelada e falta ficam de fora. O inativo só aparece nos períodos em que atendeu.
CREATE FUNCTION public.dashboard_profissionais(p_inicio timestamptz, p_fim timestamptz)
RETURNS TABLE(profissional_id uuid, nome text, cor text, reunioes bigint)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  with cont as (
    select r.profissional_id, count(*) as n from public.reunioes r
     where r.data_reuniao between p_inicio and p_fim and r.status in ('agendada', 'realizada') group by 1)
  select p.id, trim(p.nome || ' ' || coalesce(p.sobrenome, '')) || case when p.ativo then '' else ' (inativo)' end,
         p.cor, coalesce(cont.n, 0)::bigint
    from public.profissionais p left join cont on cont.profissional_id = p.id
   where p.ativo or cont.n is not null
  union all
  select null::uuid, 'Sem profissional', null::text, cont.n from cont where cont.profissional_id is null
  order by 4 desc, 2
$$;

-- Serviços: quantos contatos os procuraram e quantas vendas ganhas os incluíram.
CREATE FUNCTION public.dashboard_servicos(p_inicio timestamptz, p_fim timestamptz)
RETURNS TABLE(servico text, procurado bigint, realizado bigint)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  with nomes as (
    select nome from public.catalogo_servicos where not arquivado and not e_reuniao_previa
    union select unnest(servicos_contratados) from public.oportunidades where status = 'ganho' and fechado_em between p_inicio and p_fim)
  select n.nome,
    (select count(*) from public.contatos_dados d where n.nome = any(d.interesses) and d.inicio_atendimento between p_inicio and p_fim),
    (select count(*) from public.oportunidades o where n.nome = any(o.servicos_contratados) and o.status = 'ganho' and o.fechado_em between p_inicio and p_fim)
  from nomes n order by 2 desc, 1
$$;

INSERT INTO crm_base_private.schema_migrations(version) VALUES ('0004_dashboard');
NOTIFY pgrst, 'reload schema';
COMMIT;
