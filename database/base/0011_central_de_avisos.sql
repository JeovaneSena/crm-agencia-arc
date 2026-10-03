BEGIN;
-- CENTRAL DE AVISOS (núcleo). O lugar onde o sistema diz à equipe o que precisa de
-- gente: conexão caída, mensagem que não saiu, modo de teste esquecido, caso parado.
-- Regra de ouro: nenhum trabalhador termina num `return` mudo. Quando algo exige
-- atenção, abre-se um aviso; quando a causa some, o próprio sistema o resolve.
--
-- Um aviso aberto por (tipo, chave): o mesmo problema repetido a cada minuto não vira
-- cem linhas, só incrementa `ocorrencias`. Quem abre e resolve automaticamente é o
-- servidor (service_role). A equipe lê, e pode dispensar: dispensar silencia a repetição
-- do mesmo aviso por algumas horas, para o problema que persiste não reaparecer no
-- minuto seguinte.
--
-- Ideia adaptada do DeskcommCRM (MIT, © 2026 Rafael Melgaço): Central de avisos.

CREATE TABLE public.avisos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo ~ '^[a-z][a-z0-9_]{2,40}$'),
  chave text NOT NULL DEFAULT '' CHECK (length(chave) <= 120),
  gravidade text NOT NULL DEFAULT 'atencao' CHECK (gravidade IN ('info','atencao','critico')),
  titulo text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 120),
  detalhe text CHECK (length(detalhe) <= 500),
  -- Caminho interno do app que resolve o problema. Nunca URL externa.
  rota text CHECK (length(rota) <= 200 AND rota ~ '^/[A-Za-z0-9/_?=&.%-]*$' AND rota !~ '^//'),
  contato_id uuid REFERENCES public.contatos_dados(id) ON DELETE CASCADE,
  somente_gestor boolean NOT NULL DEFAULT false,
  ocorrencias integer NOT NULL DEFAULT 1 CHECK (ocorrencias >= 1),
  criado_em timestamptz NOT NULL DEFAULT now(),
  ultima_em timestamptz NOT NULL DEFAULT now(),
  resolvido_em timestamptz,
  resolvido_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolucao text CHECK (resolucao IN ('manual','automatica')),
  CHECK ((resolvido_em IS NULL) = (resolucao IS NULL))
);
CREATE UNIQUE INDEX avisos_um_aberto ON public.avisos(tipo, chave) WHERE resolvido_em IS NULL;
CREATE INDEX avisos_abertos_idx ON public.avisos(ultima_em DESC) WHERE resolvido_em IS NULL;
CREATE INDEX avisos_resolvidos_idx ON public.avisos(resolvido_em) WHERE resolvido_em IS NOT NULL;
CREATE INDEX avisos_contato_idx ON public.avisos(contato_id) WHERE contato_id IS NOT NULL;

ALTER TABLE public.avisos ENABLE ROW LEVEL SECURITY;
-- Aviso "só gestor" (credencial, conexão) não aparece para o consultor.
CREATE POLICY equipe_le ON public.avisos FOR SELECT TO authenticated
  USING (NOT somente_gestor OR public.usuario_e_gestor());
REVOKE ALL ON public.avisos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.avisos TO authenticated;
GRANT ALL ON public.avisos TO service_role;
ALTER PUBLICATION supabase_realtime ADD TABLE public.avisos;

