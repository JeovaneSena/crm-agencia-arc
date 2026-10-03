BEGIN;
-- TAREFAS (núcleo). O "próximo passo" que impede um negócio de morrer em silêncio: algo a fazer, com prazo e
-- uma pessoa responsável, ligado a um contato e, se couber, a uma oportunidade ("ligar para confirmar a
-- proposta na quinta"). Nasce à mão na ficha do contato ou na tela Tarefas; as fases seguintes (follow-up,
-- falta à reunião, radar) criam tarefas do sistema na mesma tabela.
--
-- Regras:
--   * Qualquer pessoa ativa da equipe lê, cria, edita e conclui. Quem cria é o responsável, se não disser outro;
--     o responsável tem que estar ativo (desligar alguém deixa a tarefa "sem responsável", não a apaga).
--   * `origem` e `criada_por` quem define é o banco: o navegador não escolhe se uma tarefa é "do sistema".
--   * Concluir e reabrir passam por `tarefa_concluir`, que registra quem fez e quando.
--   * Apaga quem criou, o responsável ou o gestor.
--   * Vencida = aberta com prazo no passado. O vigia agrupa por responsável e abre UM aviso por pessoa na
--     Central ("Ana tem 3 tarefas vencidas"); quando a pessoa zera as vencidas, o aviso se fecha sozinho.
--
-- Ideia adaptada do DeskcommCRM (MIT, © 2026 Rafael Melgaço): `lib/tarefas` e a invariante "nenhuma demanda
-- sem próximo passo".

CREATE TABLE public.tarefas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 200),
  detalhe text CHECK (length(detalhe) <= 1000),
  vence_em timestamptz NOT NULL,
  contato_id uuid REFERENCES public.contatos_dados(id) ON DELETE CASCADE,
  oportunidade_id uuid,
  responsavel_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  origem text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'sistema')),
  criada_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  concluida_em timestamptz,
  concluida_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (oportunidade_id, contato_id) REFERENCES public.oportunidades(id, contato_id) ON DELETE CASCADE,
  CHECK (oportunidade_id IS NULL OR contato_id IS NOT NULL)
);
CREATE INDEX tarefas_abertas_idx ON public.tarefas(vence_em) WHERE concluida_em IS NULL;
CREATE INDEX tarefas_responsavel_idx ON public.tarefas(responsavel_id, vence_em) WHERE concluida_em IS NULL;
CREATE INDEX tarefas_contato_idx ON public.tarefas(contato_id, vence_em) WHERE contato_id IS NOT NULL;
CREATE INDEX tarefas_concluidas_idx ON public.tarefas(concluida_em DESC) WHERE concluida_em IS NOT NULL;

CREATE FUNCTION public.tarefas_preencher() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if tg_op = 'INSERT' and auth.uid() is not null
     and exists (select 1 from public.usuarios u where u.id = auth.uid() and u.ativo) then
    new.criada_por := auth.uid();
    if new.responsavel_id is null then new.responsavel_id := auth.uid(); end if;
  end if;
  if new.responsavel_id is not null and (tg_op = 'INSERT' or new.responsavel_id is distinct from old.responsavel_id)
     and not exists (select 1 from public.usuarios u where u.id = new.responsavel_id and u.ativo) then
    raise exception 'O responsável precisa ser uma pessoa ativa da equipe.' using errcode = '22023';
  end if;
  return new;
end;
$$;
CREATE TRIGGER tarefas_preencher BEFORE INSERT OR UPDATE ON public.tarefas FOR EACH ROW EXECUTE FUNCTION public.tarefas_preencher();

ALTER TABLE public.tarefas ENABLE ROW LEVEL SECURITY;
CREATE POLICY equipe_le ON public.tarefas FOR SELECT TO authenticated USING (true);
CREATE POLICY equipe_cria ON public.tarefas FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.ativo));
CREATE POLICY equipe_edita ON public.tarefas FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.ativo))
  WITH CHECK (EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.ativo));
CREATE POLICY autor_responsavel_ou_gestor_apaga ON public.tarefas FOR DELETE TO authenticated
  USING (criada_por = auth.uid() OR responsavel_id = auth.uid() OR public.usuario_e_gestor());

REVOKE ALL ON public.tarefas FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.tarefas TO authenticated;
GRANT INSERT (titulo, detalhe, vence_em, contato_id, oportunidade_id, responsavel_id) ON public.tarefas TO authenticated;
GRANT UPDATE (titulo, detalhe, vence_em, responsavel_id) ON public.tarefas TO authenticated;
GRANT ALL ON public.tarefas TO service_role;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tarefas;

-- Concluir (ou reabrir) registra quem e quando. Concluir de novo uma tarefa já concluída não troca o autor.
CREATE FUNCTION public.tarefa_concluir(p_id uuid, p_feita boolean DEFAULT true) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if auth.uid() is null or not exists (select 1 from public.usuarios u where u.id = auth.uid() and u.ativo) then
    raise exception 'Só a equipe conclui tarefas.' using errcode = '42501';
  end if;
  if p_feita then
    update public.tarefas set concluida_em = now(), concluida_por = auth.uid() where id = p_id and concluida_em is null;
  else
    update public.tarefas set concluida_em = null, concluida_por = null where id = p_id and concluida_em is not null;
  end if;
  if not exists (select 1 from public.tarefas where id = p_id) then
    raise exception 'Tarefa não encontrada.' using errcode = 'P0002';
  end if;
end;
$$;

-- Só o vigia (servidor): quantas tarefas vencidas cada pessoa tem. Responsável vazio vem como uma linha própria.
CREATE FUNCTION public.tarefas_vencidas_por_responsavel() RETURNS TABLE(responsavel_id uuid, nome text, quantidade integer, mais_antiga timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select t.responsavel_id, u.nome, count(*)::integer, min(t.vence_em)
    from public.tarefas t left join public.usuarios u on u.id = t.responsavel_id
   where t.concluida_em is null and t.vence_em < now()
   group by t.responsavel_id, u.nome;
$$;

-- Fecha os avisos abertos de um tipo cuja chave NÃO está na lista (a causa sumiu para eles). Lista vazia fecha todos.
-- Serve a qualquer vigia que abra "um aviso por pessoa" ou "por contato": abre quem tem o problema, fecha o resto.
CREATE FUNCTION public.aviso_resolver_exceto(p_tipo text, p_chaves text[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare n integer;
begin
  update public.avisos set resolvido_em = now(), resolucao = 'automatica'
   where tipo = p_tipo and resolvido_em is null and not (chave = any(coalesce(p_chaves, '{}')));
  get diagnostics n = row_count;
  return n;
end;
$$;

REVOKE EXECUTE ON FUNCTION public.tarefas_preencher(), public.tarefas_vencidas_por_responsavel(), public.aviso_resolver_exceto(text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tarefa_concluir(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tarefa_concluir(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tarefas_vencidas_por_responsavel(), public.aviso_resolver_exceto(text, text[]) TO service_role;

INSERT INTO crm_base_private.schema_migrations(version) VALUES ('0020_tarefas');
NOTIFY pgrst, 'reload schema';
COMMIT;
