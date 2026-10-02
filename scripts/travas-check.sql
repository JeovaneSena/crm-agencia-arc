-- Ensaio das invariantes da migracao 0034 (o que so o gestor faz).
-- Roda dentro da transacao da propria migracao e termina em rollback: nada
-- escrito aqui sobrevive. Falha = exception; sucesso = silencio.
--
-- Este ensaio TROCA DE PAPEL de verdade (`set local role authenticated` mais
-- `request.jwt.claims`), porque RLS nao se prova com o dono da tabela: ele
-- passa por cima das policies e o teste daria verde sem testar nada.

-- ---------------------------------------------------------------- fixture
do $fixture$
declare v_lead uuid; v_op uuid;
begin
  insert into auth.users(id) values ('00000000-0000-4000-8000-0000000000c1');

  -- Nasce consultor porque ja existe gestor — invariante da 0033, conferida
  -- de novo aqui porque tudo abaixo depende dela.
  if (select papel from public.usuarios where id='00000000-0000-4000-8000-0000000000c1')
     <> 'consultor' then
    raise exception 'A conta do ensaio nao nasceu consultora';
  end if;

  insert into public.profissionais(nome) values ('Ensaio Travas');
  insert into public.servicos_clinica(nome,ativo) values ('Ensaio de trava',true);

  insert into public.crm_clinica_dados(nome_lead,whatsapp_lead)
  values ('Contato do ensaio de travas','5511930000001') returning id into v_lead;

  -- Uma venda ganha, que e o que o gatilho do cancelamento protege.
  select id into v_op from public.oportunidades where lead_id=v_lead;
  update public.oportunidades
     set nome='Venda do ensaio', status='ganho', valor_proposta=1000,
         servicos_contratados=array['Ensaio de trava']
   where id=v_op;
  if (select fechado_em from public.oportunidades where id=v_op) is null then
    raise exception 'A venda do ensaio nao fechou';
  end if;

  -- E uma oportunidade ABERTA ao lado dela: venda encerrada nao se edita
  -- (regra da 0028), entao seria o alvo errado para provar que o consultor
  -- continua editando o que e dele.
  insert into public.oportunidades(lead_id,nome,status,valor_proposta)
  values (v_lead,'Negociacao aberta do ensaio','negociacao',2000);
end;
$fixture$;

-- ------------------------------------------------------------- consultor
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c1"}';

do $consultor$
declare v_lead uuid; v_op uuid; v_aberta uuid; n integer; t text;
begin
  if auth.uid() <> '00000000-0000-4000-8000-0000000000c1'::uuid then
    raise exception 'A troca de sessao nao funcionou: auth.uid() = %', auth.uid();
  end if;

  select id into v_lead from crm_clinica_dados where whatsapp_lead='5511930000001';
  select id into v_op from oportunidades where lead_id=v_lead and status='ganho';
  select id into v_aberta from oportunidades where lead_id=v_lead and status='negociacao';

  -- LER continua livre: sem preco, jornada e fuso ninguem atende.
  if not exists(select 1 from configuracoes_clinica) then raise exception 'Consultor perdeu a leitura da configuracao'; end if;
  if not exists(select 1 from servicos_clinica where nome='Ensaio de trava') then raise exception 'Consultor perdeu a leitura do catalogo'; end if;
  if not exists(select 1 from profissionais where nome='Ensaio Travas') then raise exception 'Consultor perdeu a leitura da Equipe'; end if;
  if not exists(select 1 from configuracoes_agente) then raise exception 'Consultor perdeu a leitura do agente'; end if;

  -- ESCREVER em configuracao, nao. RLS filtra em silencio no update: a prova
  -- e a contagem de linhas afetadas, nao uma exception.
  update configuracoes_clinica set nome_clinica='Invadida';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Consultor alterou a configuracao da agencia'; end if;

  update configuracoes_agente set prompt='invadido';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Consultor alterou o agente'; end if;

  update profissionais set nome='Invadido' where nome='Ensaio Travas';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Consultor alterou a jornada da Equipe'; end if;

  update servicos_clinica set preco_a_partir_de=1 where nome='Ensaio de trava';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Consultor alterou o catalogo'; end if;

  -- Inserir tambem nao: a policy de insert recusa com exception.
  begin
    insert into servicos_clinica(nome,ativo) values ('Servico do consultor',true);
    raise exception 'UNEXPECTED consultor criou servico no catalogo';
  exception when others then if sqlerrm like 'UNEXPECTED%' then raise; end if; end;

  -- Token de API nem aparece.
  select count(*) into n from api_tokens;
  if n <> 0 then raise exception 'Consultor enxerga % token(s) de API', n; end if;

  -- ATENDER continua livre: a carteira e a etapa 3, nao esta.
  update crm_clinica_dados set nome_lead='Contato renomeado pelo consultor' where id=v_lead;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Consultor perdeu a edicao do contato'; end if;

  update oportunidades set escopo='ajuste do consultor' where id=v_aberta;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Consultor perdeu a edicao da oportunidade'; end if;

  -- APAGAR contato, nao. Delete filtrado por RLS nao levanta erro: some em
  -- silencio, e a prova e o contato continuar existindo.
  delete from crm_clinica_dados where id=v_lead;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Consultor apagou o contato'; end if;
  if not exists(select 1 from crm_clinica_dados where id=v_lead) then
    raise exception 'O contato sumiu mesmo com a policy recusando';
  end if;

  -- CANCELAR venda ganha, nao. Aqui o gatilho fala, e fala explicado.
  begin
    update oportunidades set status='perdido', cancelado_em=now(),
           motivo_cancelamento='tentativa do ensaio' where id=v_op;
    raise exception 'UNEXPECTED consultor cancelou uma venda ganha';
  exception when others then
    if sqlerrm like 'UNEXPECTED%' then raise; end if;
    if sqlerrm not like '%gestor pode cancelar%' then
      raise exception 'A recusa do cancelamento veio sem explicacao: %', sqlerrm;
    end if;
  end;
  select status into t from oportunidades where id=v_op;
  if t <> 'ganho' then raise exception 'A venda saiu de ganho mesmo com a recusa: %', t; end if;
