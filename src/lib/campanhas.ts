import { supabase } from './supabase'

/**
 * Campanhas (módulo `campanhas`): tipos, rótulos e as chamadas da tela.
 * A tela lê e configura direto no banco (RLS: a equipe lê, só o gestor escreve); só `modelos` e `conta`
 * passam pela função `campanhas`, porque precisam das chaves da Meta.
 */

export type EstadoCampanha = 'rascunho' | 'pronta' | 'enviando' | 'pausada' | 'concluida' | 'cancelada'
export type EstadoDestinatario = 'excluido' | 'pendente' | 'processando' | 'aceito' | 'retido' | 'falhou' | 'incerto' | 'ignorado' | 'cancelado' | 'enviado' | 'entregue' | 'lido'
export type OrigemParametro = 'nome' | 'primeiro_nome' | 'empresa' | 'fixo'

export interface ParametroMapeado { tipo: 'header' | 'body'; posicao: number; origem: OrigemParametro; valor?: string }
export interface FiltrosPublico { status?: string[]; interesse?: string; contato_ids?: string[] }
export interface CampoModelo { tipo: string; quantidade: number; texto: string }

export interface ModeloCampanha {
  id: string; nome: string; idioma: string; status: string; categoria: string | null; qualidade: string | null
  compativel: boolean; motivo: string | null; campos: CampoModelo[]
}

export interface Campanha {
  id: string; nome: string; objetivo: string | null; estado: EstadoCampanha
  modelo_id: string; modelo_nome: string; modelo_idioma: string; modelo_snapshot: { campos?: CampoModelo[] }
  mapeamento_parametros: ParametroMapeado[]; filtros_publico: FiltrosPublico
  publico_congelado_em: string | null; revisao_hash: string | null
  limite_destinatarios: number; intervalo_minimo_horas: number
  criada_em: string; iniciada_em: string | null; pausada_em: string | null; cancelada_em: string | null; concluida_em: string | null; motivo: string | null
}

export interface CampanhaLinha {
  id: string; nome: string; objetivo: string | null; estado: EstadoCampanha; modelo_nome: string
  criada_em: string; iniciada_em: string | null; concluida_em: string | null; motivo: string | null; revisao_hash: string | null
  aptos: number; excluidos: number; na_fila: number; aceitos: number; entregues: number; lidos: number; falhas: number; incertos: number
}

export interface Destinatario {
  id: string; contato_id: string; whatsapp: string | null; nome: string | null; valores: Record<string, string[]>
  apto: boolean; motivo_exclusao: string | null; estado: EstadoDestinatario; erro: string | null; tentativas: number
}
export interface EventoCampanha { id: string; tipo: string; descricao: string | null; criado_em: string }
export interface Controle { pausado: boolean; pausa_motivo: string | null; limite_por_minuto: number; limite_diario: number; usados_no_dia: number }

export const ROTULO_ESTADO: Record<EstadoCampanha, string> = {
  rascunho: 'Rascunho', pronta: 'Pronta para revisar', enviando: 'Enviando', pausada: 'Pausada', concluida: 'Concluída', cancelada: 'Cancelada',
}
export const COR_ESTADO: Record<EstadoCampanha, string> = {
  rascunho: 'muted', pronta: 'info', enviando: 'accent', pausada: 'warning', concluida: 'success', cancelada: 'danger',
}
export const ROTULO_DESTINATARIO: Record<EstadoDestinatario, string> = {
  excluido: 'Fora da lista', pendente: 'Na fila', processando: 'Enviando', aceito: 'Enviado', retido: 'Retido pela Meta', falhou: 'Falhou',
  incerto: 'Sem confirmação', ignorado: 'Não enviado', cancelado: 'Cancelado', enviado: 'Enviado', entregue: 'Entregue', lido: 'Lido',
}
export const ROTULO_EXCLUSAO: Record<string, string> = {
  sem_whatsapp: 'Sem WhatsApp válido', sem_consentimento: 'Sem autorização registrada', pediu_para_parar: 'Pediu para parar de receber',
  recebeu_campanha_recentemente: 'Recebeu outra campanha há pouco', parametro_vazio: 'Falta dado para preencher o modelo', acima_do_limite: 'Acima do limite da campanha',
}
export const ORIGENS: { valor: OrigemParametro; rotulo: string }[] = [
  { valor: 'primeiro_nome', rotulo: 'Primeiro nome do contato' }, { valor: 'nome', rotulo: 'Nome completo do contato' },
  { valor: 'empresa', rotulo: 'Empresa do contato' }, { valor: 'fixo', rotulo: 'Texto fixo' },
]

/** Os parâmetros que o modelo pede, na ordem em que a Meta os numera. Rodapé e botões não têm. */
export function parametrosDoModelo(campos: CampoModelo[]): { tipo: 'header' | 'body'; posicao: number }[] {
  return campos.filter(c => (c.tipo === 'header' || c.tipo === 'body') && c.quantidade > 0)
    .flatMap(c => Array.from({ length: c.quantidade }, (_, i) => ({ tipo: c.tipo as 'header' | 'body', posicao: i + 1 })))
}

/** O texto como o contato vai ler, com os valores no lugar de {{1}}, {{2}}... */
export function previaDoModelo(campos: CampoModelo[], valores: Record<string, string[]>): string {
  return campos.map(c => c.texto.replace(/\{\{(\d+)\}\}/g, (_, i) => valores[c.tipo]?.[Number(i) - 1] ?? `{{${i}}}`)).join('\n')
}

export const quando = (iso: string | null) => iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'

/** Chama a função `campanhas` (só `GET /modelos` e `GET /conta`) com a sessão de quem está logado. */
export async function chamarCampanhas<T>(rota: string): Promise<T> {
  const { data } = await supabase.auth.getSession()
  if (!data.session) throw new Error('Sessão expirada. Entre de novo.')
  const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/campanhas${rota}`, { headers: { Authorization: `Bearer ${data.session.access_token}` } })
  const d = await r.json().catch(() => null)
  if (!r.ok || !d?.ok) {
    const motivo = d?.motivo
    throw new Error(motivo === 'nao_configurado' ? 'A Meta ainda não foi configurada no servidor (chaves e número).' : motivo === 'somente_gestor' ? 'Só o gestor vê os modelos da Meta.' : 'Não consegui falar com a Meta agora.')
  }
  return d as T
}

/** Erros do banco que já vêm escritos para a pessoa (regras 22023/55000/42501); o resto vira texto genérico. */
export function mensagemDoBanco(e: { code?: string; message?: string } | null, padrao: string): string {
  return e && (e.code === '22023' || e.code === '55000') && e.message ? e.message : e?.code === '42501' ? 'Só o gestor faz isso.' : padrao
}
