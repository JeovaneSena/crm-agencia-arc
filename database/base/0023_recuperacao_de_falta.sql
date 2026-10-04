BEGIN;
-- RECUPERAÇÃO DE FALTA (núcleo). Quem falta a uma reunião e não ouve mais nada da equipe morre em silêncio: o horário
-- ficou vago, o negócio volta para a qualificação e ninguém tem a obrigação de procurar o contato. Aqui, marcar a falta
-- cria sozinha uma TAREFA para oferecer outra data, com prazo e responsável, e a tarefa se conclui sozinha quando o
-- contato marca outra reunião. Não envia mensagem: a régua de mensagens vem com o follow-up, que reaproveita esta tarefa.
--
-- Regras:
--   * Marcar uma reunião como `faltou` (vinda de qualquer outro estado) cria UMA tarefa por reunião, com origem
--     'sistema', ligada ao contato e ao negócio. Corrigir a baixa e faltar de novo não cria uma segunda.
--   * Prazo: 2 horas depois da baixa, não na hora. A falta costuma ser registrada logo depois do horário e a pessoa pode
--     estar a caminho ou resolvendo o que a fez faltar (mesma escolha do Deskcomm).
--   * Responsável: o do negócio, se estiver ativo; senão quem registrou a falta (regra de `tarefas_preencher`).
--     Nunca derruba a baixa: um responsável desligado não impede a falta de ser registrada.
--   * Não cria quando não há o que recuperar: o contato já tem outra reunião marcada para o futuro, ou o negócio já
--     foi ganho ou perdido. Reunião inserida direto como `faltou` (histórico) também não cria.
--   * Quando o contato marca outra reunião, as tarefas de recuperação abertas dele se concluem sozinhas ("o sistema").
--   * Se ninguém agir, a tarefa vence e entra no aviso "tarefas vencidas" da Central (vigia, módulo conversas).
--
-- Ideia adaptada do DeskcommCRM (MIT, © 2026 Rafael Melgaço): `fn_appointment_recover` e o modelo de fluxo
-- "Falta · remarcar quem não veio" (`lib/followup/modelos/clinica.ts`), em versão sem envio automático.

ALTER TABLE public.tarefas ADD COLUMN reuniao_id uuid REFERENCES public.reunioes(id) ON DELETE CASCADE;
COMMENT ON COLUMN public.tarefas.reuniao_id IS 'Reunião que originou a tarefa do sistema (recuperação de falta). Só o banco preenche: o navegador não tem permissão de escrita nesta coluna.';
-- Uma tarefa de recuperação por reunião, para sempre: é isso que torna o gatilho seguro de repetir.
CREATE UNIQUE INDEX tarefas_recuperacao_unica ON public.tarefas(reuniao_id) WHERE origem = 'sistema' AND reuniao_id IS NOT NULL;

CREATE FUNCTION public.reuniao_falta_cria_tarefa() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_nome text; v_resp uuid; v_aberta boolean := true; v_fuso text;
begin
  -- Já remarcou: há outra reunião marcada para o futuro, não há o que recuperar.
  if exists (select 1 from public.reunioes r where r.contato_id = new.contato_id and r.status = 'agendada'
               and r.data_reuniao > now() and r.id <> new.id) then
    return new;
  end if;
  if new.oportunidade_id is not null then
    select o.responsavel_id, (e.chave is not null) into v_resp, v_aberta
      from public.oportunidades o left join public.etapas_funil e on e.chave = o.status and e.tipo = 'aberta'
     where o.id = new.oportunidade_id;
    -- Negócio ganho ou perdido: a falta não pede recuperação.
    if not coalesce(v_aberta, false) then return new; end if;
    -- Responsável desligado não vale: a tarefa cairia na recusa de `tarefas_preencher` e derrubaria a baixa.
    if v_resp is not null and not exists (select 1 from public.usuarios u where u.id = v_resp and u.ativo) then v_resp := null; end if;
  end if;
  select nullif(btrim(d.nome), '') into v_nome from public.contatos_dados d where d.id = new.contato_id;
  select coalesce(max(fuso_horario), 'America/Sao_Paulo') into v_fuso from public.configuracoes_negocio;
  insert into public.tarefas(titulo, detalhe, vence_em, contato_id, oportunidade_id, responsavel_id, origem, reuniao_id)
  values (
    left('Recuperar a falta de ' || coalesce(v_nome, 'um contato') || ': oferecer outra data', 200),
    left('Não compareceu a "' || new.assunto || '" em ' || to_char(new.data_reuniao at time zone v_fuso, 'DD/MM "às" HH24:MI')
      || '. Ofereça outra data. Se o contato marcar outra reunião, esta tarefa se conclui sozinha.', 1000),
    now() + interval '2 hours', new.contato_id, new.oportunidade_id, v_resp, 'sistema', new.id)
  on conflict (reuniao_id) where origem = 'sistema' and reuniao_id is not null do nothing;
  return new;
end;
$$;
CREATE TRIGGER reunioes_falta_tarefa AFTER UPDATE OF status ON public.reunioes
  FOR EACH ROW WHEN (new.status = 'faltou' AND old.status IS DISTINCT FROM 'faltou')
  EXECUTE FUNCTION public.reuniao_falta_cria_tarefa();

CREATE FUNCTION public.reuniao_marcada_conclui_recuperacao() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  -- Só a chegada de uma reunião marcada conta; remarcar a que já estava marcada não muda o fato.
  if new.data_reuniao <= now() then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'agendada' and old.data_reuniao > now() then return new; end if;
  update public.tarefas set concluida_em = now(), concluida_por = null,
    detalhe = left(coalesce(detalhe || E'\n', '') || 'Concluída sozinha: o contato marcou outra reunião.', 1000)
   where contato_id = new.contato_id and origem = 'sistema' and reuniao_id is not null
     and reuniao_id <> new.id and concluida_em is null;
  return new;
end;
$$;
CREATE TRIGGER reunioes_marcada_conclui_recuperacao AFTER INSERT OR UPDATE OF status, data_reuniao ON public.reunioes
  FOR EACH ROW WHEN (new.status = 'agendada') EXECUTE FUNCTION public.reuniao_marcada_conclui_recuperacao();

REVOKE EXECUTE ON FUNCTION public.reuniao_falta_cria_tarefa(), public.reuniao_marcada_conclui_recuperacao() FROM PUBLIC, anon, authenticated;

INSERT INTO crm_base_private.schema_migrations(version) VALUES ('0023_recuperacao_de_falta');
NOTIFY pgrst, 'reload schema';
COMMIT;
