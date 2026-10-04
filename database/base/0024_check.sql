-- Exercita reservas, conferência final, opt-out, incerteza e permissões reais.
do $$
declare g uuid:=gen_random_uuid(); k uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); r uuid; a uuid; o uuid;
 e public.automacao_envios; n integer; m uuid; regra jsonb; tok uuid;
begin
 insert into auth.users(id) values(g),(k); update public.usuarios set papel='gestor' where id=g;
 update public.usuarios set papel='consultor' where id=k;
 insert into public.catalogo_servicos(nome) values('Reunião automação');
 insert into public.contatos_dados(id,nome,whatsapp) values(c,'Ana','551199990024');
 insert into public.reunioes(contato_id,assunto,data_reuniao) values(c,'Reunião automação',now()+interval '59 minutes') returning id into r;
 perform set_config('request.jwt.claim.sub',g::text,true);
 set local role authenticated;
 insert into public.automacao_regras(nome,tipo,canal,minutos,texto) values('Uma hora antes','lembrete','uazapi',60,'Olá {{nome}}') returning id into a;
 reset role;
 select count(*) into n from public.automacao_reivindicar(); if n<>0 then raise exception 'FAIL: regra desligada enviou'; end if;
 update public.automacao_regras set ativa=true where id=a;
 select count(*) into n from public.automacao_reivindicar(); if n<>0 then raise exception 'FAIL: sem autorização enviou'; end if;
 -- Recria compromisso: fila sem autorização fica cancelada definitivamente.
 update public.reunioes set data_reuniao=data_reuniao+interval '30 seconds' where id=r;
 insert into public.automacao_permissoes(contato_id,autorizado,fonte) values(c,true,'Autorizou por mensagem.');
 select * into e from public.automacao_reivindicar() where contato_id=c;
 if e.id is null or e.estado<>'reservado' or e.token is null then raise exception 'FAIL: não reservou lembrete elegível'; end if;
 select count(*) into n from public.automacao_reivindicar(); if n<>0 then raise exception 'FAIL: reservou duas vezes'; end if;
 select to_jsonb(x) into regra from public.automacao_regras x where id=a;
 m:=public.automacao_marcar_chamada(e.id,gen_random_uuid(),'Olá Ana','551199990024',regra);
 if m is not null then raise exception 'FAIL: token errado iniciou chamada'; end if;
 update public.reunioes set status='cancelada' where id=r;
 m:=public.automacao_marcar_chamada(e.id,e.token,'Olá Ana','551199990024',regra);
 if m is not null then raise exception 'FAIL: reunião cancelada enviou'; end if;
 -- Nova reunião: remarcar deixa a antiga cancelada e gera só o novo horário.
 update public.reunioes set status='agendada',data_reuniao=now()+interval '58 minutes' where id=r;
 select * into e from public.automacao_reivindicar() where contato_id=c;
 -- Consentimento de marketing é conferido também no banco, depois de reservar.
 if public.automacao_marcar_chamada(e.id,e.token,'Olá Ana','551199990024',regra,true) is not null then raise exception 'FAIL: marketing sem consentimento enviou'; end if;
 update public.reunioes set data_reuniao=now()+interval '57 minutes' where id=r;
 select * into e from public.automacao_reivindicar() where contato_id=c;
 m:=public.automacao_marcar_chamada(e.id,e.token,'Olá Ana','551199990024',regra);
 if m is null then raise exception 'FAIL: não iniciou envio'; end if;
 if public.automacao_marcar_chamada(e.id,e.token,'Olá Ana','551199990024',regra) is not null then raise exception 'FAIL: iniciou HTTP duas vezes'; end if;
 perform public.automacao_finalizar(e.id,gen_random_uuid(),'enviado','externo-errado');
 if (select estado from public.automacao_envios where id=e.id)<>'chamando' then raise exception 'FAIL: token errado finalizou'; end if;
 update public.automacao_envios set reservado_em=now()-interval '10 minutes' where id=e.id;
 perform public.automacao_reivindicar();
 if (select estado from public.automacao_envios where id=e.id)<>'incerto' or (select estado_envio from public.mensagens_whatsapp where id=m)<>'incerto' then raise exception 'FAIL: lease HTTP vencido não ficou incerto'; end if;
 select count(*) into n from public.automacao_reivindicar(); if n<>0 then raise exception 'FAIL: reenvio de incerto'; end if;
 -- Follow-up: não reaproveita regra terminal; para ao receber resposta ou ao assumir.
 update public.automacao_regras set ativa=false where id=a;
 update public.reunioes set status='cancelada' where id=r;
 insert into public.oportunidades(contato_id,nome) values(c,'Proposta de teste') returning id into o;
 update public.oportunidade_eventos set created_at=now()-interval '2 hours' where oportunidade_id=o;
 update public.oportunidades set created_at=now()-interval '2 hours' where id=o;
 insert into public.automacao_regras(nome,tipo,canal,minutos,etapa,texto,ativa) values('Retomar contato','followup','uazapi',60,'novo_lead','Podemos conversar?',true) returning id into a;
 select * into e from public.automacao_reivindicar() where contato_id=c;
 if e.id is null then raise exception 'FAIL: follow-up não foi reservado'; end if;
 -- A equipe pode assumir, adiar ou escrever depois da reserva: a conferência final precisa parar.
 update public.contatos_dados set assumido_por=g where id=c;
 if public.automacao_elegivel(e.id) then raise exception 'FAIL: follow-up com conversa assumida'; end if;
 update public.contatos_dados set assumido_por=null,adiada_ate=now()+interval '1 hour' where id=c;
 if public.automacao_elegivel(e.id) then raise exception 'FAIL: follow-up com conversa adiada'; end if;
 update public.contatos_dados set adiada_ate=null where id=c;
 insert into public.mensagens_whatsapp(contato_id,autor,conteudo,enviada_por)
 values(c,'atendente','A equipe está cuidando.',g) returning id into m;
 if public.automacao_elegivel(e.id) then raise exception 'FAIL: follow-up após mensagem da equipe'; end if;
 delete from public.mensagens_whatsapp where id=m;
 insert into public.reunioes(contato_id,assunto,data_reuniao)
 values(c,'Reunião automação',now()+interval '1 day') returning id into r;
 if public.automacao_elegivel(e.id) then raise exception 'FAIL: follow-up com reunião futura'; end if;
 update public.reunioes set status='cancelada' where id=r;
 if not public.automacao_elegivel(e.id) then raise exception 'FAIL: follow-up livre permaneceu bloqueado'; end if;
 insert into public.mensagens_whatsapp(contato_id,autor,conteudo) values(c,'cliente','Tenho interesse');
 select to_jsonb(x) into regra from public.automacao_regras x where id=a;
 if public.automacao_marcar_chamada(e.id,e.token,'Podemos conversar?','551199990024',regra) is not null then raise exception 'FAIL: enviou depois da resposta'; end if;
 perform public.automacao_bloquear(c,true);
 if (select autorizado from public.automacao_permissoes where contato_id=c) then raise exception 'FAIL: parada não revogou'; end if;
 -- Equipe lê, só gestor configura; ninguém do navegador reivindica ou finaliza.
 set local role authenticated; perform set_config('request.jwt.claim.sub',k::text,true);
 update public.automacao_regras set ativa=false where id=a;
 reset role;
 if not (select ativa from public.automacao_regras where id=a) then raise exception 'FAIL: consultor mudou a regra'; end if;
 set local role authenticated;
 begin perform public.automacao_reivindicar(); raise exception 'FAIL: navegador reivindicou'; exception when insufficient_privilege then null; end;
 begin perform public.automacao_bloquear(c); raise exception 'FAIL: navegador bloqueou via RPC do servidor'; exception when insufficient_privilege then null; end;
 begin insert into public.automacao_permissoes(contato_id,autorizado,fonte) values(c,true,'Falsa autorização'); raise exception 'FAIL: consultor autorizou'; exception when insufficient_privilege then null; end;
 reset role;
 set local role anon;
 begin perform count(*) from public.automacao_envios; raise exception 'FAIL: anon leu'; exception when insufficient_privilege then null; end;
 reset role;
end $$;
