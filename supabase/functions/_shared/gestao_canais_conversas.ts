import {selecionar,rpc} from './db.ts'
import {classificarOptOut} from './optout.ts'
import {UAZAPI} from './uazapi.ts'
export async function conferirGestao(contato:string):Promise<void>{
 const [cfg,c,p,m]=await Promise.all([selecionar<{provedor:string}>('conversas_config?select=provedor&limit=1'),selecionar<{whatsapp:string;assumido_por:string|null}>(`contatos_dados?select=whatsapp,assumido_por&id=eq.${contato}`),selecionar<{autorizado:boolean}>(`automacao_permissoes?select=autorizado&contato_id=eq.${contato}`),selecionar<{conteudo:string|null}>(`mensagens_whatsapp?select=conteudo&contato_id=eq.${contato}&autor=eq.cliente&order=criada_em.desc&limit=1`)])
 if(classificarOptOut(m[0]?.conteudo)!=='nenhum'){await rpc('automacao_bloquear',{p_contato:contato,p_marketing:false});throw Error('Pedido de parada')}
 if(cfg[0]?.provedor!=='uazapi'||!UAZAPI.configurada()||!p[0]?.autorizado||!c[0]?.whatsapp||c[0].assumido_por)throw Error('Contato ou canal indisponível')
}
export async function enviarGestao(contato:string,texto:string):Promise<string>{
 const c=(await selecionar<{whatsapp:string}>(`contatos_dados?select=whatsapp&id=eq.${contato}`))[0]
 if(!c?.whatsapp)throw Error('Contato indisponível')
 const id=await UAZAPI.enviarTexto(c.whatsapp,texto);if(!id)throw Error('Sem confirmação');return id
}