end;
$consultor$;

reset role;
reset request.jwt.claims;

-- ---------------------------------------------------------------- gestor
set local role authenticated;
set local request.jwt.claims = '{"sub":"695b56dc-46f7-40bc-8cd2-dc60dbd7c4cc"}';

do $gestor$
declare v_lead uuid; v_op uuid; n integer;
begin
  if not public.usuario_e_gestor() then raise exception 'A sessao do gestor nao foi reconhecida'; end if;

  select id into v_lead from crm_clinica_dados where whatsapp_lead='5511930000001';
  select id into v_op from oportunidades where lead_id=v_lead and status='ganho';

  update configuracoes_clinica set nome_clinica='Nome do ensaio';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Gestor perdeu a configuracao da agencia'; end if;

  update profissionais set nome='Ensaio Travas II' where nome='Ensaio Travas';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Gestor perdeu a jornada da Equipe'; end if;

  insert into servicos_clinica(nome,ativo) values ('Servico do gestor',true);

  -- Cancelar venda ganha: o motivo e obrigatorio pela 0028, e continua sendo.
  update oportunidades set status='perdido', cancelado_em=now(),
         motivo_cancelamento='cancelada no ensaio de travas' where id=v_op;
  if (select cancelado_em from oportunidades where id=v_op) is null then
    raise exception 'Gestor nao conseguiu cancelar a venda';
  end if;
  -- O projeto fica de pe para revisao, como manda a regra comercial.
  if not exists(select 1 from projetos where oportunidade_id=v_op) then
    raise exception 'Cancelar a venda apagou o projeto';
  end if;

  delete from crm_clinica_dados where id=v_lead;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Gestor perdeu a exclusao de contato'; end if;
end;
$gestor$;

reset role;
reset request.jwt.claims;

-- ----------------------------------------------------- caminho do servidor
-- service_role ignora RLS por natureza; o que precisava de prova e o gatilho
-- do cancelamento, que confere `auth.uid()`. Sem sessao ele deixa passar, e e
-- assim que o agente e os tres trabalhadores seguem funcionando.
do $servidor$
declare v_lead uuid; v_op uuid;
begin
  if auth.uid() is not null then raise exception 'A sessao nao foi encerrada antes do teste de servidor'; end if;

  insert into public.crm_clinica_dados(nome_lead,whatsapp_lead)
  values ('Contato do servidor','5511930000002') returning id into v_lead;
  select id into v_op from public.oportunidades where lead_id=v_lead;
  update public.oportunidades set nome='Venda do servidor', status='ganho',
         valor_proposta=500, servicos_contratados=array['Ensaio de trava'] where id=v_op;

  update public.oportunidades set status='perdido', cancelado_em=now(),
         motivo_cancelamento='cancelada pelo servidor' where id=v_op;
  if (select cancelado_em from public.oportunidades where id=v_op) is null then
    raise exception 'O gatilho barrou o caminho do servidor';
  end if;

  raise notice 'Ensaio de travas concluido sem violacao de invariante.';
end;
$servidor$;
