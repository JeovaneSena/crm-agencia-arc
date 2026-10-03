import SeletorTema from '../components/SeletorTema'
import React, { useEffect, useRef, useState } from 'react'
import {
  User, Clock, Upload, Save, MapPin, Check, Eye, EyeOff,
  BriefcaseBusiness, KeyRound, Trash2, KanbanSquare, Tag,
} from 'lucide-react'
import zxcvbn from 'zxcvbn'
import { FORCA_CORES, FORCA_MINIMA, FORCA_ROTULOS, REGRAS_SENHA } from '../lib/senha'
import { supabase } from '../lib/supabase'
import type { Usuario, ConfiguracoesNegocio, HorarioComercial } from '../types'
import TabEmpresa from '../components/TabEmpresa'
import TabFunil from '../components/TabFunil'
import RetencaoDeMidia from '../components/RetencaoDeMidia'
import TabEtiquetas from '../components/TabEtiquetas'
import { moduloAtivo } from '../lib/modulos'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'
import { useAgente } from '../lib/agente'

/* ──────────────────────────────────────────────
   Upload validation constants
────────────────────────────────────────────── */
const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']

function validateImageFile(file: File): string | null {
  if (file.size > MAX_FILE_SIZE) return 'O arquivo excede o tamanho máximo de 2MB.'
  if (!ALLOWED_MIME.includes(file.type)) return 'Tipo de arquivo não permitido. Use JPG, PNG, WebP ou SVG.'
  return null
}

/**
 * Esvazia uma pasta do Storage.
 *
 * **A pasta inteira, e não o arquivo da URL.** A extensão entra no caminho
 * (`avatar.png`, `avatar.jpg`), então quem já trocou de formato deixou o
 * anterior lá dentro — apagar só o último não apagaria nada, na prática.
 *
 * Devolve `false` se não deu para apagar. Quem chama **não pode** nular a
 * coluna nesse caso: a coluna é o rastro, e sem ela o arquivo vira órfão num
 * bucket público — a URL continua de pé, servindo a foto que a pessoa mandou
 * apagar. É a mesma ordem da rota `/whatsapp/apagar-pessoa`: arquivo primeiro,
 * registro depois.
 */
async function esvaziarPasta(bucket: string, pasta: string): Promise<boolean> {
  const { data, error } = await supabase.storage.from(bucket).list(pasta)
  if (error) return false
  if (!data || data.length === 0) return true
  const { error: erroRemocao } = await supabase.storage
    .from(bucket)
    .remove(data.map((arquivo) => `${pasta}/${arquivo.name}`))
  return !erroRemocao
}

/* ──────────────────────────────────────────────
   Helpers
────────────────────────────────────────────── */
const DAY_NAMES = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']

/**
 * Os fusos do Brasil — quatro, e não os catorze nomes IANA que o país tem.
 *
 * Desde 2019 não há horário de verão, então os catorze desabam em **quatro
 * deslocamentos**. Oferecer `America/Bahia` e `America/Fortaleza` como opções
 * diferentes seria pedir uma escolha que não muda nada, e toda escolha que não
 * muda nada é uma chance a mais de errar.
 *
 * Lista curta e deliberada, como a de países em
 * [`telefones.ts`](../lib/telefones.ts) — e, como a paleta de
 * [`cores.ts`](../lib/cores.ts), **sem `CHECK` no banco**: a coluna aceita
 * qualquer texto, então acrescentar um fuso um dia não vai exigir migração.
 * Quem escreve ali é esta lista.
 */
const FUSOS = [
  { valor: 'America/Noronha', rotulo: 'GMT-2 · Fernando de Noronha' },
  { valor: 'America/Sao_Paulo', rotulo: 'GMT-3 · Brasília, São Paulo, Sul e Nordeste' },
  { valor: 'America/Manaus', rotulo: 'GMT-4 · Amazonas, Mato Grosso, Rondônia, Roraima' },
  { valor: 'America/Rio_Branco', rotulo: 'GMT-5 · Acre' },
]

const FUSO_PADRAO = 'America/Sao_Paulo'

type TabKey = 'perfil' | 'empresa' | 'horarios' | 'funil' | 'etiquetas'

/**
 * Só o que é configuração da empresa.
 *
 * Procedimentos virou página na barra lateral; Secretária de IA e Token e API
 * saíram para o menu do usuário — as duas são acesso e comportamento do
 * sistema, não cadastro da empresa.
 */
