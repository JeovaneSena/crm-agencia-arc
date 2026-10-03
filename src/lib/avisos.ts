/**
 * Central de avisos: o que o sistema pede que a equipe olhe.
 *
 * A tabela `avisos` (migração 0011) guarda um aviso aberto por problema. Quem abre e
 * fecha é o servidor; aqui a equipe só lê e dispensa. O contador da barra lateral e a
 * página usam o mesmo gancho, para os dois nunca discordarem.
 *
 * ⚠️ Isto é interface. Quem esconde o aviso "só gestor" do consultor é a policy do banco.
 */
import { useCallback, useEffect, useId, useState } from 'react'
import { supabase } from './supabase'

export type Gravidade = 'info' | 'atencao' | 'critico'

export interface Aviso {
  id: string
  tipo: string
  gravidade: Gravidade
  titulo: string
  detalhe: string | null
  rota: string | null
  contato_id: string | null
  somente_gestor: boolean
  ocorrencias: number
  criado_em: string
  ultima_em: string
  resolvido_em: string | null
  resolucao: 'manual' | 'automatica' | null
}

const COLUNAS = 'id,tipo,gravidade,titulo,detalhe,rota,contato_id,somente_gestor,ocorrencias,criado_em,ultima_em,resolvido_em,resolucao'
const PESO: Record<Gravidade, number> = { critico: 0, atencao: 1, info: 2 }

export const ROTULO_GRAVIDADE: Record<Gravidade, string> = { critico: 'Urgente', atencao: 'Atenção', info: 'Informativo' }

/** Mais grave primeiro; dentro da mesma gravidade, o que se repetiu há menos tempo primeiro. */
export function ordenarAvisos<T extends Pick<Aviso, 'gravidade' | 'ultima_em'>>(avisos: T[]): T[] {
  return [...avisos].sort((a, b) => PESO[a.gravidade] - PESO[b.gravidade] || Date.parse(b.ultima_em) - Date.parse(a.ultima_em))
}

/** "há 5 min", "há 3 h", "há 2 dias". Futuro e relógio torto viram "agora". */
export function haQuanto(iso: string, agora = Date.now()): string {
  const s = Math.max(0, Math.round((agora - Date.parse(iso)) / 1000))
  if (!Number.isFinite(s) || s < 60) return 'agora'
  const min = Math.floor(s / 60)
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.floor(h / 24)
  return `há ${d} ${d === 1 ? 'dia' : 'dias'}`
}

/** A rota vem do banco; só segue se for caminho interno. */
export const rotaSegura = (rota: string | null): string | null => rota && /^\/(?!\/)[A-Za-z0-9/_?=&.%-]*$/.test(rota) ? rota : null

export function useAvisos(incluirResolvidos = false) {
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [versao, setVersao] = useState(0)
  // Cada uso do gancho (barra lateral e página) assina o seu próprio canal; dois com o mesmo nome se atrapalham.
  const sufixo = useId()

  useEffect(() => {
    let vivo = true
    let consulta = supabase.from('avisos').select(COLUNAS)
    consulta = incluirResolvidos
      ? consulta.not('resolvido_em', 'is', null).order('resolvido_em', { ascending: false }).limit(50)
      : consulta.is('resolvido_em', null).limit(200)
    void Promise.resolve(consulta).then(({ data, error }) => {
      if (!vivo) return
      if (error) { setErro('Não foi possível carregar os avisos.'); setCarregando(false); return }
      setErro('')
      setAvisos(incluirResolvidos ? (data as Aviso[]) : ordenarAvisos(data as Aviso[]))
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [incluirResolvidos, versao])

  useEffect(() => {
    const atualizar = () => setVersao(v => v + 1)
    const canal = supabase.channel(`avisos-${incluirResolvidos ? 'resolvidos' : 'abertos'}-${sufixo}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'avisos' }, atualizar)
      .subscribe()
    // Sem realtime (rede, aba em segundo plano) a lista ainda se corrige.
    const intervalo = window.setInterval(() => { if (document.visibilityState === 'visible') atualizar() }, 60000)
    window.addEventListener('focus', atualizar)
    return () => {
      window.clearInterval(intervalo)
      window.removeEventListener('focus', atualizar)
      void supabase.removeChannel(canal)
    }
  }, [incluirResolvidos, sufixo])

  const dispensar = useCallback(async (id: string) => {
    const { error } = await supabase.rpc('aviso_dispensar', { p_id: id })
    if (error) { setErro('Não foi possível dispensar o aviso.'); return false }
    setAvisos(lista => lista.filter(a => a.id !== id))
    setVersao(v => v + 1)
    return true
  }, [])

  return { avisos, carregando, erro, dispensar, recarregar: () => setVersao(v => v + 1) }
}
