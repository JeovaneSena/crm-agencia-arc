BEGIN;
-- VOLTA AUTOMÁTICA AO ASSISTENTE (módulo assistente). Quando o assistente chama a equipe (`chamar_equipe`), ele se
-- cala na conversa e espera alguém. Se ninguém aparece, o cliente que escreveu de novo fica sem resposta: equipe
-- ocupada, IA proibida. Aqui o gestor pode definir um prazo (em minutos); passado esse tempo sem NENHUM sinal da
-- equipe, a conversa volta ao assistente sozinha. Sem prazo (o padrão), nada muda: a IA só volta quando a equipe a
-- religa.
--
-- O que volta, e só isto:
--   * conversa encaminhada PELO ASSISTENTE (`ia_encaminhada_motivo = 'equipe'`), com a IA desligada, sem dono e
--     não adiada;
--   * só com o assistente AO VIVO (no teste e desligado nada é devolvido).
-- O que NUNCA volta:
--   * quem pediu para parar de receber mensagem (motivo 'parar'): isso é decisão do cliente, não abandono;
--   * conversa que alguém assumiu ("eu cuido"): é uma reivindicação explícita, e o que a equipe responde pelo
--     celular o CRM não enxerga, então silêncio ali não prova ausência;
--   * conversa que a equipe desligou à mão ("Desligar nesta conversa") e conversa adiada.
--
-- "Sinal da equipe" = o mais recente entre o encaminhamento, uma mensagem escrita pelo CRM e um assumir/transferir/
-- devolver. A contagem sai do ÚLTIMO sinal, não do encaminhamento: contar do encaminhamento cortaria no meio um
-- atendimento de uma hora, que é justamente quando há uma pessoa na conversa.
--
-- Por que o servidor também usa o prazo: a trava "a equipe escreveu há pouco" do assistente era fixa em 12 h.
-- Com um prazo definido, ela passa a valer o mesmo prazo; senão a conversa voltaria e a IA continuaria calada.
--
-- Ideia adaptada do DeskcommCRM (MIT, © 2026 Rafael Melgaço): `lib/escalacao/devolucao-automatica.ts`.

ALTER TABLE public.assistente_config
  ADD COLUMN devolver_apos_minutos integer CHECK (devolver_apos_minutos IS NULL OR devolver_apos_minutos BETWEEN 5 AND 1440);
COMMENT ON COLUMN public.assistente_config.devolver_apos_minutos IS 'Minutos sem sinal da equipe para o assistente reassumir uma conversa que ele mesmo encaminhou; vazio = nunca volta sozinho. Abaixo de 5 a IA voltaria no meio da digitação.';

ALTER TABLE public.contatos_dados
  ADD COLUMN ia_encaminhada_motivo text CHECK (ia_encaminhada_motivo IN ('equipe', 'parar'));
COMMENT ON COLUMN public.contatos_dados.ia_encaminhada_motivo IS 'Por que o assistente se calou: chamou a equipe ("equipe") ou o cliente pediu para parar ("parar"). Só "equipe" pode voltar sozinha.';

-- Concluir o encaminhamento (ou religar a IA) zera a data; o motivo vai junto, sem depender de cada tela lembrar.
CREATE FUNCTION public.contatos_encaminhamento_limpa_motivo() RETURNS trigger LANGUAGE plpgsql AS $$
begin
  if new.ia_encaminhada_em is null then new.ia_encaminhada_motivo := null; end if;
  return new;
end;
$$;
CREATE TRIGGER contatos_encaminhamento_limpa_motivo BEFORE UPDATE OF ia_encaminhada_em ON public.contatos_dados
  FOR EACH ROW EXECUTE FUNCTION public.contatos_encaminhamento_limpa_motivo();

-- O histórico da conversa ganha o evento da volta (sem pessoa: `por_usuario` fica vazio).
ALTER TABLE public.conversa_eventos DROP CONSTRAINT conversa_eventos_tipo_check;
ALTER TABLE public.conversa_eventos ADD CONSTRAINT conversa_eventos_tipo_check
  CHECK (tipo IN ('assumiu', 'transferiu', 'devolveu', 'voltou_ao_assistente'));