const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: 'perfil',   label: 'Perfil',                    icon: User },
  { key: 'empresa',  label: 'Empresa',                   icon: MapPin },
  { key: 'horarios', label: 'Horários de Funcionamento', icon: Clock },
  { key: 'funil',    label: 'Funil',                     icon: KanbanSquare },
  { key: 'etiquetas', label: 'Etiquetas',                icon: Tag },
]

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '22px 26px', marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 18, paddingBottom: 14, borderBottom: '1px solid var(--border-subtle)' }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function SaveButton({ onClick, saving, saved, disabled = false }: { onClick: () => void; saving: boolean; saved: boolean; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={saving || disabled}
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 9, border: 'none', background: saved ? 'var(--success-solid)' : (disabled ? 'var(--border)' : 'var(--action)'), color: saved ? 'var(--on-solid)' : disabled ? 'var(--muted)' : 'var(--on-action)', cursor: disabled ? 'default' : 'pointer', fontSize: 13, fontWeight: 600, fontFamily: "var(--font-body)", transition: 'background 0.2s' }}>
      {saved ? <Check size={14} /> : <Save size={14} />}
      {saved ? 'Salvo!' : saving ? 'Salvando...' : 'Salvar'}
    </button>
  )
}

/* ──────────────────────────────────────────────
   ABA PERFIL
────────────────────────────────────────────── */
function ErrorMsg({ msg }: { msg: string }) {
  return msg ? <div style={{ color: 'var(--danger)', marginTop: 8, fontSize: 13 }}>{msg}</div> : null
}

