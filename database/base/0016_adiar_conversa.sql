BEGIN;
-- ADIAR CONVERSA (módulo conversas): tirar uma conversa da fila até a hora em que ela deve voltar
-- ("peço o orçamento ao fornecedor e retomo amanhã às 9h"). A conversa não some: fica no filtro
-- "Adiadas" e volta sozinha.
--
-- Volta de três jeitos:
--   1. o cliente escreve  -> o gatilho abaixo zera `adiada_ate` na hora (adiar não pode esconder cliente);
--   2. chega a hora       -> o vigia chama `conversas_adiadas_vencidas`, que zera e devolve quem voltou
--                            para a Central avisar ("a conversa adiada voltou");
--   3. a equipe clica "Voltar agora".
--
-- Ideia adaptada do DeskcommCRM (MIT, © 2026 Rafael Melgaço): `cron/snooze-watcher`.

ALTER TABLE public.contatos_dados ADD COLUMN adiada_ate timestamptz;
CREATE INDEX contatos_adiada_idx ON public.contatos_dados(adiada_ate) WHERE adiada_ate IS NOT NULL;

-- Adiar valida a data (futura, até 30 dias) e exige a equipe ativa; o resto da edição do contato segue livre.
CREATE FUNCTION public.conversa_adiar(p_contato uuid, p_ate timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if auth.uid() is null or not exists (select 1 from public.usuarios u where u.id = auth.uid() and u.ativo) then
    raise exception 'Só a equipe adia conversas.' using errcode = '42501';
  end if;
  if p_ate is null then
    update public.contatos_dados set adiada_ate = null where id = p_contato;     -- "voltar agora"
  else
    if p_ate <= now() then raise exception 'Escolha um horário no futuro.' using errcode = '22023'; end if;
    if p_ate > now() + interval '30 days' then raise exception 'Adie por no máximo 30 dias.' using errcode = '22023'; end if;
    update public.contatos_dados set adiada_ate = p_ate where id = p_contato;
  end if;
  if not found then raise exception 'Contato não encontrado.' using errcode = 'P0002'; end if;
end;
$$;

-- Cliente escreveu: a conversa volta agora, mesmo adiada.
CREATE FUNCTION public.mensagens_cliente_reabre_conversa() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  update public.contatos_dados set adiada_ate = null where id = new.contato_id and adiada_ate is not null;
  return new;
end;
$$;
CREATE TRIGGER mensagens_cliente_reabre_conversa AFTER INSERT ON public.mensagens_whatsapp
  FOR EACH ROW WHEN (new.autor = 'cliente') EXECUTE FUNCTION public.mensagens_cliente_reabre_conversa();

-- Só o vigia (servidor): zera as que venceram e devolve quem são, uma única vez cada.
CREATE FUNCTION public.conversas_adiadas_vencidas() RETURNS TABLE(contato_id uuid, nome text)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  update public.contatos_dados d set adiada_ate = null where d.adiada_ate <= now() returning d.id, d.nome;
$$;

REVOKE EXECUTE ON FUNCTION public.conversa_adiar(uuid, timestamptz), public.mensagens_cliente_reabre_conversa(), public.conversas_adiadas_vencidas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conversa_adiar(uuid, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conversas_adiadas_vencidas() TO service_role;

INSERT INTO crm_base_private.schema_migrations(version) VALUES ('0016_adiar_conversa');
NOTIFY pgrst, 'reload schema';
COMMIT;
