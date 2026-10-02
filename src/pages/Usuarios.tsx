import ModalPortal from '../components/ModalPortal'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'
import { useEffect, useState } from 'react'
import { Copy, Link2, Mail, Power, RotateCcw, Trash2, UserPlus, X } from 'lucide-react'
import { PageHeader, Notice, LoadingState, EmptyState } from '../components/ui'
import { useSessao } from '../lib/sessao'
import {
  convidar, criarLinkConvite, definirAtivacao, definirPapel,
  excluirUsuario, gerarLinkAcesso, listarEquipe, reenviarConvite, ErroEquipe,
} from '../lib/equipe'
import type { MembroEquipe, PapelUsuario } from '../types'

/* ──────────────────────────────────────────────
   Usuários — o gestor e os consultores de atendimento.

   Esta tela só monta para gestor (ver `RotaDeGestor` no App), mas isso é
   conveniência: quem recusa de verdade é o banco, em `exigir_gestor`. Um
   consultor que chegar aqui pela URL vê a tela e leva 403 em cada ação.

   NENHUMA SENHA PASSA POR AQUI. O gestor entrega um link ou envia convite por
   e-mail; a pessoa define a própria senha.

   E ninguém mexe na própria conta: rebaixar a si mesmo tiraria o gestor da
   única tela onde desfaria isso, e desligar a si mesmo tiraria o login.
────────────────────────────────────────────── */