function TabPerfil({ userId }: { userId: string }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [empresa, setEmpresa] = useState<ConfiguracoesNegocio | null>(null)
  const [nome, setNome] = useState('')
  const [savingNome, setSavingNome] = useState(false)
  const [savedNome, setSavedNome] = useState(false)
  const [nomeError, setNomeError] = useState('')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const [logoError, setLogoError] = useState('')
  const [confirmandoAvatar, setConfirmandoAvatar] = useState(false)
  const [confirmandoLogo, setConfirmandoLogo] = useState(false)
  const [removendoAvatar, setRemovendoAvatar] = useState(false)
  const [removendoLogo, setRemovendoLogo] = useState(false)
  // Password change
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPass, setShowNewPass] = useState(false)
  const [showConfirmPass, setShowConfirmPass] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [savedPassword, setSavedPassword] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const avatarRef = useRef<HTMLInputElement>(null)
  const logoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    Promise.all([
      supabase.from('usuarios').select('*').eq('id', userId).single(),
      supabase.from('configuracoes_negocio').select('*').limit(1).single(),
    ]).then(([{ data: u }, { data: c }]) => {
      if (u) { setUsuario(u); setNome(u.nome ?? '') }
      if (c) setEmpresa(c)
    })
  }, [userId])

  const handleSaveNome = async () => {
    if (!nome.trim()) return
    setSavingNome(true); setNomeError('')
    const { error } = await supabase.from('usuarios').update({ nome: nome.trim() }).eq('id', userId)
    if (error) { setNomeError('Erro ao salvar. Tente novamente.'); setSavingNome(false); return }
    setUsuario((prev) => prev ? { ...prev, nome: nome.trim() } : prev)
    window.dispatchEvent(new Event('usuario-atualizado'))
    setSavingNome(false); setSavedNome(true)
    setTimeout(() => setSavedNome(false), 2000)
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarError('')
    const validationError = validateImageFile(file)
    if (validationError) { setAvatarError(validationError); e.target.value = ''; return }
    setUploadingAvatar(true)
    const ext = file.name.split('.').pop()
    const path = `${userId}/avatar.${ext}`
    const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
    if (uploadError) { setAvatarError('Erro ao enviar a imagem. Tente novamente.'); setUploadingAvatar(false); e.target.value = ''; return }
    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
    const url = `${publicUrl}?t=${Date.now()}`
    const { error: dbError } = await supabase.from('usuarios').update({ avatar_url: url }).eq('id', userId)
    if (dbError) { setAvatarError('Imagem enviada, mas erro ao salvar no perfil.') }
    else {
      setUsuario((prev) => prev ? { ...prev, avatar_url: url } : prev)
      // A barra lateral já carregou o usuário quando a sessão abriu; sem este
      // aviso a foto nova só apareceria no próximo F5.
      window.dispatchEvent(new Event('usuario-atualizado'))
    }
    setUploadingAvatar(false); e.target.value = ''
  }

  /**
   * Tira a foto de perfil: arquivo primeiro, coluna depois.
   *
   * Se o arquivo não sair, a coluna **não** é nulada. `avatars` é um bucket
   * público: nular primeiro deixaria a imagem servindo na URL antiga, sem
   * nada no banco apontando para ela — apagada na tela e viva na internet.
   */
  const handleAvatarRemove = async () => {
    setAvatarError('')
    setRemovendoAvatar(true)

    if (!(await esvaziarPasta('avatars', userId))) {
      setAvatarError('Não consegui apagar a imagem. Tente novamente.')
      setRemovendoAvatar(false); setConfirmandoAvatar(false)
      return
    }

    const { error } = await supabase.from('usuarios')
      .update({ avatar_url: null }).eq('id', userId)
    if (error) { setAvatarError('A imagem foi apagada, mas o perfil não atualizou.') }
    else {
      setUsuario((prev) => prev ? { ...prev, avatar_url: null } : prev)
      window.dispatchEvent(new Event('usuario-atualizado'))
    }
    setRemovendoAvatar(false); setConfirmandoAvatar(false)
  }

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoError('')
    const validationError = validateImageFile(file)
    if (validationError) { setLogoError(validationError); e.target.value = ''; return }
    setUploadingLogo(true)
    const ext = file.name.split('.').pop()
    const path = `clinic/logo.${ext}`
    const { error: uploadError } = await supabase.storage.from('logos').upload(path, file, { upsert: true })
    if (uploadError) { setLogoError('Erro ao enviar a imagem. Tente novamente.'); setUploadingLogo(false); e.target.value = ''; return }
    const { data: { publicUrl } } = supabase.storage.from('logos').getPublicUrl(path)
    const url = `${publicUrl}?t=${Date.now()}`
    const dbOp = empresa
      ? supabase.from('configuracoes_negocio').update({ logo_url: url }).eq('id', empresa.id)
      : supabase.from('configuracoes_negocio').insert({ logo_url: url })
    const { error: dbError } = await dbOp
    if (dbError) { setLogoError('Logo enviada, mas erro ao salvar configuração.') }
    else {
      setEmpresa((prev) => prev ? { ...prev, logo_url: url } : {
        id: '', nome_negocio: null, logo_url: url, fuso_horario: 'America/Sao_Paulo',
        endereco: null, bairro: null, cidade: null, estado: null, cep: null,
        google_maps_url: null, instagram_url: null, site_url: null,
        created_at: '', updated_at: '',
      })
      window.dispatchEvent(new Event('empresa-atualizada'))
    }
    setUploadingLogo(false); e.target.value = ''
  }

  /** Tira a logo. Mesma ordem e mesmo motivo da foto — `logos` também é público. */
  const handleLogoRemove = async () => {
    setLogoError('')
    setRemovendoLogo(true)

    if (!(await esvaziarPasta('logos', 'clinic'))) {
      setLogoError('Não consegui apagar a imagem. Tente novamente.')
      setRemovendoLogo(false); setConfirmandoLogo(false)
      return
    }

    if (empresa) {
      const { error } = await supabase.from('configuracoes_negocio')
        .update({ logo_url: null }).eq('id', empresa.id)
      if (error) {
        setLogoError('A imagem foi apagada, mas a configuração não atualizou.')
        setRemovendoLogo(false); setConfirmandoLogo(false)
        return
      }
      setEmpresa({ ...empresa, logo_url: null })
      window.dispatchEvent(new Event('empresa-atualizada'))
    }
    setRemovendoLogo(false); setConfirmandoLogo(false)
  }

  const handleSavePassword = async () => {
    setPasswordError('')
    if (!newPassword) { setPasswordError('Digite a nova senha.'); return }

    // O botão já fica trancado até tudo passar. Isto aqui é a segunda tranca:
    // o estado pode mudar entre o clique e a leitura, e um `disabled` some com
    // um comando no console.
    const faltando = REGRAS_SENHA.filter((regra) => !regra.ok(newPassword))
    if (faltando.length > 0) {
      setPasswordError(`A senha ainda não atende: ${faltando.map((r) => r.rotulo.toLowerCase()).join(', ')}.`)
      return
    }
    if (zxcvbn(newPassword).score < FORCA_MINIMA) {
      setPasswordError('Senha previsível demais. Evite sequências, datas e o nome da empresa.')
      return
    }
    if (newPassword !== confirmPassword) { setPasswordError('As senhas não coincidem.'); return }
    setSavingPassword(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setSavingPassword(false)
    if (error) {
      // Quando o servidor recusa por política, a mensagem genérica esconde a
      // única informação útil: a regra de lá é mais dura que a daqui.
      setPasswordError(
        /password/i.test(error.message ?? '')
          ? 'O servidor recusou esta senha. Escolha outra que atenda a todos os itens acima.'
          : 'Erro ao atualizar a senha. Tente novamente.',
      )
      return
    }
    setSavedPassword(true); setNewPassword(''); setConfirmPassword('')
    setTimeout(() => setSavedPassword(false), 3000)
  }

  const initials = usuario?.nome
    ? usuario.nome.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
    : '?'

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)',
    fontSize: 13.5, fontFamily: "var(--font-body)", color: 'var(--text)',
    outline: 'none', background: 'var(--surface)', boxSizing: 'border-box',
  }

  const passwordScore = newPassword ? zxcvbn(newPassword).score : -1
  const strengthColor = passwordScore >= 0 ? FORCA_CORES[passwordScore] : 'var(--border)'
  const strengthLabel = passwordScore >= 0 ? FORCA_ROTULOS[passwordScore] : ''

  /**
   * A lista que a pessoa vê, e a mesma que tranca o botão.
   *
   * A força entra como um item, e não como uma recusa escondida no clique: as
   * quatro classes passam com `Senha@1234`, que qualquer ataque de dicionário
   * quebra. Se a regra existe, ela precisa estar escrita junto das outras —
   * botão trancado por motivo invisível é o pior dos dois mundos.
   */
  const itensSenha = [
    ...REGRAS_SENHA.map((regra) => ({ rotulo: regra.rotulo, ok: regra.ok(newPassword) })),
    { rotulo: 'Força: Forte ou Muito forte', ok: passwordScore >= 3 },
  ]
  const senhasConferem = confirmPassword.length > 0 && newPassword === confirmPassword
  const podeSalvarSenha = itensSenha.every((i) => i.ok) && senhasConferem


  return (
    <>
      {/* Nome do usuário */}
      <SectionCard title="Nome do Usuário">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Seu nome completo" style={{ ...inputStyle, flex: 1, minWidth: 200 }}
            onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')}
            onBlur={(e) => (e.target.style.borderColor = 'var(--border)')} />
          <SaveButton onClick={handleSaveNome} saving={savingNome} saved={savedNome} disabled={!nome.trim()} />
        </div>
        <ErrorMsg msg={nomeError} />
      </SectionCard>

      {/* Foto de perfil */}
      <SectionCard title="Foto de Perfil">
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative' }}>
            {usuario?.avatar_url ? (
              <img src={usuario.avatar_url} alt="Avatar" style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--border)' }} />
            ) : (
              <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, fontWeight: 700, color: 'var(--accent)', border: '2px solid var(--border)' }}>
                {initials}
              </div>
            )}
            {uploadingAvatar && (
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(255,255,255,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 20, height: 20, border: '2px solid var(--accent-soft)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              </div>
            )}
          </div>
          <div>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 10px' }}>JPG, PNG ou WebP. Tamanho máximo: 2MB.</p>
            {/* "Remover" só existe quando há o que remover. Botão que não faz
                nada é botão que ensina a ignorar botões. */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => { setAvatarError(''); avatarRef.current?.click() }}
                style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--text)', fontFamily: "var(--font-body)" }}>
                <Upload size={14} /> {uploadingAvatar ? 'Enviando...' : 'Alterar foto'}
              </button>
              {usuario?.avatar_url && (
                <button onClick={() => { setAvatarError(''); setConfirmandoAvatar(true) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 9, border: '1px solid var(--danger-border)', background: 'var(--danger-soft)', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--danger)', fontFamily: "var(--font-body)" }}>
                  <Trash2 size={14} /> Remover
                </button>
              )}
            </div>
            <input ref={avatarRef} type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" style={{ display: 'none' }} onChange={handleAvatarUpload} />
          </div>
        </div>
        <ErrorMsg msg={avatarError} />
      </SectionCard>

      {/* Logo da empresa */}
      <SectionCard title="Logo da Empresa">
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative' }}>
            {empresa?.logo_url ? (
              <img src={empresa.logo_url} alt="Logo" style={{ width: 80, height: 80, borderRadius: 12, objectFit: 'cover', border: '2px solid var(--border)' }} />
            ) : (
              <div style={{ width: 80, height: 80, borderRadius: 12, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--border)' }}>
                <BriefcaseBusiness size={30} color="var(--chart-blue)" strokeWidth={1.5} />
              </div>
            )}
            {uploadingLogo && (
              <div style={{ position: 'absolute', inset: 0, borderRadius: 12, background: 'rgba(255,255,255,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 20, height: 20, border: '2px solid var(--accent-soft)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              </div>
            )}
          </div>
          <div>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 10px' }}>Envie a identidade visual da empresa. JPG, PNG ou SVG.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => { setLogoError(''); logoRef.current?.click() }}
                style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--text)', fontFamily: "var(--font-body)" }}>
                <Upload size={14} /> {uploadingLogo ? 'Enviando...' : 'Alterar logo'}
              </button>
              {empresa?.logo_url && (
                <button onClick={() => { setLogoError(''); setConfirmandoLogo(true) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 9, border: '1px solid var(--danger-border)', background: 'var(--danger-soft)', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--danger)', fontFamily: "var(--font-body)" }}>
                  <Trash2 size={14} /> Remover
                </button>
              )}
            </div>
            <input ref={logoRef} type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" style={{ display: 'none' }} onChange={handleLogoUpload} />
          </div>
        </div>
        <ErrorMsg msg={logoError} />
      </SectionCard>

      {/* Alterar Senha */}
      <SectionCard title="Alterar Senha">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 420 }}>
          {/* Nova senha */}
          <div>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 6 }}>Nova senha</label>
            <div style={{ position: 'relative' }}>
              <input type={showNewPass ? 'text' : 'password'} value={newPassword} onChange={(e) => { setNewPassword(e.target.value); setPasswordError('') }}
                placeholder="••••••••" style={{ ...inputStyle, paddingRight: 40 }}
                onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')} onBlur={(e) => (e.target.style.borderColor = 'var(--border)')} />
              <button type="button" onClick={() => setShowNewPass((s) => !s)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                {showNewPass ? <EyeOff size={15} color="var(--muted)" /> : <Eye size={15} color="var(--muted)" />}
              </button>
            </div>
            {/* Strength bar */}
            {newPassword.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= passwordScore ? strengthColor : 'var(--border)', transition: 'background 0.2s' }} />
                  ))}
                </div>
                <span style={{ fontSize: 11.5, color: strengthColor, fontWeight: 600 }}>{strengthLabel}</span>
              </div>
            )}

            {/* As exigências ficam SEMPRE visíveis, e não só depois de digitar:
                a regra precisa ser conhecida na hora de escolher a senha, não
                descoberta na hora de ser recusado. */}
            <div style={{
              marginTop: 10,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(168px, 1fr))',
              gap: '5px 12px',
            }}>
              {itensSenha.map((item) => (
                <div key={item.rotulo} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 11.5, color: item.ok ? 'var(--success)' : 'var(--muted)',
                }}>
                  {item.ok ? (
                    <Check size={12} color="var(--success)" style={{ flexShrink: 0 }} />
                  ) : (
                    <span style={{ width: 12, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--border)' }} />
                    </span>
                  )}
                  {item.rotulo}
                </div>
              ))}
            </div>
          </div>

          {/* Confirmar senha */}
          <div>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 6 }}>Confirmar nova senha</label>
            <div style={{ position: 'relative' }}>
              <input type={showConfirmPass ? 'text' : 'password'} value={confirmPassword} onChange={(e) => { setConfirmPassword(e.target.value); setPasswordError('') }}
                placeholder="••••••••" style={{ ...inputStyle, paddingRight: 40 }}
                onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')} onBlur={(e) => (e.target.style.borderColor = 'var(--border)')} />
              <button type="button" onClick={() => setShowConfirmPass((s) => !s)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                {showConfirmPass ? <EyeOff size={15} color="var(--muted)" /> : <Eye size={15} color="var(--muted)" />}
              </button>
            </div>
            {/* Com o botão trancado, o motivo precisa estar na tela. A lista
                acima cobre a senha; a conferência precisa da própria linha. */}
            {confirmPassword.length > 0 && !senhasConferem && (
              <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 6 }}>
                As senhas não coincidem.
              </div>
            )}
          </div>

          <ErrorMsg msg={passwordError} />

          {savedPassword && (
            <div style={{ background: 'var(--success-soft)', border: '1px solid var(--success-border)', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, color: 'var(--success)' }}>
              Senha alterada com sucesso!
            </div>
          )}

          <button onClick={handleSavePassword} disabled={savingPassword || !podeSalvarSenha}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 9, border: 'none', alignSelf: 'flex-start', background: !podeSalvarSenha ? 'var(--border)' : savingPassword ? 'var(--action-hover)' : 'var(--action)', color: !podeSalvarSenha ? 'var(--muted)' : 'var(--on-action)', cursor: !podeSalvarSenha ? 'default' : 'pointer', fontSize: 13, fontWeight: 600, fontFamily: "var(--font-body)", transition: 'background 0.2s' }}>
            <KeyRound size={14} /> {savingPassword ? 'Salvando...' : 'Alterar senha'}
          </button>
        </div>
      </SectionCard>

      {/* ---------------- Confirmações ----------------

          Trocar a imagem é um clique; apagar também deveria ser — mas os dois
          botões ficam lado a lado, e o segundo não tem "desfazer": quem apaga
          sem ter o arquivo original em mãos não recupera. A logo é pior ainda,
          porque some para a equipe inteira.                                  */}
      {confirmandoAvatar && (
        <ConfirmDeleteModal
          itemName="sua foto de perfil"
          title="Remover a foto de perfil?"
          message={<>Sua foto sai desta tela e da barra lateral, e volta a aparecer
            a inicial do seu nome. Para ter uma foto de novo, é só enviar outra.</>}
          confirmLabel="Remover"
          loadingLabel="Removendo..."
          loading={removendoAvatar}
          onConfirm={handleAvatarRemove}
          onClose={() => setConfirmandoAvatar(false)}
        />
      )}

      {confirmandoLogo && (
        <ConfirmDeleteModal
          itemName="a logo da empresa"
          title="Remover a logo da empresa?"
          message={<>A logo sai da barra lateral <strong>para a equipe inteira</strong>,
            e volta o ícone padrão. Para ter uma logo de novo, é só enviar outra.</>}
          confirmLabel="Remover"
          loadingLabel="Removendo..."
          loading={removendoLogo}
          onConfirm={handleLogoRemove}
          onClose={() => setConfirmandoLogo(false)}
        />
      )}
    </>
  )
}