-- Abre o aviso, ou atualiza o que já está aberto. Só o servidor chama.
-- Devolve NULL quando a equipe dispensou esse mesmo aviso há menos de `p_silencio_horas`.
-- A gravidade nunca desce numa repetição: quem piorou continua pior até resolver.
CREATE FUNCTION public.aviso_abrir(
  p_tipo text, p_chave text, p_gravidade text, p_titulo text, p_detalhe text DEFAULT NULL,
  p_rota text DEFAULT NULL, p_contato_id uuid DEFAULT NULL, p_somente_gestor boolean DEFAULT false,
  p_silencio_horas integer DEFAULT 6
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_id uuid; v_chave text := coalesce(p_chave, '');
begin
  if p_gravidade NOT IN ('info','atencao','critico') then raise exception 'Gravidade inválida.' using errcode = '22023'; end if;
  if p_silencio_horas IS NULL or p_silencio_horas < 0 or p_silencio_horas > 168 then
    raise exception 'Silêncio deve ficar entre 0 e 168 horas.' using errcode = '22023';
  end if;
  if exists (select 1 from public.avisos a where a.tipo = p_tipo and a.chave = v_chave
              and a.resolucao = 'manual' and a.resolvido_em > now() - make_interval(hours => p_silencio_horas)) then
    return null;
  end if;
  insert into public.avisos (tipo, chave, gravidade, titulo, detalhe, rota, contato_id, somente_gestor)
  values (p_tipo, v_chave, p_gravidade, btrim(p_titulo), nullif(btrim(p_detalhe), ''), p_rota, p_contato_id, p_somente_gestor)
  on conflict (tipo, chave) where resolvido_em is null do update set
    ocorrencias = public.avisos.ocorrencias + 1,
    ultima_em = now(),
    titulo = excluded.titulo,
    detalhe = excluded.detalhe,
    rota = excluded.rota,
    somente_gestor = public.avisos.somente_gestor or excluded.somente_gestor,
    gravidade = case when array_position(array['info','atencao','critico'], excluded.gravidade)
                          > array_position(array['info','atencao','critico'], public.avisos.gravidade)
                     then excluded.gravidade else public.avisos.gravidade end
  returning id into v_id;
  return v_id;
end;
$$;

-- A causa sumiu: o servidor fecha o aviso. `p_chave` NULL fecha todos os abertos do tipo.
CREATE FUNCTION public.aviso_resolver_auto(p_tipo text, p_chave text DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare n integer;
begin
  update public.avisos set resolvido_em = now(), resolucao = 'automatica'
   where tipo = p_tipo and resolvido_em is null and (p_chave is null or chave = p_chave);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- A equipe dispensa um aviso que enxerga. Consultor não dispensa aviso "só gestor".
CREATE FUNCTION public.aviso_dispensar(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v public.avisos;
begin
  if auth.uid() is null or not exists (select 1 from public.usuarios u where u.id = auth.uid() and u.ativo) then
    raise exception 'Só a equipe dispensa avisos.' using errcode = '42501';
  end if;
  select * into v from public.avisos where id = p_id for update;
  if not found or (v.somente_gestor and not public.usuario_e_gestor()) then
    raise exception 'Aviso não encontrado.' using errcode = 'P0002';
  end if;
  if v.resolvido_em is not null then return; end if;
  update public.avisos set resolvido_em = now(), resolvido_por = auth.uid(), resolucao = 'manual' where id = p_id;
end;
$$;

-- Limpeza: avisos resolvidos há mais de `p_dias` saem. Piso de 30 dias.
CREATE FUNCTION public.avisos_expurgar(p_dias integer DEFAULT 90) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare n integer;
begin
  if p_dias IS NULL or p_dias < 30 then raise exception 'Retenção mínima de 30 dias.' using errcode = '22023'; end if;
  delete from public.avisos where resolvido_em is not null and resolvido_em < now() - make_interval(days => p_dias);
  get diagnostics n = row_count;
  return n;
end;
$$;

REVOKE EXECUTE ON FUNCTION public.aviso_abrir(text, text, text, text, text, text, uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.aviso_resolver_auto(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.avisos_expurgar(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.aviso_dispensar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aviso_abrir(text, text, text, text, text, text, uuid, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.aviso_resolver_auto(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.avisos_expurgar(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.aviso_dispensar(uuid) TO authenticated, service_role;

INSERT INTO crm_base_private.schema_migrations(version) VALUES ('0011_central_de_avisos');
NOTIFY pgrst, 'reload schema';
COMMIT;
