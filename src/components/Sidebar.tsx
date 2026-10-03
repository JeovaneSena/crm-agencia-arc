import { useState, useEffect, useRef } from 'react'
import type { LucideIcon } from 'lucide-react'
import { NavLink, Link, useNavigate } from 'react-router-dom'
import { LayoutDashboard, KanbanSquare, MessagesSquare, ClipboardList, ListChecks, Bot, CalendarDays, BriefcaseBusiness, FolderKanban, Users, UserCheck, UsersRound, Settings, ChevronLeft, ChevronRight, ChevronUp, LogOut, Megaphone, Bell } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useSessao } from '../lib/sessao'
import { AGENTE_PAGINA } from '../lib/agente'
import { moduloAtivo, type Modulo } from '../lib/modulos'
import { useAvisos } from '../lib/avisos'
import { useMediaQuery } from '../lib/useMediaQuery'
import { useFocusScope } from '../lib/useFocusScope'
import SeletorTema from './SeletorTema'

interface ItemNav {
  to: string
  label: string
  icon: LucideIcon
  /** Só aparece para gestor. */
  gestor?: boolean
  end?: boolean
  /** Só aparece se a instalação ligou este módulo. */
  modulo?: Modulo
}

/** `gestor: true` some da barra para consultor. Esconder é cortesia com quem
 *  olha — quem recusa é o banco, nas policies e em `exigir_gestor`. */
const MENU_USUARIO: ItemNav[] = [
  { to: '/assistente-ia', label: AGENTE_PAGINA, icon: Bot, gestor: true, modulo: 'assistente' },
]

const NAV_GROUPS: { label: string; items: ItemNav[] }[] = [
  {
    label: 'Negócios',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/crm', label: 'CRM', icon: KanbanSquare },
      { to: '/conversas', label: 'Conversas', icon: MessagesSquare, modulo: 'conversas' },
      { to: '/campanhas', label: 'Campanhas', icon: Megaphone, modulo: 'campanhas' },
      { to: '/agenda', label: 'Agenda', icon: CalendarDays },
      { to: '/tarefas', label: 'Tarefas', icon: ListChecks },
      { to: '/avisos', label: 'Avisos', icon: Bell },
      { to: '/leads', label: 'Leads', icon: Users, end: true },
      { to: '/clientes', label: 'Clientes', icon: UserCheck },
    ],
  },
  {
    label: 'Gestão',
    items: [
      { to: '/projetos', label: 'Projetos', icon: FolderKanban, modulo: 'projetos' },
      { to: '/equipe', label: 'Equipe', icon: BriefcaseBusiness },
      { to: '/servicos', label: 'Serviços', icon: ClipboardList },
      { to: '/usuarios', label: 'Usuários', icon: UsersRound, gestor: true },
      { to: '/configuracoes', label: 'Configurações', icon: Settings, gestor: true },
    ],
  },
]

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const [recolhida, setCollapsed] = useState(false)
  const mobile = useMediaQuery('(max-width: 850px)')
  const collapsed = recolhida && !mobile
  const { usuario, gestor } = useSessao()
  const navigate = useNavigate()
  const { avisos } = useAvisos()
  const abertos = avisos.length
  const urgentes = avisos.some(a => a.gravidade === 'critico')

  // O menu do rodapé. Fecha ao clicar fora, com Esc, e ao escolher um item —
  // não precisa de efeito escutando a rota: sair dele por qualquer caminho
  // passa por um `mousedown` fora, que já fecha.
  const [menuAberto, setMenuAberto] = useState(false)
  const rodape = useRef<HTMLDivElement | null>(null)

  useFocusScope(rodape, menuAberto, () => setMenuAberto(false))

  useEffect(() => {
    if (!menuAberto) return
    const fora = (e: MouseEvent) => {
      if (rodape.current && !rodape.current.contains(e.target as Node)) setMenuAberto(false)
    }
    document.addEventListener('mousedown', fora)
    return () => {
      document.removeEventListener('mousedown', fora)
    }
  }, [menuAberto])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    onNavigate?.()
    navigate('/login')
  }
  const nomeUsuario = usuario?.nome?.trim() || 'Sua conta'
  const initials = usuario?.nome?.trim() ? nomeUsuario.split(/\s+/).map(n => n[0]).slice(0, 2).join('').toUpperCase() : '?'
  return <aside className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="Navegação principal">
    <div className="sidebar-brand" aria-label="CRM"><span className="brand-word">crm</span></div>
    <nav aria-label="Páginas do CRM">
      {NAV_GROUPS.map(grupo => <div className="nav-group" key={grupo.label}>
        {!collapsed && <div className="nav-group-label">{grupo.label}</div>}
        {grupo.items.filter(item => (!item.gestor || gestor) && (!item.modulo || moduloAtivo(item.modulo))).map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} aria-label={label} title={collapsed ? label : undefined} onClick={onNavigate} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          <Icon size={19} strokeWidth={1.8} />{!collapsed && <span>{label}</span>}
          {to === '/avisos' && abertos > 0 && <span className={`nav-badge${urgentes ? ' nav-badge-urgente' : ''}`} aria-label={`${abertos} ${abertos === 1 ? 'aviso aberto' : 'avisos abertos'}`}>{abertos > 99 ? '99+' : abertos}</span>}
        </NavLink>)}
      </div>)}
    </nav>
    <button className="sidebar-collapse" onClick={() => setCollapsed(v => !v)} aria-label={collapsed ? 'Expandir a barra' : 'Recolher a barra'}>
      {collapsed ? <ChevronRight size={17} /> : <><ChevronLeft size={17} />Recolher barra</>}
    </button>
    <div className="sidebar-bottom">
      <SeletorTema compacto={collapsed} />
      <div ref={rodape} className="account-container">
        {menuAberto && <div id="account-menu" className="account-menu" aria-label="Opções da conta">
          {MENU_USUARIO.filter(item => (!item.gestor || gestor) && (!item.modulo || moduloAtivo(item.modulo))).map(({ to, label, icon: Icon }) => <Link key={to} to={to} onClick={() => { setMenuAberto(false); onNavigate?.() }}><Icon size={16} />{label}</Link>)}
          <button onClick={() => void handleLogout()}><LogOut size={16} />Sair</button>
        </div>}
        <button className="account-button" onClick={() => setMenuAberto(v => !v)} aria-expanded={menuAberto} aria-controls="account-menu" aria-label={`Conta: ${nomeUsuario}`}>
          {usuario?.avatar_url ? <img className="account-avatar" src={usuario.avatar_url} alt="" /> : <span className="account-avatar">{initials}</span>}
          {!collapsed && <><span className="account-name"><strong>{nomeUsuario}</strong><small>{usuario?.papel === 'gestor' ? 'Gestor' : 'Consultor'}</small></span><ChevronUp size={14} /></>}
        </button>
      </div>
    </div>
  </aside>
}
