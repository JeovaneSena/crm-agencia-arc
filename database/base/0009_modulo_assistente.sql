BEGIN;
-- MÓDULO ASSISTENTE (IA que responde no WhatsApp). Só aplique em instalações que
-- ligarem `assistente` em VITE_MODULOS. Depende do módulo CONVERSAS (0007).
--
-- Três modos, sempre DESLIGADO de fábrica:
--   desligada  não responde ninguém;
--   teste      responde SÓ os números de `numeros_teste` (trava conferida no código
--              da função, não só na tela);
--   ao_vivo    responde as conversas com `contatos_dados.ia_ligada = true`. Contato
--              novo nasce com a IA ligada apenas neste modo; o histórico e quem já
--              falava com a equipe seguem desligados até alguém ligar.
-- Só o gestor altera a configuração (por função, que valida). Quem escreve as
-- respostas e o encaminhamento é a Edge Function (service_role).

CREATE TABLE public.assistente_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  modo text NOT NULL DEFAULT 'desligada' CHECK (modo IN ('desligada','teste','ao_vivo')),
  nome text NOT NULL DEFAULT 'Assistente' CHECK (length(btrim(nome)) BETWEEN 1 AND 40),
  modelo text NOT NULL DEFAULT 'claude-sonnet-5-5' CHECK (modelo ~ '^(claude|gpt)-[a-z0-9.-]{1,60}$'),
  -- Informações do negócio (endereço, horário, avisos). As regras de tom e segurança
  -- ficam no código da função, versionadas e testadas; isto só entra no fim do prompt.
  instrucoes text CHECK (length(instrucoes) <= 6000),
  numeros_teste text[] NOT NULL DEFAULT '{}' CHECK (cardinality(numeros_teste) <= 20),
  max_respostas integer NOT NULL DEFAULT 12 CHECK (max_respostas BETWEEN 1 AND 100),
  espera_segundos integer NOT NULL DEFAULT 6 CHECK (espera_segundos BETWEEN 0 AND 30),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.assistente_config DEFAULT VALUES;

ALTER TABLE public.contatos_dados
  ADD COLUMN ia_ligada boolean NOT NULL DEFAULT false,
  ADD COLUMN ia_encaminhada_em timestamptz,
  ADD COLUMN ia_resumo text CHECK (length(ia_resumo) <= 500);

-- Uma linha por mensagem do cliente que a IA tentou responder. A chave primária é
-- a trava contra resposta em dobro (webhook repetido, duas execuções).
CREATE TABLE public.assistente_respostas (
  mensagem_id uuid PRIMARY KEY REFERENCES public.mensagens_whatsapp(id) ON DELETE CASCADE,
  contato_id uuid NOT NULL REFERENCES public.contatos_dados(id) ON DELETE CASCADE,
  estado text NOT NULL DEFAULT 'processando' CHECK (estado IN ('processando','respondida','encaminhada','ignorada','falhou')),
  motivo text CHECK (length(motivo) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistente_respostas_contato_idx ON public.assistente_respostas(contato_id, created_at DESC);

ALTER TABLE public.assistente_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistente_respostas ENABLE ROW LEVEL SECURITY;
CREATE POLICY equipe_leitura ON public.assistente_config FOR SELECT TO authenticated USING (true);
CREATE POLICY gestor_le ON public.assistente_respostas FOR SELECT TO authenticated USING (public.usuario_e_gestor());
REVOKE ALL ON public.assistente_config, public.assistente_respostas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.assistente_config, public.assistente_respostas TO authenticated;
GRANT ALL ON public.assistente_config, public.assistente_respostas TO service_role;

-- A única porta de escrita da configuração: só gestor, com as travas de validação.
CREATE FUNCTION public.assistente_salvar_config(
  p_modo text, p_nome text, p_modelo text, p_instrucoes text, p_numeros text[], p_max_respostas integer, p_espera integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_numeros text[] := '{}'; n text; v_norm text; v_instr text := nullif(btrim(p_instrucoes), '');
begin
  if not public.usuario_e_gestor() then raise exception 'Só o gestor altera o assistente.' using errcode = '42501'; end if;
  if p_modo not in ('desligada','teste','ao_vivo') then raise exception 'Modo inválido.' using errcode = '22023'; end if;
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
    updated_by = auth.uid(), updated_at = now()
  where id;
end;
$$;
GRANT EXECUTE ON FUNCTION public.assistente_salvar_config(text, text, text, text, text[], integer, integer) TO authenticated, service_role;

-- A lista de conversas ganha o estado da IA em cada uma (colunas novas no fim da view).
CREATE OR REPLACE VIEW public.conversas_lista WITH (security_invoker = true) AS
SELECT d.id AS contato_id, d.nome, d.whatsapp, d.status,
  (d.assumido_por IS NOT NULL) AS assumida, d.assumido_por, d.assumido_em, u.nome AS assumido_por_nome,
  ultima.conteudo AS ultimo_conteudo, ultima.tipo AS ultimo_tipo, ultima.autor AS ultimo_autor, ultima.criada_em AS ultima_em,
  coalesce(pend.total, 0) AS nao_lidas,
  (SELECT min(r.data_reuniao) FROM public.reunioes r WHERE r.contato_id = d.id AND r.status = 'agendada' AND r.data_reuniao >= now()) AS proxima_reuniao,
  d.ia_ligada, d.ia_encaminhada_em, d.ia_resumo
FROM public.contatos_dados d
JOIN LATERAL (SELECT m.conteudo, m.tipo, m.autor, m.criada_em FROM public.mensagens_whatsapp m
              WHERE m.contato_id = d.id ORDER BY m.criada_em DESC LIMIT 1) ultima ON true
LEFT JOIN LATERAL (SELECT count(*) AS total FROM public.mensagens_whatsapp m
                   WHERE m.contato_id = d.id AND m.autor = 'cliente' AND NOT m.lida) pend ON true
LEFT JOIN public.usuarios u ON u.id = d.assumido_por;
GRANT SELECT ON public.conversas_lista TO authenticated, service_role;

INSERT INTO crm_base_private.schema_migrations(version) VALUES ('0009_modulo_assistente');
NOTIFY pgrst, 'reload schema';
COMMIT;
