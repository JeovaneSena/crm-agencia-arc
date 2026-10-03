BEGIN;
-- RADAR DE QUEM ESFRIOU (núcleo). Um negócio aberto que ficou parado e não tem próximo passo garantido morre
-- sem ninguém ver; o radar o torna visível. A regra mora aqui, num só lugar, para a tela e o vigia nunca
-- discordarem.
--
--   * Última atividade = o mais recente entre: criação do negócio, mudança de etapa, última mensagem do contato,
--     reunião marcada ou já passada (realizada/faltou) e tarefa concluída.
--   * Janela de esfriamento = quantas horas de silêncio esfriam NESTA etapa (`etapas_funil.esfria_apos_horas`;
--     sem valor, 48 h). "Sem resposta há 3 dias" é normal numa negociação e é abandono num diagnóstico.
--     Crítico = 3 vezes a janela.
--   * Próximo passo garantido ("em voo"): tarefa aberta com prazo ainda no futuro, reunião marcada no futuro ou
--     `retomar_em` depois de hoje. Tarefa VENCIDA não protege: um prazo estourado é a mesma morte, com data.
--   * Faixas: dentro da janela = em dia (fora do radar); passou da janela com próximo passo = em voo; sem próximo
--     passo = em risco, ou crítico quando passa de 3 janelas.
--
-- Roda com os direitos de quem chama (SECURITY INVOKER): a equipe vê o que a equipe já vê.
--
-- Ideia adaptada do DeskcommCRM (MIT, © 2026 Rafael Melgaço): `lib/leads/risk-radar.ts` e `cron/risk-watcher`.

ALTER TABLE public.etapas_funil ADD COLUMN esfria_apos_horas integer CHECK (esfria_apos_horas IS NULL OR esfria_apos_horas BETWEEN 1 AND 2160);
COMMENT ON COLUMN public.etapas_funil.esfria_apos_horas IS 'Horas de silêncio que esfriam um negócio nesta etapa; vazio = 48. Crítico = 3 vezes isso. Só vale para etapas em andamento.';

CREATE FUNCTION public.radar_negocios() RETURNS TABLE(
  oportunidade_id uuid, contato_id uuid, contato_nome text, nome text, etapa text, valor_proposta numeric,
  responsavel_id uuid, ultima_atividade timestamptz, horas_parado integer, esfria_apos_horas integer,
  faixa text, protegido_por text
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
  with base as (
    select o.id, o.contato_id, c.nome as contato_nome, o.nome, o.status as etapa, o.valor_proposta, o.responsavel_id,
      coalesce(e.esfria_apos_horas, 48) as janela,
      greatest(
        o.created_at, c.ultima_mensagem,
        (select max(ev.created_at) from public.oportunidade_eventos ev where ev.oportunidade_id = o.id),
        (select greatest(max(r.created_at), max(r.data_reuniao) filter (where r.status in ('realizada', 'faltou') and r.data_reuniao <= now()))
           from public.reunioes r where r.contato_id = o.contato_id),
        (select max(t.concluida_em) from public.tarefas t where t.contato_id = o.contato_id)
      ) as ultima,
      case
        when exists (select 1 from public.tarefas t where t.contato_id = o.contato_id and t.concluida_em is null and t.vence_em >= now()
                       and (t.oportunidade_id is null or t.oportunidade_id = o.id)) then 'tarefa'
        when exists (select 1 from public.reunioes r where r.contato_id = o.contato_id and r.status = 'agendada' and r.data_reuniao > now()) then 'reuniao'
        when o.retomar_em > current_date then 'retomar'
      end as protegido
    from public.oportunidades o
    join public.contatos_dados c on c.id = o.contato_id
    join public.etapas_funil e on e.chave = o.status and e.tipo = 'aberta'
    where o.fechado_em is null and o.cancelado_em is null
  ), medido as (
    select b.*, extract(epoch from now() - b.ultima) / 3600.0 as horas from base b
  )
  select m.id, m.contato_id, m.contato_nome, m.nome, m.etapa, m.valor_proposta, m.responsavel_id, m.ultima, floor(m.horas)::integer, m.janela,
    case when m.protegido is not null then 'em_voo' when m.horas >= m.janela * 3 then 'critico' else 'em_risco' end,
    m.protegido
  from medido m
  where m.horas >= m.janela
  order by case when m.protegido is not null then 3 when m.horas >= m.janela * 3 then 1 else 2 end, m.horas desc, m.id;
$$;

-- Só o vigia (servidor): quantos negócios críticos cada pessoa tem. Responsável vazio vem como uma linha própria.
CREATE FUNCTION public.radar_criticos_por_responsavel() RETURNS TABLE(responsavel_id uuid, nome text, quantidade integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select r.responsavel_id, u.nome, count(*)::integer
    from public.radar_negocios() r left join public.usuarios u on u.id = r.responsavel_id
   where r.faixa = 'critico'
   group by r.responsavel_id, u.nome;
$$;

REVOKE EXECUTE ON FUNCTION public.radar_negocios(), public.radar_criticos_por_responsavel() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.radar_negocios() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.radar_criticos_por_responsavel() TO service_role;

INSERT INTO crm_base_private.schema_migrations(version) VALUES ('0021_radar');
NOTIFY pgrst, 'reload schema';
COMMIT;
