BEGIN;
-- RETENÇÃO DE MÍDIA (módulo conversas). Fotos, áudios e documentos que os clientes mandam ficam no
-- Storage, e o plano gratuito do Supabase tem 1 GB. Sem teto, o bucket enche e a instalação para.
--
-- DESLIGADA de fábrica (`retencao_midia_dias` NULL = guardar para sempre): apagar arquivo de
-- cliente é irreversível, então é uma decisão do gestor, não um padrão. Ligada, o vigia remove do
-- Storage o arquivo da mensagem mais velha que N dias (mínimo 30). A mensagem e a transcrição ficam;
-- só o arquivo some, e a conversa mostra "Arquivo removido pela retenção de dados".
--
-- Ideia adaptada do DeskcommCRM (MIT, © 2026 Rafael Melgaço): `cron/media-retention`.

ALTER TABLE public.conversas_config
  ADD COLUMN retencao_midia_dias integer CHECK (retencao_midia_dias IS NULL OR retencao_midia_dias BETWEEN 30 AND 3650);
ALTER TABLE public.mensagens_whatsapp ADD COLUMN midia_removida_em timestamptz;

-- A policy `gestor_atualiza` (0007) já limita a escrita ao gestor; falta só liberar a coluna.
GRANT UPDATE (retencao_midia_dias) ON public.conversas_config TO authenticated;

-- Quais arquivos já passaram do prazo. Só o servidor chama. Sem prazo configurado, nada vence.
CREATE FUNCTION public.midias_vencidas(p_limite integer DEFAULT 50) RETURNS TABLE(id uuid, midia_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_dias integer;
begin
  select c.retencao_midia_dias into v_dias from public.conversas_config c;
  if v_dias is null then return; end if;
  return query
    select m.id, m.midia_url from public.mensagens_whatsapp m
     where m.midia_url is not null and m.criada_em < now() - make_interval(days => v_dias)
     order by m.criada_em limit greatest(1, least(coalesce(p_limite, 50), 200));
end;
$$;

-- Depois de apagar o arquivo no Storage, o servidor registra: o caminho some e fica a data da remoção.
CREATE FUNCTION public.midias_marcar_removidas(p_ids uuid[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare n integer;
begin
  update public.mensagens_whatsapp set midia_url = null, midia_removida_em = now()
   where id = any(p_ids) and midia_url is not null;
  get diagnostics n = row_count;
  return n;
end;
$$;

REVOKE EXECUTE ON FUNCTION public.midias_vencidas(integer), public.midias_marcar_removidas(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.midias_vencidas(integer), public.midias_marcar_removidas(uuid[]) TO service_role;

INSERT INTO crm_base_private.schema_migrations(version) VALUES ('0012_retencao_de_midia');
NOTIFY pgrst, 'reload schema';
COMMIT;