function dataCurta(valor: string | null): string {
  if (!valor) return '—'
  return new Date(valor).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function iniciais(nome: string): string {
  const limpo = nome.trim()
  if (!limpo) return '?'
  return limpo.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()
}

function Estado({ membro }: { membro: MembroEquipe }) {
  if (!membro.ativo) return <span className="arc-tag arc-tag-muted">Desligada</span>
  if (membro.convite_pendente) return <span className="arc-tag arc-tag-warning">Convite pendente</span>
  return <span className="arc-tag arc-tag-success">Acesso liberado</span>
}

export default function Usuarios() {
  const { usuario } = useSessao()
  const [membros, setMembros] = useState<MembroEquipe[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [ocupado, setOcupado] = useState('')
  const [convite, setConvite] = useState(false)
  const [linkAcesso, setLinkAcesso] = useState<{ url: string; pessoa: string } | null>(null)
  const [excluindo, setExcluindo] = useState<MembroEquipe | null>(null)
  const [erroExclusao, setErroExclusao] = useState('')
  const [filtro, setFiltro] = useState<'todos' | 'pendentes' | 'desligados'>('todos')

  useEffect(() => {
    let viva = true
    listarEquipe()
      .then((lista) => { if (viva) setMembros(lista) })
      .catch((falha) => { if (viva) setErro(mensagem(falha, 'Não foi possível carregar a equipe.')) })
      .finally(() => { if (viva) setCarregando(false) })
    return () => { viva = false }
  }, [])

  function mensagem(falha: unknown, padrao: string): string {
    return falha instanceof ErroEquipe ? falha.message : padrao
  }

  /** Toda ação devolve a lista pronta, então a tela não recarrega sozinha. */
  async function agir(id: string, acao: () => Promise<MembroEquipe[]>, sucesso?: string) {
    setOcupado(id); setErro(''); setAviso('')
    try {
      setMembros(await acao())
      if (sucesso) setAviso(sucesso)
    } catch (falha) {
      setErro(mensagem(falha, 'Não foi possível concluir a operação.'))
    } finally {
      setOcupado('')
    }
  }

  async function aoReenviar(membro: MembroEquipe) {
    setOcupado(membro.id); setErro(''); setAviso('')
    try {
      await reenviarConvite(membro.id)
      setMembros(await listarEquipe())
      setAviso(`Convite reenviado para ${membro.email ?? membro.nome}.`)
    } catch (falha) {
      setErro(mensagem(falha, 'Não foi possível reenviar o convite.'))
    } finally {
      setOcupado('')
    }
  }

  async function aoGerarLink(membro: MembroEquipe) {
    setOcupado(membro.id); setErro(''); setAviso('')
    try {
      setLinkAcesso({ url: await gerarLinkAcesso(membro.id), pessoa: membro.nome || membro.email || 'esta pessoa' })
    } catch (falha) {
      setErro(mensagem(falha, 'Não foi possível gerar o link.'))
    } finally {
      setOcupado('')
    }
  }

  async function aoExcluir() {
    if (!excluindo) return
    const id = excluindo.id
    setOcupado(id); setErroExclusao(''); setAviso('')
    try {
      await excluirUsuario(id)
      setMembros((atual) => atual.filter((membro) => membro.id !== id))
      setExcluindo(null)
      setAviso(`A conta de ${excluindo.nome || excluindo.email || 'usuário'} foi excluída.`)
    } catch (falha) {
      setErroExclusao(mensagem(falha, 'Não foi possível excluir a conta.'))
    } finally {
      setOcupado('')
    }
  }

  const gestoresAtivos = membros.filter((m) => m.papel === 'gestor' && m.ativo).length
  const pendentes = membros.filter((m) => m.ativo && m.convite_pendente).length
  const desligados = membros.filter((m) => !m.ativo).length
  const visiveis = membros.filter((m) => filtro === 'todos' || (filtro === 'pendentes' ? m.ativo && m.convite_pendente : !m.ativo))

  return <div className="page-content">
    <PageHeader
      eyebrow="Acesso"
      title="Usuários"
      description="Quem entra no CRM, com qual papel. O gestor cuida de configuração, equipe e do que não se desfaz; os consultores atendem."
      actions={<button className="arc-button arc-button-primary" type="button" onClick={() => setConvite(true)}>
        <UserPlus size={16} />Convidar
      </button>}
    />

    {erro && <Notice tone="danger">{erro}</Notice>}
    {aviso && <Notice tone="success">{aviso}</Notice>}
    {gestoresAtivos === 1 && <Notice tone="info">
      <strong>Só existe um gestor ativo.</strong> Enquanto for assim, essa conta não pode ser rebaixada nem desligada — a empresa ficaria sem quem convida e configura. Promova outra pessoa antes.
    </Notice>}

    {!carregando && <div className="equipe-resumo" aria-label="Resumo dos usuários">
      <button type="button" aria-pressed={filtro === 'todos'} className={filtro === 'todos' ? 'ativo' : ''} onClick={() => setFiltro('todos')}>
        <strong>{membros.filter((m) => m.ativo).length}</strong><span>Contas ligadas</span>
      </button>
      <button type="button" aria-pressed={filtro === 'pendentes'} className={filtro === 'pendentes' ? 'ativo' : ''} onClick={() => setFiltro('pendentes')}>
        <strong>{pendentes}</strong><span>Convites pendentes</span>
      </button>
      <button type="button" aria-pressed={filtro === 'desligados'} className={filtro === 'desligados' ? 'ativo' : ''} onClick={() => setFiltro('desligados')}>
        <strong>{desligados}</strong><span>Desligadas</span>
      </button>
    </div>}

    <p className="equipe-explicacao">Gestores configuram o CRM e administram acessos. Consultores atendem. O perfil da agenda é gerenciado em Equipe.</p>

    {carregando ? <LoadingState label="Carregando a equipe…" /> : visiveis.length === 0
      ? <EmptyState title={filtro === 'pendentes' ? 'Nenhum convite pendente' : filtro === 'desligados' ? 'Nenhuma conta desligada' : 'Nenhum usuário encontrado'} />
      : <div className="arc-table-scroll">
      <table className="arc-table">
        <thead><tr>
          <th scope="col">Pessoa</th>
          <th scope="col">Papel</th>
          <th scope="col">Estado</th>
          <th scope="col">Último acesso</th>
          <th scope="col"><span className="sr-only">Ações</span></th>
        </tr></thead>
        <tbody>
          {visiveis.map((membro) => {
            const eu = membro.id === usuario?.id
            const travado = ocupado === membro.id
            return <tr key={membro.id}>
              <td>
                <span className="equipe-pessoa">
                  {membro.avatar_url
                    ? <img className="equipe-avatar" src={membro.avatar_url} alt="" />
                    : <span className="equipe-avatar">{iniciais(membro.nome)}</span>}
                  <span>
                    <strong>{membro.nome || 'Sem nome'}</strong>
                    <small>{membro.email ?? 'sem e-mail'}{eu && ' · você'}</small>
                  </span>
                </span>
              </td>
              <td>
                <select
                  className="arc-field"
                  value={membro.papel}
                  disabled={eu || travado || !membro.ativo}
                  title={eu ? 'Você não pode alterar a própria conta por aqui.' : undefined}
                  onChange={(e) => void agir(membro.id, () => definirPapel(membro.id, e.target.value as PapelUsuario))}
                >
                  <option value="gestor">Gestor</option>
                  <option value="consultor">Consultor</option>
                </select>
              </td>
              <td><Estado membro={membro} />{membro.convite_pendente && membro.convidado_em && <small className="equipe-data-convite">Enviado em {dataCurta(membro.convidado_em)}</small>}</td>
              <td>{dataCurta(membro.ultimo_acesso_em)}</td>
              <td>
                <span className="equipe-acoes">
                  {membro.convite_pendente && membro.ativo && <button
                    className="arc-button arc-button-secondary" type="button" disabled={travado}
                    onClick={() => void aoReenviar(membro)}
                  ><Mail size={15} />Reenviar convite</button>}
                  {membro.ativo && membro.convidado_em && !eu && <button
                    className="arc-button arc-button-secondary" type="button" disabled={travado}
                    onClick={() => void aoGerarLink(membro)}
                  ><Link2 size={15} />Gerar link</button>}
                  <button
                    className={`arc-button ${membro.ativo ? 'arc-button-danger' : 'arc-button-secondary'}`}
                    type="button"
                    disabled={eu || travado}
                    title={eu ? 'Você não pode desligar a própria conta.' : undefined}
                    onClick={() => void agir(
                      membro.id,
                      () => definirAtivacao(membro.id, !membro.ativo),
                      membro.ativo
                        ? `${membro.nome || 'A conta'} foi desligada. A sessão aberta cai quando o token expirar.`
                        : `${membro.nome || 'A conta'} voltou a ter acesso.`,
                    )}
                  >{membro.ativo ? <><Power size={15} />Desligar</> : <><RotateCcw size={15} />Religar</>}</button>
                  <button
                    className="arc-button arc-button-danger" type="button"
                    disabled={eu || travado || (membro.papel === 'gestor' && membro.ativo && gestoresAtivos === 1)}
                    title={eu ? 'Você não pode excluir a própria conta.' : membro.papel === 'gestor' && membro.ativo && gestoresAtivos === 1 ? 'A empresa precisa de pelo menos um gestor ativo.' : undefined}
                    onClick={() => { setErroExclusao(''); setExcluindo(membro) }}
                  ><Trash2 size={15} />Excluir</button>
                </span>
              </td>
            </tr>
          })}
        </tbody>
      </table>
    </div>}

    <Notice tone="info">
      O e-mail padrão pode ter o link aberto automaticamente antes da pessoa. Use “Gerar link” e compartilhe o endereço direto com ela quando isso acontecer. Excluir remove contas sem histórico; quando já há registros, desligar preserva a autoria.
    </Notice>

    {convite && <ModalConvite
      onClose={() => setConvite(false)}
      onPronto={async (nome, link) => {
        setConvite(false)
        if (link) setLinkAcesso({ url: link, pessoa: nome })
        setMembros(await listarEquipe())
        setAviso(link ? `Link criado para ${nome}. Compartilhe-o diretamente com essa pessoa.` : `Convite enviado. ${nome} define a senha pelo link do e-mail.`)
      }}
    />}
    {linkAcesso && <ModalLink url={linkAcesso.url} pessoa={linkAcesso.pessoa} onClose={() => setLinkAcesso(null)} />}
    {excluindo && <ConfirmDeleteModal
      itemName={excluindo.nome || excluindo.email || 'esta conta'}
      title="Excluir usuário"
      message={<>Excluir <strong>{excluindo.nome || excluindo.email || 'esta conta'}</strong> remove o acesso e o cadastro definitivamente. Se houver histórico no CRM, a exclusão será recusada; nesse caso, desligue a conta.</>}
      onConfirm={() => void aoExcluir()}
      onClose={() => setExcluindo(null)}
      loading={ocupado === excluindo.id}
      error={erroExclusao}
      confirmLabel="Excluir usuário"
    />}
  </div>
}

function ModalConvite({ onClose, onPronto }: { onClose: () => void; onPronto: (nome: string, link?: string) => Promise<void> }) {
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [papel, setPapel] = useState<PapelUsuario>('consultor')
  const [entrega, setEntrega] = useState<'link' | 'email'>('link')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault()
    setSalvando(true); setErro('')
    try {
      const dados = { nome: nome.trim(), email: email.trim(), papel }
      const link = entrega === 'link' ? await criarLinkConvite(dados) : undefined
      if (entrega === 'email') await convidar(dados)
      await onPronto(nome.trim(), link)
    } catch (falha) {
      setErro(falha instanceof ErroEquipe ? falha.message : 'Não foi possível enviar o convite.')
      setSalvando(false)
    }
  }

  return <ModalPortal label="Convidar para a equipe" onClose={onClose} busy={salvando}>
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, overflowY: 'auto' }}
      onClick={(e) => { if (e.target === e.currentTarget && !salvando) onClose() }}>
      <form onSubmit={(e) => void enviar(e)} style={{ background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)', width: '100%', maxWidth: 480, padding: '28px 28px 24px', boxShadow: '0 8px 48px rgba(0,0,0,0.12)', margin: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Convidar para a equipe</span>
          <button type="button" onClick={onClose} disabled={salvando} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X size={18} color="var(--muted)" />
          </button>
        </div>

        {erro && <div style={{ marginBottom: 16 }}><Notice tone="danger">{erro}</Notice></div>}

        <label className="equipe-campo">
          <span>Nome</span>
          <input className="arc-field" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} required autoFocus />
        </label>

        <label className="equipe-campo">
          <span>E-mail</span>
          <input className="arc-field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} required />
        </label>

        <label className="equipe-campo">
          <span>Papel</span>
          <select className="arc-field" value={papel} onChange={(e) => setPapel(e.target.value as PapelUsuario)}>
            <option value="consultor">Consultor de atendimento</option>
            <option value="gestor">Gestor</option>
          </select>
        </label>

        <label className="equipe-campo">
          <span>Como entregar o acesso</span>
          <select className="arc-field" value={entrega} onChange={(e) => setEntrega(e.target.value as 'link' | 'email')}>
            <option value="link">Gerar link para compartilhar</option>
            <option value="email">Enviar pelo e-mail padrão</option>
          </select>
        </label>

        <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, margin: '4px 0 20px' }}>
          {entrega === 'link'
            ? 'Você recebe um link para enviar diretamente à pessoa. Ele expira em uma hora e só permite que ela defina a própria senha.'
            : 'A pessoa recebe um e-mail para definir a própria senha. Alguns provedores abrem o link automaticamente; se falhar, gere um link na lista.'}
        </p>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" className="arc-button arc-button-secondary" onClick={onClose} disabled={salvando}>Cancelar</button>
          <button type="submit" className="arc-button arc-button-primary" disabled={salvando}>
            {entrega === 'link' ? <Link2 size={16} /> : <Mail size={16} />}{salvando ? 'Aguarde…' : entrega === 'link' ? 'Gerar link' : 'Enviar convite'}
          </button>
        </div>
      </form>
    </div>
  </ModalPortal>
}

