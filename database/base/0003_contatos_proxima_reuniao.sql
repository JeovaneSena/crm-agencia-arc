BEGIN;
-- A tela de Contatos precisa saber "quem tem reunião marcada?" sem carregar as
-- reuniões de todo mundo. A coluna é calculada na leitura (nada a manter por
-- trigger): a próxima reunião ainda `agendada`, no futuro. Só acrescenta uma
-- coluna no fim da view — as demais e o security_invoker ficam como estavam.
CREATE OR REPLACE VIEW public.contatos WITH (security_invoker = true) AS
SELECT id, nome, whatsapp, interesses,
  nullif(array_to_string(interesses, ', '), '') AS interesses_texto,
  anotacoes, resumo_conversa, inicio_atendimento, ultima_mensagem, status,
  CASE WHEN ultima_mensagem IS NULL THEN NULL ELSE floor(extract(epoch FROM now() - ultima_mensagem) / 60)::integer END AS minutos_ultima_mensagem,
  (SELECT max(r.data_reuniao) FROM public.reunioes r WHERE r.contato_id = d.id AND r.status = 'realizada') AS ultima_reuniao,
  empresa, email, cliente_desde, created_at,
  (SELECT min(r.data_reuniao) FROM public.reunioes r WHERE r.contato_id = d.id AND r.status = 'agendada' AND r.data_reuniao >= now()) AS proxima_reuniao
FROM public.contatos_dados d;

INSERT INTO crm_base_private.schema_migrations(version) VALUES ('0003_contatos_proxima_reuniao');
NOTIFY pgrst, 'reload schema';
COMMIT;
