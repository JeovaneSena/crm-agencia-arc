import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { definirNomeDoAgente } from '../lib/agente'
import { PageHeader, LoadingState, Notice, Card } from '../components/ui'

type Modo = 'desligada' | 'teste' | 'ao_vivo'
interface Config {
  modo: Modo; nome: string; modelo: string; instrucoes: string | null
  numeros_teste: string[]; max_respostas: number; espera_segundos: number; updated_at: string
}
interface Resposta { mensagem_id: string; estado: string; motivo: string | null; created_at: string }

const MODOS: { valor: Modo; titulo: string; texto: string }[] = [
  { valor: 'desligada', titulo: 'Desligado', texto: 'Não responde ninguém. É o estado de fábrica.' },
  { valor: 'teste', titulo: 'Teste', texto: 'Responde só os números da lista abaixo, em qualquer conversa. Use para experimentar com o seu próprio WhatsApp.' },
  { valor: 'ao_vivo', titulo: 'Ao vivo', texto: 'Responde as conversas em que o assistente estiver ligado. Contatos novos já entram com ele ligado; o histórico fica desligado até alguém ligar.' },
]
const MODELOS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-4-5-20251001']
const ROTULO_ESTADO: Record<string, string> = {
  respondida: 'Respondida', encaminhada: 'Encaminhada à equipe', ignorada: 'Ignorada', falhou: 'Falhou', processando: 'Em andamento',
}
const ROTULO_MOTIVO: Record<string, string> = {
  ia_desligada: 'assistente desligado', fora_da_lista_de_teste: 'número fora da lista de teste', ia_desligada_na_conversa: 'desligado nesta conversa',
  nao_e_texto: 'não era texto', sem_texto: 'mensagem vazia', conversa_assumida: 'a equipe assumiu', limite_de_respostas: 'limite de respostas da conversa',
  equipe_atendendo: 'a equipe respondeu há pouco', ja_reservada: 'mensagem repetida', mensagem_mais_nova: 'o cliente escreveu de novo',
  erro_interno: 'erro (confira a chave do modelo)', envio_falhou: 'o envio não foi confirmado', resposta_vazia: 'o modelo não respondeu',
  historico_sem_pergunta: 'sem pergunta do cliente', prazo_esgotado: 'demorou demais', sem_configuracao: 'sem configuração',
}
const campo = { width: '100%', padding: 10, border: '1px solid var(--border)', borderRadius: 8, font: 'inherit', boxSizing: 'border-box' as const }
const botao = { padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', font: 'inherit' }

export default function Assistente() {
  const [config, setConfig] = useState<Config | null>(null)
  const [numeros, setNumeros] = useState('')
  const [respostas, setRespostas] = useState<Resposta[]>([])
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [salvo, setSalvo] = useState(false)

  useEffect(() => {
    let vivo = true
    async function carregar() {
      const [c, r] = await Promise.all([
        supabase.from('assistente_config').select('*').limit(1).maybeSingle(),
        supabase.from('assistente_respostas').select('mensagem_id,estado,motivo,created_at').order('created_at', { ascending: false }).limit(50),
      ])
      if (!vivo) return
      if (c.error || !c.data) { setErro('Não foi possível carregar a configuração do assistente. Atualize a página.'); setCarregando(false); return }
      setConfig(c.data as Config)
      setNumeros(((c.data as Config).numeros_teste ?? []).join('\n'))
      setRespostas((r.data ?? []) as Resposta[])
      setCarregando(false)
    }
    void carregar()
    return () => { vivo = false }
  }, [])

  async function salvar() {
    if (!config) return
    setSalvando(true); setErro(''); setSalvo(false)
    const { error } = await supabase.rpc('assistente_salvar_config', {
      p_modo: config.modo, p_nome: config.nome, p_modelo: config.modelo, p_instrucoes: config.instrucoes ?? '',
      p_numeros: numeros.split(/[\n,;]+/).map(n => n.trim()).filter(Boolean),
      p_max_respostas: config.max_respostas, p_espera: config.espera_segundos,
    })
    setSalvando(false)
    if (error) {
      // As regras de validação moram no banco e já vêm escritas para a pessoa; erro de rede ou permissão não.
      setErro(error.code === '22023' ? error.message : error.code === '42501' ? 'Só o gestor altera o assistente.' : error.code === '23514' ? 'Algum valor está fora do permitido (nome até 40 letras, modelo no formato claude-… ou gpt-…).' : 'Não foi possível salvar. Tente novamente.')
      return
    }
    definirNomeDoAgente(config.nome)
    setSalvo(true)
  }

  if (carregando) return <div className="page-content"><LoadingState label="Carregando o assistente…" /></div>
  if (!config) return <div className="page-content"><PageHeader title="Assistente" /><p role="alert" style={{ color: 'var(--danger)' }}>{erro}</p></div>

  const contagem = respostas.reduce<Record<string, number>>((m, r) => ({ ...m, [r.estado]: (m[r.estado] ?? 0) + 1 }), {})
  const muda = (parte: Partial<Config>) => { setConfig({ ...config, ...parte }); setSalvo(false) }

  return <div className="page-content">
    <PageHeader title="Assistente" description="Responde o WhatsApp por você, consulta serviços e horários e chama a equipe quando não sabe. Nunca agenda sozinho." />
    <form aria-label="Configuração do assistente" onSubmit={e => { e.preventDefault(); void salvar() }} style={{ display: 'grid', gap: 22, maxWidth: 760 }}>
      <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
        <legend style={{ fontWeight: 700, marginBottom: 6 }}>Quando responde</legend>
        {MODOS.map(m => <label key={m.valor} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 12, border: `1px solid ${config.modo === m.valor ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10, cursor: 'pointer' }}>
          <input type="radio" name="modo" value={m.valor} checked={config.modo === m.valor} onChange={() => muda({ modo: m.valor })} style={{ marginTop: 3 }} />
          <span><strong>{m.titulo}</strong><br /><span style={{ fontSize: 13, color: 'var(--muted)' }}>{m.texto}</span></span>
        </label>)}
      </fieldset>

      <label>Números de teste (um por linha, com DDD)
        <textarea rows={3} style={campo} value={numeros} onChange={e => { setNumeros(e.target.value); setSalvo(false) }} placeholder="11 98765-4321" />
      </label>

      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <label>Nome do assistente<input required maxLength={40} style={campo} value={config.nome} onChange={e => muda({ nome: e.target.value })} /></label>
        <label>Modelo de IA<input required list="modelos-ia" style={campo} value={config.modelo} onChange={e => muda({ modelo: e.target.value })} />
          <datalist id="modelos-ia">{MODELOS.map(m => <option key={m} value={m} />)}</datalist></label>
        <label>Máximo de respostas por conversa<input type="number" min={1} max={100} style={campo} value={config.max_respostas} onChange={e => muda({ max_respostas: Number(e.target.value) })} /></label>
        <label>Espera antes de responder (segundos)<input type="number" min={0} max={30} style={campo} value={config.espera_segundos} onChange={e => muda({ espera_segundos: Number(e.target.value) })} /></label>
      </div>

      <label>Informações do negócio
        <span style={{ display: 'block', fontSize: 13, color: 'var(--muted)', margin: '2px 0 6px' }}>Endereço, horário de funcionamento, formas de pagamento, avisos. É só o que o assistente pode afirmar sobre o negócio; o que não estiver aqui ele passa para a equipe. Obrigatório para ligar ao vivo.</span>
        <textarea rows={8} maxLength={6000} style={campo} value={config.instrucoes ?? ''} onChange={e => muda({ instrucoes: e.target.value })} />
      </label>

      <Notice tone="info">A chave do modelo (Anthropic ou OpenAI) fica nos segredos do servidor, nunca nesta tela. Sem ela, as respostas aparecem abaixo como erro.</Notice>
      {erro && <p role="alert" style={{ color: 'var(--danger)', margin: 0 }}>{erro}</p>}
      {salvo && <p role="status" style={{ color: 'var(--success)', margin: 0 }}>Configuração salva.</p>}
      <div><button disabled={salvando} style={{ ...botao, background: 'var(--action)', color: 'var(--on-action)' }}><Save size={15} /> {salvando ? 'Salvando…' : 'Salvar'}</button></div>
    </form>

    <Card style={{ marginTop: 32, maxWidth: 760, padding: 18 }}>
      <h2 style={{ fontSize: 16, marginTop: 0 }}>Últimas {respostas.length} tentativas</h2>
      {respostas.length === 0 ? <p style={{ color: 'var(--muted)', margin: 0 }}>Nenhuma ainda.</p> : <>
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>{Object.entries(contagem).map(([e, n]) => `${n} ${ROTULO_ESTADO[e]?.toLowerCase() ?? e}`).join(' · ')}</p>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6, fontSize: 13 }}>
          {respostas.slice(0, 10).map(r => <li key={r.mensagem_id}>
            <strong>{ROTULO_ESTADO[r.estado] ?? r.estado}</strong>{r.motivo ? ` · ${ROTULO_MOTIVO[r.motivo] ?? r.motivo}` : ''}
            <span style={{ color: 'var(--muted)' }}> · {new Date(r.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
          </li>)}
        </ul></>}
    </Card>
  </div>
}