function ModalLink({ url, pessoa, onClose }: { url: string; pessoa: string; onClose: () => void }) {
  const [copiado, setCopiado] = useState(false)
  async function copiar() {
    try {
      await navigator.clipboard.writeText(url)
      setCopiado(true)
    } catch {
      const campo = document.getElementById('link-convite') as HTMLInputElement | null
      campo?.select()
    }
  }
  return <ModalPortal label="Link de acesso" onClose={onClose}>
    <div className="equipe-link-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="equipe-link-modal">
        <h2>Link de acesso para {pessoa}</h2>
        <p>Copie e envie diretamente à pessoa. Quem tiver este link poderá definir a senha e entrar nessa conta. O link funciona uma vez e expira em uma hora.</p>
        <label className="equipe-campo" htmlFor="link-convite"><span>Endereço do convite</span></label>
        <input id="link-convite" className="arc-field" value={url} readOnly onFocus={(e) => e.currentTarget.select()} />
        <div className="equipe-link-acoes">
          <button type="button" className="arc-button arc-button-secondary" onClick={onClose}>Fechar</button>
          <button type="button" className="arc-button arc-button-primary" onClick={() => void copiar()}><Copy size={15} />{copiado ? 'Copiado' : 'Copiar link'}</button>
        </div>
      </div>
    </div>
  </ModalPortal>
}