/* ──────────────────────────────────────────────
   ABA HORÁRIOS
────────────────────────────────────────────── */
interface HorarioRow {
  dbId: string | null   // null if not yet in DB
  dia_semana: number
  hora_inicio: string
  hora_fim: string
  ativo: boolean
  saving: boolean
  saved: boolean
  error: string
}

/**
 * O fuso da empresa — e por que ele mora na aba Horários.
 *
 * A grade logo abaixo diz "08:00 às 18:00". De onde? Sem esta resposta ao lado
 * dela, alguém preenche a grade inteira sem nunca se perguntar isso — e a
 * pergunta só aparece quando a secretária marca uma consulta três horas fora.
 *
 * ── ELE NÃO MUDA NADA NESTA TELA ───────────────────────────────────────────
 *
 * As telas rodam no fuso do navegador, que no uso real é o da empresa: a
 * recepção está dentro dela. Este campo existe para o **servidor**, que não tem
 * navegador nenhum para consultar — o `{{DATA_HOJE}}` do prompt, o
 * `paraInstante()` que converte "quinta às 14h" em `timestamptz`, a
 * `agenda_disponibilidade` e a `agenda_marcar`.
 *
 * É por isso que a legenda fala da secretária, e não da Agenda. Errado aqui, o
 * estrago não aparece em tela nenhuma: aparece no horário que o cliente ouviu.
 */