-- A configuração ganha o prazo. Troca a assinatura (um parâmetro novo, com padrão): a antiga sai para não sobrar
-- uma segunda função com o mesmo nome.
DROP FUNCTION public.assistente_salvar_config(text, text, text, text, text[], integer, integer);
CREATE FUNCTION public.assistente_salvar_config(
  p_modo text, p_nome text, p_modelo text, p_instrucoes text, p_numeros text[], p_max_respostas integer, p_espera integer,
  p_devolver_apos integer DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_numeros text[] := '{}'; n text; v_norm text; v_instr text := nullif(btrim(p_instrucoes), '');
begin
  if not public.usuario_e_gestor() then raise exception 'Só o gestor altera o assistente.' using errcode = '42501'; end if;
  if p_modo not in ('desligada','teste','ao_vivo') then raise exception 'Modo inválido.' using errcode = '22023'; end if;
  if p_devolver_apos is not null and p_devolver_apos not between 5 and 1440 then
    raise exception 'O prazo para o assistente reassumir vai de 5 minutos a 24 horas (1440 minutos). Deixe em branco para nunca voltar sozinho.' using errcode = '22023';
  end if;
  foreach n in array coalesce(p_numeros, '{}') loop
    -- Quem digita "(11) 98854-1234" não escreve o 55, mas o webhook recebe o número com ele.
    v_norm := regexp_replace(coalesce(n, ''), '\D', '', 'g');
    if v_norm ~ '^[0-9]{10,11}$' then v_norm := '55' || v_norm; end if;
    if v_norm !~ '^[0-9]{10,15}$' then raise exception 'Número de teste inválido.' using errcode = '22023'; end if;
    if not v_norm = any(v_numeros) then v_numeros := v_numeros || v_norm; end if;
  end loop;
  if p_modo = 'teste' and cardinality(v_numeros) = 0 then
    raise exception 'No modo de teste, informe pelo menos um número autorizado.' using errcode = '22023';
  end if;
  -- Ao vivo só com as informações do negócio preenchidas: sem elas o assistente não sabe responder endereço e horário.
  if p_modo = 'ao_vivo' and (v_instr is null or length(v_instr) < 40) then
    raise exception 'Preencha as informações do negócio (endereço, horário, avisos) antes de ligar ao vivo.' using errcode = '22023';
  end if;
  update public.assistente_config set modo = p_modo, nome = btrim(p_nome), modelo = btrim(p_modelo), instrucoes = v_instr,
    numeros_teste = v_numeros, max_respostas = p_max_respostas, espera_segundos = p_espera,
    devolver_apos_minutos = p_devolver_apos, updated_by = auth.uid(), updated_at = now()
  where id;
end;
$$;
GRANT EXECUTE ON FUNCTION public.assistente_salvar_config(text, text, text, text, text[], integer, integer, integer) TO authenticated, service_role;

-- Só o vigia (servidor). Devolve ao assistente as conversas vencidas, no máximo `p_limite` por rodada (cada uma pode
-- custar uma resposta do modelo; o resto fica para a rodada seguinte), e diz o que o cliente deixou sem resposta:
-- a mensagem só vem se for a ÚLTIMA da conversa, for texto e tiver até 24 h (mais velha que isso, responder de repente
-- parece engano). `skip locked`: duas rodadas ao mesmo tempo não devolvem a mesma conversa duas vezes.
CREATE FUNCTION public.conversas_devolver_ao_assistente(p_limite integer DEFAULT 3)
RETURNS TABLE(contato_id uuid, nome text, whatsapp text, minutos integer, mensagem_id uuid, tipo text, texto text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
#variable_conflict use_column
declare v_min integer;
begin
  select c.devolver_apos_minutos into v_min from public.assistente_config c where c.modo = 'ao_vivo';
  if v_min is null then return; end if;
  return query
  with alvo as (
    select d.id, d.nome, d.whatsapp,
      greatest(
        d.ia_encaminhada_em,
        (select max(m.criada_em) from public.mensagens_whatsapp m where m.contato_id = d.id and m.autor = 'atendente'),
        (select max(e.created_at) from public.conversa_eventos e where e.contato_id = d.id)
      ) as sinal
    from public.contatos_dados d
    where d.ia_encaminhada_motivo = 'equipe' and d.ia_encaminhada_em is not null
      and not d.ia_ligada and d.assumido_por is null
      and (d.adiada_ate is null or d.adiada_ate <= now())
      and greatest(
        d.ia_encaminhada_em,
        (select max(m.criada_em) from public.mensagens_whatsapp m where m.contato_id = d.id and m.autor = 'atendente'),
        (select max(e.created_at) from public.conversa_eventos e where e.contato_id = d.id)
      ) <= now() - make_interval(mins => v_min)
    order by d.ia_encaminhada_em, d.id
    limit greatest(p_limite, 0)
    for update of d skip locked
  ), voltou as (
    update public.contatos_dados d set ia_ligada = true, ia_encaminhada_em = null, ia_resumo = null
      from alvo where d.id = alvo.id returning d.id
  ), registro as (
    insert into public.conversa_eventos(contato_id, tipo) select v.id, 'voltou_ao_assistente' from voltou v returning contato_id
  )
  select a.id, a.nome, a.whatsapp, floor(extract(epoch from now() - a.sinal) / 60)::integer,
    p.id, p.tipo, p.conteudo
  from alvo a
  join registro r on r.contato_id = a.id
  left join lateral (
    select m.id, m.tipo, m.conteudo, m.autor, m.criada_em from public.mensagens_whatsapp m
    where m.contato_id = a.id order by m.criada_em desc limit 1
  ) p on p.autor = 'cliente' and p.tipo = 'texto' and p.criada_em > now() - interval '24 hours'
  order by a.sinal, a.id;
end;
$$;

REVOKE EXECUTE ON FUNCTION public.conversas_devolver_ao_assistente(integer), public.contatos_encaminhamento_limpa_motivo() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conversas_devolver_ao_assistente(integer) TO service_role;

INSERT INTO crm_base_private.schema_migrations(version) VALUES ('0022_volta_ao_assistente');
NOTIFY pgrst, 'reload schema';
COMMIT;
