import SeletorTema from '../components/SeletorTema'
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Mail, Lock, Sparkles, Code2, Layers } from 'lucide-react'
import { supabase } from '../lib/supabase'

const MAX_ATTEMPTS = 5
const LOCKOUT_SECONDS = 30

/* Cores funcionais da identidade ARC. */
const PRIMARY = 'var(--action)'
const PRIMARY_DARK = 'var(--action-hover)'
const PRIMARY_SOFT = 'var(--accent-soft)'
const BG = 'var(--page)'
const TEXT = 'var(--text)'
const MUTED = 'var(--muted)'
const BORDER = 'var(--border)'

const FONT = "var(--font-body)"

/* Seta da identidade ARC. */
function ArcIcon({ size = 24, color = 'currentColor', strokeWidth = 1.7 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 19 19 5M6 5h13v13" />
    </svg>
  )
}

/* Procedimentos exibidos no painel da marca.
   Ficam fixos aqui de propósito: esta tela é PRÉ-LOGIN, e o RLS bloqueia
   qualquer leitura de `catalogo_servicos` sem usuário autenticado. */
const PROCEDIMENTOS = [
  { Icon: Sparkles, nome: 'Contatos', desc: 'Histórico e informações em um só lugar' },
  { Icon: Code2, nome: 'Oportunidades', desc: 'Acompanhe cada negociação' },
  { Icon: Layers, nome: 'Agenda', desc: 'Organize os próximos atendimentos' },
]

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const [recovering, setRecovering] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const [lockout, setLockout] = useState(0) // seconds remaining
  const navigate = useNavigate()

  // Countdown timer during lockout
  useEffect(() => {
    if (lockout <= 0) return
    const timer = setInterval(() => {
      setLockout((s) => {
        if (s <= 1) { clearInterval(timer); return 0 }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [lockout])

  const isLocked = lockout > 0

  const recoverPassword = async () => {
    setError('')
    setRecoveryMessage('')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Informe um e-mail válido acima para receber o link.')
      return
    }
    setRecovering(true)
    try {
      const { error: recoveryError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/definir-senha`,
      })
      if (recoveryError) {
        setError(recoveryError.status === 429
          ? 'Muitas solicitações de e-mail. Aguarde alguns minutos e tente novamente.'
          : 'Não foi possível solicitar o link agora. Tente novamente em alguns minutos.')
        return
      }
      setRecoveryMessage('Se houver uma conta com esse e-mail, você receberá um link para definir uma nova senha. Confira também a caixa de spam.')
    } catch {
      setError('Não foi possível solicitar o link agora. Confira a conexão e tente novamente.')
    } finally {
      setRecovering(false)
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isLocked) return
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      const newAttempts = attempts + 1
      setAttempts(newAttempts)
      if (newAttempts >= MAX_ATTEMPTS) {
        setAttempts(0)
        setLockout(LOCKOUT_SECONDS)
        setError(`Muitas tentativas. Aguarde ${LOCKOUT_SECONDS} segundos para tentar novamente.`)
      } else {
        setError(`E-mail ou senha incorretos. (${newAttempts}/${MAX_ATTEMPTS} tentativas)`)
      }
      setLoading(false)
      return
    }

    navigate('/')
  }

  const inputWrapStyle: React.CSSProperties = { position: 'relative' }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px 14px 12px 42px',
    borderRadius: 11,
    border: `1px solid ${BORDER}`,
    fontSize: 14,
    fontFamily: FONT,
    color: TEXT,
    background: 'var(--surface)',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    opacity: isLocked ? 0.5 : 1,
  }

  const iconInInput: React.CSSProperties = {
    position: 'absolute',
    left: 14,
    top: '50%',
    transform: 'translateY(-50%)',
    pointerEvents: 'none',
    display: 'flex',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: TEXT,
    display: 'block',
    marginBottom: 7,
  }

  const onFocusRing = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = PRIMARY
    e.target.style.boxShadow = '0 0 0 3px var(--accent-soft)'
  }
  const onBlurRing = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = BORDER
    e.target.style.boxShadow = 'none'
  }

  return (
    <div className="login-page" style={{ minHeight: '100dvh', display: 'flex', fontFamily: FONT, background: BG }}>

      {/* ================= PAINEL DA MARCA (esquerda) ================= */}
      <aside
        className="login-brand"
        style={{
          flex: '1 1 46%',
          background: 'linear-gradient(160deg, var(--brand-navy), var(--brand-ink))',
          padding: '56px 52px',
          flexDirection: 'column',
          justifyContent: 'space-between',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Halos decorativos */}
        <div style={{
          position: 'absolute', width: 420, height: 420, borderRadius: '50%',
          background: 'rgba(255,255,255,0.05)', top: -140, right: -120,
        }} />
        <div style={{
          position: 'absolute', width: 300, height: 300, borderRadius: '50%',
          background: 'rgba(255,255,255,0.04)', bottom: -110, left: -80,
        }} />

        {/* Marca */}
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 54, height: 54, borderRadius: 15,
              background: 'rgba(255,255,255,0.14)',
              border: '1px solid rgba(255,255,255,0.22)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <ArcIcon size={28} color="var(--on-solid)" strokeWidth={1.6} />
            </div>
            <div>
              <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--on-solid)', letterSpacing: -0.2 }}>
                CRM
              </div>
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.72)', marginTop: 1 }}>
                Contatos, oportunidades e agenda
              </div>
            </div>
          </div>
        </div>

        {/* Frase + procedimentos */}
        <div style={{ position: 'relative' }}>
          <h2 style={{
            fontSize: 30, lineHeight: 1.25, fontWeight: 700, color: 'var(--on-solid)',
            margin: 0, letterSpacing: -0.6, maxWidth: 380,
          }}>
            Organize o relacionamento com seus clientes.
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 34 }}>
            {PROCEDIMENTOS.map(({ Icon, nome, desc }) => (
              <div key={nome} style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 11, flexShrink: 0,
                  background: 'rgba(255,255,255,0.12)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={18} color="var(--on-solid)" strokeWidth={1.8} />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--on-solid)' }}>{nome}</div>
                  <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.68)' }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ position: 'relative', fontSize: 12, color: 'rgba(255,255,255,0.75)' }}>
          Acesso restrito à equipe da empresa
        </div>
      </aside>

      {/* ================= FORMULÁRIO (direita) ================= */}
      <main style={{
        flex: '1 1 54%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '40px 24px',
      }}>
        <div className="fade-in" style={{ width: '100%', maxWidth: 380 }}>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 24 }}><SeletorTema compacto /></div>
          {/* Marca compacta — só aparece quando o painel lateral some */}
          <div className="login-mobile-brand" style={{
            alignItems: 'center', gap: 12, marginBottom: 30,
          }}>
            <div style={{
              width: 46, height: 46, borderRadius: 13, background: PRIMARY_SOFT,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <ArcIcon size={25} color="var(--accent)" strokeWidth={1.7} />
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: TEXT }}>CRM</div>
          </div>

          <h1 style={{ fontSize: 25, fontWeight: 700, color: TEXT, margin: 0, letterSpacing: -0.4 }}>
            Acesse sua conta
          </h1>
          <p style={{ fontSize: 13.5, color: MUTED, marginTop: 7, marginBottom: 30 }}>
            Entre com seus dados para continuar
          </p>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 17 }}>
            <div>
              <label htmlFor="login-email" style={labelStyle}>E-mail</label>
              <div style={inputWrapStyle}>
                <span style={iconInInput}><Mail size={16} color={MUTED} /></span>
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  required
                  disabled={isLocked}
                  autoComplete="email"
                  style={inputStyle}
                  onFocus={onFocusRing}
                  onBlur={onBlurRing}
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-password" style={labelStyle}>Senha</label>
              <div style={inputWrapStyle}>
                <span style={iconInInput}><Lock size={16} color={MUTED} /></span>
                <input
                  id="login-password"
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  disabled={isLocked}
                  autoComplete="current-password"
                  style={{ ...inputStyle, paddingRight: 42 }}
                  onFocus={onFocusRing}
                  onBlur={onBlurRing}
                />
                <button
                  type="button"
                  onClick={() => setShowPass((s) => !s)}
                  aria-label={showPass ? 'Ocultar senha' : 'Mostrar senha'}
                  style={{
                    position: 'absolute', right: 12, top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: 0, display: 'flex', alignItems: 'center',
                  }}
                >
                  {showPass ? <EyeOff size={16} color={MUTED} /> : <Eye size={16} color={MUTED} />}
                </button>
              </div>
            </div>

            {error && (
              <div role="alert" style={{
                background: isLocked ? 'var(--warning-soft)' : 'var(--danger-soft)',
                border: `1px solid ${isLocked ? 'var(--warning-border)' : 'var(--danger-border)'}`,
                borderRadius: 9,
                padding: '10px 14px',
                fontSize: 13,
                color: isLocked ? 'var(--warning)' : 'var(--danger)',
              }}>
                {isLocked ? (
                  <span>Acesso bloqueado. Tente novamente em <strong>{lockout}s</strong>.</span>
                ) : error}
              </div>
            )}

            {recoveryMessage && <div role="status" className="arc-notice arc-notice-success">{recoveryMessage}</div>}

            <button
              type="submit"
              disabled={loading || isLocked}
              style={{
                background: isLocked ? 'var(--border-strong)' : loading ? PRIMARY_DARK : PRIMARY,
                color: 'var(--on-action)',
                border: 'none',
                borderRadius: 11,
                padding: '13px',
                fontSize: 14.5,
                fontWeight: 600,
                fontFamily: FONT,
                cursor: loading || isLocked ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s',
                marginTop: 5,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
              onMouseEnter={(e) => {
                if (!loading && !isLocked) e.currentTarget.style.background = PRIMARY_DARK
              }}
              onMouseLeave={(e) => {
                if (!loading && !isLocked) e.currentTarget.style.background = PRIMARY
              }}
            >
              {isLocked ? (
                `Bloqueado (${lockout}s)`
              ) : loading ? (
                <>
                  <div style={{
                    width: 16, height: 16,
                    border: '2px solid rgba(255,255,255,0.4)', borderTopColor: 'var(--on-solid)',
                    borderRadius: '50%', animation: 'spin 0.7s linear infinite',
                  }} />
                  Entrando...
                </>
              ) : 'Entrar'}
            </button>
            <button type="button" onClick={() => void recoverPassword()} disabled={recovering}
              style={{ alignSelf: 'center', border: 0, background: 'none', color: 'var(--accent)', cursor: recovering ? 'wait' : 'pointer', font: 'inherit', fontSize: 13, padding: 4 }}>
              {recovering ? 'Enviando link…' : 'Esqueci minha senha ou meu convite expirou'}
            </button>
          </form>
        </div>
      </main>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }

        .login-brand { display: flex; }
        .login-mobile-brand { display: none; }

        @media (max-width: 900px) {
          .login-brand { display: none; }
          .login-mobile-brand { display: flex; }
        }
      `}</style>
    </div>
  )
}