function CartaoFusoHorario() {
  const { rotulo: rotuloAgente } = useAgente()
  const [fuso, setFuso] = useState(FUSO_PADRAO)
  const [id, setId] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    supabase.from('configuracoes_negocio').select('id, fuso_horario').limit(1).single()
      .then(({ data }) => {
        if (!data) return
        setId(data.id)
        if (data.fuso_horario) setFuso(data.fuso_horario)
      })
  }, [])

  const salvar = async () => {
    setSalvando(true); setErro('')
    const { error } = id
      ? await supabase.from('configuracoes_negocio').update({ fuso_horario: fuso }).eq('id', id)
      : await supabase.from('configuracoes_negocio').insert({ fuso_horario: fuso })
    setSalvando(false)
    if (error) { setErro('Erro ao salvar. Tente novamente.'); return }
    setSalvo(true)
    setTimeout(() => setSalvo(false), 2000)
  }

  return (
    <div style={{
      background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)',
      padding: '18px 24px', marginBottom: 18,
    }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Fuso horário da empresa</div>
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4, lineHeight: 1.6 }}>
        Em que fuso os horários abaixo devem ser lidos. Quem usa isso é a {rotuloAgente},
        que marca reuniões do lado do servidor e não tem como saber onde a empresa fica.
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
        <select
          value={fuso}
          onChange={(e) => { setFuso(e.target.value) }}
          style={{
            padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)',
            fontSize: 13.5, fontFamily: "var(--font-body)",
            color: 'var(--text)', background: 'var(--surface)', outline: 'none', cursor: 'pointer',
            minWidth: 0, width: '100%', flex: 1, maxWidth: 420,
          }}
        >
          {FUSOS.map(({ valor, rotulo }) => (
            <option key={valor} value={valor}>{rotulo}</option>
          ))}
        </select>
        <SaveButton onClick={() => { void salvar() }} saving={salvando} saved={salvo} />
      </div>

      {erro && (
        <div style={{
          background: 'var(--danger-soft)', border: '1px solid var(--danger-border)', borderRadius: 8,
          padding: '8px 12px', fontSize: 12.5, color: 'var(--danger)', marginTop: 10,
        }}>{erro}</div>
      )}
    </div>
  )
}

