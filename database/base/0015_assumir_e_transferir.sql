BEGIN;
-- ASSUMIR, TRANSFERIR E DEVOLVER CONVERSA (módulo conversas), com registro.
--
-- Antes: "assumir" era um UPDATE direto de `contatos_dados.assumido_por`. Duas pessoas clicando ao mesmo
-- tempo ficavam as duas achando que a conversa era delas (a última escrita vencia, sem aviso), e nada
-- registrava quem passou a conversa para quem.
--
-- Agora a coluna só muda por três funções, e cada uma é uma única instrução atômica:
--   conversa_assumir     livre -> eu. Se outra pessoa chegou antes, devolve FALSE (nada muda).
--                        Só o gestor pode tomar de quem já está com a conversa (`p_forcar`).
--   conversa_transferir  de quem está com a conversa (ou o gestor) para outra pessoa ativa da equipe.
--   conversa_devolver    de quem está com a conversa (ou o gestor) para ninguém.
-- Um gatilho recusa o UPDATE direto vindo do navegador, para que ninguém contorne a regra.
-- O histórico fica em `conversa_eventos` (a equipe lê; só as funções escrevem).
--
-- Ideia adaptada do DeskcommCRM (MIT, © 2026 Rafael Melgaço): regras AT-02 ("eu cuido" atômico) e AT-04.

CREATE TABLE public.conversa_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_id uuid NOT NULL REFERENCES public.contatos_dados(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('assumiu','transferiu','devolveu')),
  de_usuario uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  para_usuario uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  por_usuario uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversa_eventos_contato_idx ON public.conversa_eventos(contato_id, created_at DESC);
ALTER TABLE public.conversa_eventos ENABLE ROW LEVEL SECURITY;
CREATE POLICY equipe_le ON public.conversa_eventos FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.conversa_eventos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conversa_eventos TO authenticated;
GRANT ALL ON public.conversa_eventos TO service_role;

-- O navegador não escreve mais em assumido_por/assumido_em. Dentro das funções abaixo (SECURITY DEFINER)
-- e na Edge Function (service_role) o papel é outro, então passam.
CREATE FUNCTION public.contatos_assumido_so_por_funcao() RETURNS trigger LANGUAGE plpgsql AS $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.assumido_por, new.assumido_em) is distinct from (old.assumido_por, old.assumido_em) then
    raise exception 'Use assumir, transferir ou devolver a conversa.' using errcode = '42501';
  end if;
  return new;
end;
$$;
CREATE TRIGGER contatos_assumido_so_por_funcao BEFORE UPDATE OF assumido_por, assumido_em ON public.contatos_dados
  FOR EACH ROW EXECUTE FUNCTION public.contatos_assumido_so_por_funcao();

CREATE FUNCTION public.conversa_assumir(p_contato uuid, p_forcar boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_eu uuid := auth.uid(); v_antes uuid; v_linhas integer;
begin
  if v_eu is null or not exists (select 1 from public.usuarios u where u.id = v_eu and u.ativo) then
    raise exception 'Só a equipe assume conversas.' using errcode = '42501';
  end if;
  if p_forcar and not public.usuario_e_gestor() then
    raise exception 'Só o gestor toma uma conversa de quem já está com ela.' using errcode = '42501';
  end if;
  -- Trava a linha para ler quem estava antes sem corrida com outro clique.
  select assumido_por into v_antes from public.contatos_dados where id = p_contato for update;
  if not found then raise exception 'Contato não encontrado.' using errcode = 'P0002'; end if;
  if v_antes = v_eu then return true; end if;      -- já é minha: nada a registrar
  if v_antes is not null and not p_forcar then return false; end if;
  update public.contatos_dados set assumido_por = v_eu, assumido_em = now() where id = p_contato;
  insert into public.conversa_eventos(contato_id, tipo, de_usuario, para_usuario, por_usuario)
    values (p_contato, case when v_antes is null then 'assumiu' else 'transferiu' end, v_antes, v_eu, v_eu);
  return true;
end;
$$;

CREATE FUNCTION public.conversa_transferir(p_contato uuid, p_para uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_eu uuid := auth.uid(); v_antes uuid;
begin
  if v_eu is null or not exists (select 1 from public.usuarios u where u.id = v_eu and u.ativo) then
    raise exception 'Só a equipe transfere conversas.' using errcode = '42501';
  end if;
  select assumido_por into v_antes from public.contatos_dados where id = p_contato for update;
  if not found then raise exception 'Contato não encontrado.' using errcode = 'P0002'; end if;
  if v_antes is distinct from v_eu and not public.usuario_e_gestor() then
    raise exception 'Só quem está com a conversa, ou o gestor, a transfere.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.usuarios u where u.id = p_para and u.ativo) then
    raise exception 'Escolha uma pessoa ativa da equipe.' using errcode = '22023';
  end if;
  if v_antes = p_para then return; end if;
  update public.contatos_dados set assumido_por = p_para, assumido_em = now() where id = p_contato;
  insert into public.conversa_eventos(contato_id, tipo, de_usuario, para_usuario, por_usuario) values (p_contato, 'transferiu', v_antes, p_para, v_eu);
end;
$$;

CREATE FUNCTION public.conversa_devolver(p_contato uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_eu uuid := auth.uid(); v_antes uuid;
begin
  if v_eu is null or not exists (select 1 from public.usuarios u where u.id = v_eu and u.ativo) then
    raise exception 'Só a equipe devolve conversas.' using errcode = '42501';
  end if;
  select assumido_por into v_antes from public.contatos_dados where id = p_contato for update;
  if not found then raise exception 'Contato não encontrado.' using errcode = 'P0002'; end if;
  if v_antes is null then return; end if;
  if v_antes <> v_eu and not public.usuario_e_gestor() then
    raise exception 'Só quem está com a conversa, ou o gestor, a devolve.' using errcode = '42501';
  end if;
  update public.contatos_dados set assumido_por = null, assumido_em = null where id = p_contato;
  insert into public.conversa_eventos(contato_id, tipo, de_usuario, para_usuario, por_usuario) values (p_contato, 'devolveu', v_antes, null, v_eu);
end;
$$;

REVOKE EXECUTE ON FUNCTION public.conversa_assumir(uuid, boolean), public.conversa_transferir(uuid, uuid), public.conversa_devolver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversa_assumir(uuid, boolean), public.conversa_transferir(uuid, uuid), public.conversa_devolver(uuid) TO authenticated, service_role;

INSERT INTO crm_base_private.schema_migrations(version) VALUES ('0015_assumir_e_transferir');
NOTIFY pgrst, 'reload schema';
COMMIT;
