BEGIN;
-- MÓDULO PROJETOS (entrega pós-venda). Só aplique em instalações que ligarem
-- `projetos` em VITE_MODULOS. Depende só do núcleo (oportunidades, profissionais).
--
-- Uma venda ganha gera exatamente um projeto, por gatilho: sem este módulo
-- aplicado, ganhar uma venda não cria nada. A equipe só edita o andamento
-- (nome, etapa, prazo, escopo, responsável); criar e apagar é do gatilho e do
-- vínculo com a oportunidade/contato (ON DELETE CASCADE).

CREATE TABLE public.projetos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_id uuid NOT NULL REFERENCES public.contatos_dados(id) ON DELETE CASCADE,
  oportunidade_id uuid NOT NULL UNIQUE,
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 160),
  etapa text NOT NULL DEFAULT 'planejamento'
    CHECK (etapa = ANY (ARRAY['planejamento','andamento','revisao','entregue'])),
  prazo date,
  escopo text NOT NULL DEFAULT '',
  responsavel_id uuid REFERENCES public.profissionais(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (oportunidade_id, contato_id) REFERENCES public.oportunidades(id, contato_id) ON DELETE CASCADE
);
CREATE INDEX projetos_contato_idx ON public.projetos(contato_id);
CREATE INDEX projetos_etapa_idx ON public.projetos(etapa, created_at DESC);
CREATE INDEX projetos_responsavel_idx ON public.projetos(responsavel_id) WHERE responsavel_id IS NOT NULL;

-- Vínculo imutável; updated_at sempre novo (a tela usa como trava otimista).
CREATE FUNCTION public.projetos_validar() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.oportunidades where id = new.oportunidade_id and status = 'ganho') then
      raise exception 'Só uma venda ganha gera projeto.';
    end if;
  else
    if row(new.id, new.contato_id, new.oportunidade_id) is distinct from row(old.id, old.contato_id, old.oportunidade_id) then
      raise exception 'O vínculo do projeto com a venda não pode ser alterado.';
    end if;
    new.created_at := old.created_at;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
CREATE TRIGGER projetos_validar BEFORE INSERT OR UPDATE ON public.projetos
  FOR EACH ROW EXECUTE FUNCTION public.projetos_validar();

-- Venda ganha => um projeto. Idempotente: marcar Ganho de novo não duplica.
CREATE FUNCTION public.projetos_criar_da_venda() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  insert into public.projetos(contato_id, oportunidade_id, nome, escopo)
  values (new.contato_id, new.id, left(new.nome, 160), coalesce(new.escopo, ''))
  on conflict (oportunidade_id) do nothing;
  return new;
end;
$$;
REVOKE EXECUTE ON FUNCTION public.projetos_criar_da_venda() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER projetos_da_venda AFTER INSERT OR UPDATE OF status ON public.oportunidades
  FOR EACH ROW WHEN (new.status = 'ganho') EXECUTE FUNCTION public.projetos_criar_da_venda();

-- Módulo ligado depois das primeiras vendas: cria os projetos que faltam.
INSERT INTO public.projetos(contato_id, oportunidade_id, nome, escopo)
SELECT o.contato_id, o.id, left(o.nome, 160), coalesce(o.escopo, '')
  FROM public.oportunidades o WHERE o.status = 'ganho'
ON CONFLICT (oportunidade_id) DO NOTHING;

ALTER TABLE public.projetos ENABLE ROW LEVEL SECURITY;
CREATE POLICY equipe_leitura ON public.projetos FOR SELECT TO authenticated USING (true);
CREATE POLICY equipe_atualiza ON public.projetos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

REVOKE ALL ON public.projetos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.projetos TO authenticated;
GRANT UPDATE (nome, etapa, prazo, escopo, responsavel_id, updated_at) ON public.projetos TO authenticated;
GRANT ALL ON public.projetos TO service_role;

ALTER PUBLICATION supabase_realtime ADD TABLE public.projetos;

INSERT INTO crm_base_private.schema_migrations(version) VALUES ('0008_modulo_projetos');
NOTIFY pgrst, 'reload schema';
COMMIT;