function TabHorarios() {
  const [rows, setRows] = useState<HorarioRow[]>(
    Array.from({ length: 7 }, (_, i) => ({
      dbId: null, dia_semana: i, hora_inicio: '08:00', hora_fim: '18:00', ativo: i >= 1 && i <= 5, saving: false, saved: false, error: '',
    }))
  )

  useEffect(() => {
    supabase.from('horario_comercial').select('*').then(({ data }) => {
      if (!data || data.length === 0) return
      setRows((prev) =>
        prev.map((r) => {
          const db = (data as HorarioComercial[]).find((d) => d.dia_semana === r.dia_semana)
          if (!db) return r
          return { ...r, dbId: db.id, hora_inicio: db.hora_inicio.slice(0, 5), hora_fim: db.hora_fim.slice(0, 5), ativo: db.ativo }
        })
      )
    })
  }, [])

  const update = <K extends keyof HorarioRow>(dia: number, field: K, value: HorarioRow[K]) =>
    setRows((prev) => prev.map((r) => r.dia_semana === dia ? { ...r, [field]: value } : r))

  const handleSave = async (row: HorarioRow) => {
    update(row.dia_semana, 'saving', true)
    update(row.dia_semana, 'error', '')
    if (row.dbId) {
      const { error } = await supabase.from('horario_comercial').update({ hora_inicio: row.hora_inicio, hora_fim: row.hora_fim, ativo: row.ativo }).eq('id', row.dbId)
      if (error) { update(row.dia_semana, 'saving', false); update(row.dia_semana, 'error', 'Erro ao salvar. Tente novamente.'); return }
    } else {
      const { data, error } = await supabase.from('horario_comercial').insert({ dia_semana: row.dia_semana, hora_inicio: row.hora_inicio, hora_fim: row.hora_fim, ativo: row.ativo }).select().single()
      if (error) { update(row.dia_semana, 'saving', false); update(row.dia_semana, 'error', 'Erro ao salvar. Tente novamente.'); return }
      if (data) update(row.dia_semana, 'dbId', (data as HorarioComercial).id)
    }
    update(row.dia_semana, 'saving', false)
    update(row.dia_semana, 'saved', true)
    setTimeout(() => update(row.dia_semana, 'saved', false), 2000)
  }

  const timeInput: React.CSSProperties = {
    padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13.5,
    fontFamily: "var(--font-body)", color: 'var(--text)', outline: 'none', background: 'var(--surface)',
  }

  return (
    <>
      {/* Antes da grade, de propósito: ela diz "08:00 às 18:00", e é o fuso
          que responde "de onde". */}
      <CartaoFusoHorario />

      <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>
      <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Horários de Funcionamento</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4, lineHeight: 1.6 }}>
          O horário que a empresa anuncia. O Dashboard usa para separar contatos dentro
          e fora do expediente, e é daqui que sai a frase de atendimento que a assistente
          fala ao cliente. Quem manda na agenda de cada especialista é a jornada dele, em
          Profissionais.
        </div>
      </div>
      {rows.map((row, idx) => (
        <React.Fragment key={row.dia_semana}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 24px', borderBottom: (idx < 6 && !row.error) ? '1px solid var(--border-subtle)' : 'none', flexWrap: 'wrap', background: row.ativo ? 'var(--surface)' : 'var(--surface-subtle)', transition: 'background 0.15s' }}>
            {/* Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 160 }}>
              <button onClick={() => update(row.dia_semana, 'ativo', !row.ativo)}
                style={{ width: 40, height: 22, borderRadius: 11, background: row.ativo ? 'var(--action)' : 'var(--border)', border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--surface)', position: 'absolute', top: 3, left: row.ativo ? 21 : 3, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
              </button>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: row.ativo ? 'var(--text)' : 'var(--muted)' }}>{DAY_NAMES[row.dia_semana]}</span>
            </div>

            {/* Time inputs */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
              <input type="time" value={row.hora_inicio} disabled={!row.ativo}
                onChange={(e) => update(row.dia_semana, 'hora_inicio', e.target.value)}
                style={{ ...timeInput, opacity: row.ativo ? 1 : 0.4, cursor: row.ativo ? 'pointer' : 'not-allowed' }}
                onFocus={(e) => row.ativo && (e.target.style.borderColor = 'var(--accent)')}
                onBlur={(e) => (e.target.style.borderColor = 'var(--border)')} />
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>até</span>
              <input type="time" value={row.hora_fim} disabled={!row.ativo}
                onChange={(e) => update(row.dia_semana, 'hora_fim', e.target.value)}
                style={{ ...timeInput, opacity: row.ativo ? 1 : 0.4, cursor: row.ativo ? 'pointer' : 'not-allowed' }}
                onFocus={(e) => row.ativo && (e.target.style.borderColor = 'var(--accent)')}
                onBlur={(e) => (e.target.style.borderColor = 'var(--border)')} />
            </div>

            {/* Save button */}
            <SaveButton onClick={() => handleSave(row)} saving={row.saving} saved={row.saved} />
          </div>
          {row.error && (
            <div style={{ padding: '4px 24px 12px', fontSize: 12.5, color: 'var(--danger)', borderBottom: idx < 6 ? '1px solid var(--border-subtle)' : 'none' }}>{row.error}</div>
          )}
        </React.Fragment>
      ))}
      </div>
    </>
  )
}

