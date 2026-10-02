import SeletorTema from '../components/SeletorTema'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Eye, EyeOff, Lock } from 'lucide-react'
import zxcvbn from 'zxcvbn'
import { supabase } from '../lib/supabase'
import { FORCA_CORES, FORCA_MINIMA, FORCA_ROTULOS, REGRAS_SENHA } from '../lib/senha'

/* ──────────────────────────────────────────────
   Definir senha — onde o link do convite cai.

   O e-mail novo abre esta página com `#token_hash=…&type=invite` (ou recovery).
   Só o clique em "Confirmar" chama verifyOtp: scanners de e-mail que apenas
   visitam links não gastam o token. Os links antigos com `#access_token=…`
   continuam funcionando enquanto não expirarem.

   Fragmento não viaja para o servidor — é o que mantém o token fora do log do
   nginx. Mexer nisso para passar o token por query string entregaria a chave
   de acesso ao histórico de log da VPS.

   Serve também a quem chegou por "esqueci minha senha": os dois fluxos do
   GoTrue terminam do mesmo jeito, numa sessão temporária que só falta trocar
   a senha.
────────────────────────────────────────────── */

export default function DefinirSenha() {
  const [dadosLink] = useState(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    return {
      tokenHash: hash.get('token_hash'),
      tipoToken: hash.get('type'),
      erroNaUrl: hash.has('error') || new URLSearchParams(window.location.search).has('error'),
    }
  })
  const { tokenHash, tipoToken, erroNaUrl } = dadosLink
  const linkNovo = !!tokenHash && (tipoToken === 'invite' || tipoToken === 'recovery')
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [mostrar, setMostrar] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [estado, setEstado] = useState<'esperando' | 'confirmar' | 'pronta' | 'sem-convite'>(erroNaUrl ? 'sem-convite' : linkNovo ? 'confirmar' : 'esperando')
  const [falhaVerificacao, setFalhaVerificacao] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    let viva = true
    if (erroNaUrl || linkNovo) return

    // A troca do fragmento por sessão é assíncrona: perguntar uma vez só
    // pegaria "sem sessão" e mandaria o convidado para o login, com o link
    // já gasto. Por isso escutamos o evento também.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_evento, sessao) => {
      if (viva && sessao) setEstado('pronta')
    })

    void supabase.auth.getSession().then(({ data }) => {
      if (!viva) return
      if (data.session) { setEstado('pronta'); return }
      // Sem hash na URL não há o que esperar: a pessoa abriu o endereço solta.
      if (!new URLSearchParams(window.location.hash.replace(/^#/, '')).has('access_token')) setEstado('sem-convite')
    })

    return () => { viva = false; subscription.unsubscribe() }
  }, [erroNaUrl, linkNovo])

  async function confirmarLink() {
    if (!tokenHash || (tipoToken !== 'invite' && tipoToken !== 'recovery')) return
    setConfirmando(true)
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: tipoToken })
    setConfirmando(false)
    window.history.replaceState(null, '', window.location.pathname)
    if (error) {
      setFalhaVerificacao(true)
      setEstado('sem-convite')
      return
    }
    setEstado('pronta')
  }

  const nota = senha ? zxcvbn(senha).score : -1
  const itens = [
    ...REGRAS_SENHA.map((regra) => ({ rotulo: regra.rotulo, ok: regra.ok(senha) })),
    { rotulo: 'Força pelo menos Forte', ok: nota >= FORCA_MINIMA },
  ]
  const conferem = confirmacao.length > 0 && senha === confirmacao
  const podeSalvar = itens.every((i) => i.ok) && conferem && !salvando
  const pendencias = [
    ...itens.filter((item) => !item.ok).map((item) => item.rotulo),
    ...(!confirmacao ? ['Confirme a senha'] : !conferem ? ['As senhas precisam coincidir'] : []),
  ]

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault()
    if (!podeSalvar) return
    setSalvando(true); setErro('')

    const { error } = await supabase.auth.updateUser({ password: senha })
    if (error) {
      const mensagem = error.message.toLowerCase()
      setErro(error.code === 'weak_password' || /password|senha/.test(mensagem)
        ? 'O servidor recusou esta senha. Escolha outra combinação e confira os critérios abaixo.'
        : error.status === 401 || error.status === 403
          ? 'Sua sessão expirou. Peça um novo link ao gestor ou use a recuperação de senha no login.'
          : 'Não foi possível salvar a senha agora. Tente novamente em alguns minutos.')
      setSalvando(false)
      return
    }
    navigate('/')
  }

  const campo: React.CSSProperties = {
    width: '100%', padding: '12px 42px 12px 42px', borderRadius: 11,
    border: '1px solid var(--border)', fontSize: 14, fontFamily: 'var(--font-body)',
    color: 'var(--text)', background: 'var(--surface)', outline: 'none', boxSizing: 'border-box',
  }
  const icone: React.CSSProperties = {
    position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
    pointerEvents: 'none', display: 'flex', color: 'var(--muted)',
  }

  return <div style={{ minHeight: '100dvh', background: 'var(--page)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
    <div style={{ position: 'fixed', top: 20, right: 20 }}><SeletorTema /></div>

    <main style={{ width: '100%', maxWidth: 420 }}>
      <div style={{ marginBottom: 26 }}>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text)' }}><span style={{ fontWeight: 500, color: 'var(--muted)' }}>CRM</span></div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: '18px 0 6px' }}>Defina sua senha</h1>
        <p style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
          É a senha que você vai usar para entrar. Ninguém da equipe vê o que você escolher aqui.
        </p>
      </div>

      {estado === 'sem-convite' ? (
        <div className="arc-notice arc-notice-warning">
          <strong>{erroNaUrl || falhaVerificacao ? 'Este link não pode mais ser usado.' : 'Este endereço só funciona pelo link recebido por e-mail.'}</strong>{' '}
          {erroNaUrl || falhaVerificacao
            ? 'O convite pode ter expirado ou já ter sido aberto. Se você já definiu uma senha, entre normalmente. Caso contrário, peça um novo convite ao gestor ou recupere sua senha.'
            : 'Abra o e-mail que você recebeu. Se o link expirou, peça ao gestor para reenviar ou recupere sua senha.'}{' '}
          <a href="/login">Ir para o login</a>.
        </div>
      ) : estado === 'confirmar' ? (
        <div className="arc-card" style={{ padding: 20 }}>
          <p style={{ margin: '0 0 16px', color: 'var(--text)', fontSize: 14, lineHeight: 1.6 }}>
            {tipoToken === 'invite' ? 'Confirme o convite para criar sua senha e acessar o CRM.' : 'Confirme o link para criar uma nova senha.'}
          </p>
          <button type="button" className="arc-button arc-button-primary" onClick={() => void confirmarLink()} disabled={confirmando} style={{ width: '100%' }}>
            {confirmando ? 'Confirmando…' : tipoToken === 'invite' ? 'Aceitar convite' : 'Continuar'}
          </button>
        </div>
      ) : estado === 'esperando' ? (
        <div className="arc-notice arc-notice-info">Conferindo o convite…</div>
      ) : (
        <form onSubmit={(e) => void salvar(e)}>
          {erro && <div className="arc-notice arc-notice-danger" style={{ marginBottom: 16 }}>{erro}</div>}

          <div style={{ position: 'relative', marginBottom: 12 }}>
            <span style={icone}><Lock size={17} /></span>
            <input
              style={campo} type={mostrar ? 'text' : 'password'} value={senha} autoFocus
              onChange={(e) => setSenha(e.target.value)} placeholder="Nova senha"
              aria-label="Nova senha" autoComplete="new-password"
            />
            <button
              type="button" onClick={() => setMostrar((v) => !v)}
              aria-label={mostrar ? 'Ocultar a senha' : 'Mostrar a senha'}
              style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex' }}
            >{mostrar ? <EyeOff size={17} /> : <Eye size={17} />}</button>
          </div>

          {senha && <div style={{ marginBottom: 14 }}>
            <div style={{ height: 4, borderRadius: 999, background: 'var(--border)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${((nota + 1) / 5) * 100}%`, background: FORCA_CORES[nota], transition: 'width .2s' }} />
            </div>
            <span style={{ fontSize: 11.5, color: FORCA_CORES[nota] }}>Força: {FORCA_ROTULOS[nota]} · mínimo para salvar: Forte</span>
          </div>}

          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px', display: 'grid', gap: 5 }}>
            {itens.map((item) => <li key={item.rotulo} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: item.ok ? 'var(--success)' : 'var(--muted)' }}>
              <Check size={14} style={{ opacity: item.ok ? 1 : 0.3 }} />{item.rotulo}
            </li>)}
          </ul>

          <div style={{ position: 'relative', marginBottom: 8 }}>
            <span style={icone}><Lock size={17} /></span>
            <input
              style={campo} type={mostrar ? 'text' : 'password'} value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)} placeholder="Confirmar a senha"
              aria-label="Confirmar a senha" autoComplete="new-password"
            />
          </div>
          {confirmacao.length > 0 && !conferem && <p style={{ fontSize: 12, color: 'var(--danger)', margin: '0 0 12px' }}>As senhas não coincidem.</p>}

          {!podeSalvar && !salvando && <p role="status" aria-live="polite" style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5, margin: '12px 0 0' }}>
            Para salvar, falta: {pendencias.join('; ')}.
            {senha && nota < FORCA_MINIMA && ' Evite sequências, datas e palavras comuns.'}
          </p>}

          <button type="submit" className="arc-button arc-button-primary" disabled={!podeSalvar} style={{ width: '100%', marginTop: 10 }}>
            {salvando ? 'Salvando…' : 'Salvar e entrar'}
          </button>
        </form>
      )}
    </main>
  </div>
}
