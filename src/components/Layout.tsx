import { useEffect, useState, useRef } from 'react'
import { Outlet } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import Sidebar from './Sidebar'
import AvisoWhatsAppCaiu from './AvisoWhatsAppCaiu'
import { supabase } from '../lib/supabase'
import { definirNomeDoAgente } from '../lib/agente'
import { useMediaQuery } from '../lib/useMediaQuery'
import { useFocusScope } from '../lib/useFocusScope'
import { moduloAtivo } from '../lib/modulos'

/**
 * A casca do sistema: barra lateral fixa + conteúdo que rola.
 *
 * ⚠️ `height: 100vh` COM `overflow: hidden`, e não `minHeight`. A diferença
 * não é sutil:
 *
 * Com `minHeight`, o container cresce junto com a página, a barra lateral
 * estica junto (ela é um item flex, e `stretch` é o padrão) e o rodapé dela —
 * o nome do usuário e o menu — vai parar no fim do DOCUMENTO. Em telas altas
 * como Dashboard, Agenda e Configurações, ele simplesmente sumia abaixo da
 * dobra, e só reaparecia rolando a página até o fim.
 *
 * Fixando a altura, quem rola é o `<main>`. A barra fica onde tem que ficar:
 * do topo ao pé da janela, sempre.
 *
 * ── E É AQUI QUE O NOME DO AGENTE ENTRA ────────────────────────────────────
 *
 * Uma consulta, uma vez por sessão, no único componente por onde toda tela
 * autenticada passa. Alternativa seria cada tela buscar o seu — treze
 * consultas para o mesmo dado, e treze chances de uma delas esquecer.
 *
 * Enquanto ela não volta, vale o `NOME_PADRAO` — a interface nunca fica com
 * frases sem sujeito. Se falhar, o padrão continua valendo: o nome errado é
 * pior que nome nenhum, mas frase quebrada é pior que os dois.
 *
 * ── E O AVISO DE QUEDA DO WHATSAPP TAMBÉM ──────────────────────────────────
 *
 * Pelo mesmo motivo: é o único componente por onde toda tela autenticada passa.
 * A faixa morava dentro de Conversas, apostando que a recepção passa o dia ali
 * — quem estivesse na Agenda ou no CRM não via nada. Aqui, ela alcança quem
 * quer que esteja logado. Ela some sozinha quando está tudo bem, e só aparece
 * depois de um minuto de queda contínua.
 */
export default function Layout() {
  const [menuAberto, setMenuAberto] = useState(false)
  const mobile = useMediaQuery('(max-width: 850px)')
  const drawer = useRef<HTMLDivElement>(null)
  const aberto = menuAberto && mobile
  useFocusScope(drawer, aberto, () => setMenuAberto(false))
  useEffect(() => {
    if (!moduloAtivo('assistente')) return
    let vivo = true
    supabase
      .from('assistente_config')
      .select('nome')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (vivo && data?.nome) definirNomeDoAgente(data.nome)
      })
    return () => { vivo = false }
  }, [])

  return (
    <div className="app-frame">
      <a className="skip-link" href="#conteudo">Ir para o conteúdo</a>
      {(moduloAtivo('conversas') || moduloAtivo('assistente')) && <AvisoWhatsAppCaiu />}

      {/* ⚠️ `minHeight: 0` é o que faz o `<main>` rolar por dentro em vez de
          esticar a linha. Sem ele, a faixa empurraria a barra lateral e o
          conteúdo para fora da janela — o mesmo defeito que o `height: 100vh`
          acima existe para evitar. */}
      <div className={`app-shell${aberto ? ' menu-aberto' : ''}`}>
        <div className="mobile-header"><button aria-expanded={aberto} aria-controls="navegacao" aria-label="Menu de navegação" onClick={() => setMenuAberto(v => !v)}>{aberto ? <X size={20} /> : <Menu size={20} />}</button><strong>CRM</strong><span style={{ width: 40 }} /></div>
        {aberto && <button className="mobile-backdrop" tabIndex={-1} aria-label="Fechar navegação" onClick={() => setMenuAberto(false)} />}
        <div ref={drawer} id="navegacao" className="sidebar-wrapper" role={aberto ? 'dialog' : undefined} aria-modal={aberto || undefined} aria-label={aberto ? 'Menu de navegação' : undefined} tabIndex={-1}>
          <Sidebar onNavigate={() => setMenuAberto(false)} />
        </div>
        <main id="conteudo" className="app-main" tabIndex={-1} inert={aberto}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