/* ──────────────────────────────────────────────
   Main Page
────────────────────────────────────────────── */
export default function Configuracoes() {
  const [activeTab, setActiveTab] = useState<TabKey>('perfil')
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id)
    })
  }, [])

  return (
    <div style={{ padding: '32px 36px', maxWidth: 900, margin: '0 auto' }}>

      {/* Page header */}
      <div className="fade-in-1" style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Configurações</h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Gerencie suas informações e os dados da empresa.</p>
      </div>

      {/* Tabs */}
      <section className="arc-card" aria-label="Aparência da interface" style={{ marginBottom: 24, display: 'flex', gap: 24, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div><h2 style={{ margin: 0 }}>Aparência</h2><p style={{ color: 'var(--muted)', margin: '6px 0 0', fontSize: 13 }}>Alterne entre o modo claro e o escuro.</p></div>
        <SeletorTema />
      </section>
      <div className="fade-in-2 settings-tabs" style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setActiveTab(key)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: activeTab === key ? 700 : 500, color: activeTab === key ? 'var(--accent)' : 'var(--muted)', borderBottom: activeTab === key ? '2px solid var(--accent)' : '2px solid transparent', fontFamily: "var(--font-body)", transition: 'color 0.15s', marginBottom: -1 }}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="fade-in-3">
        {activeTab === 'perfil' && userId && <TabPerfil userId={userId} />}
        {activeTab === 'empresa' && <><TabEmpresa />{moduloAtivo('conversas') && <RetencaoDeMidia />}</>}
        {activeTab === 'funil' && <TabFunil />}
        {activeTab === 'etiquetas' && <TabEtiquetas />}
        {activeTab === 'horarios' && <TabHorarios />}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
