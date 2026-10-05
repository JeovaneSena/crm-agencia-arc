import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import RotaDeGestor from './components/RotaDeGestor'
import Layout from './components/Layout'
import Login from './pages/Login'
import DefinirSenha from './pages/DefinirSenha'
import Dashboard from './pages/Dashboard'
import CRM from './pages/CRM'
import Conversas from './pages/Conversas'
import Agenda from './pages/Agenda'
import Profissionais from './pages/Profissionais'
import Leads from './pages/Leads'
import Clientes from './pages/Clientes'
import LeadDetail from './pages/LeadDetail'
import Configuracoes from './pages/Configuracoes'
import Procedimentos from './pages/Procedimentos'
import Assistente from './pages/Assistente'
import Projetos from './pages/Projetos'
import Campanhas from './pages/Campanhas'
import NovaCampanha from './pages/NovaCampanha'
import CampanhaDetalhe from './pages/CampanhaDetalhe'
import ModelosMeta from './pages/ModelosMeta'
import Usuarios from './pages/Usuarios'
import Avisos from './pages/Avisos'
import Tarefas from './pages/Tarefas'
import Radar from './pages/Radar'
import Automacoes from './pages/Automacoes'
import Casos from './pages/Casos'
import MelhoriasAssistente from './pages/MelhoriasAssistente'
import Captacao from './pages/Captacao'
import { moduloAtivo } from './lib/modulos'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* Fora do ProtectedRoute: quem chega pelo convite ainda não tem senha. */}
        <Route path="/definir-senha" element={<DefinirSenha />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/crm" element={<CRM />} />
            {moduloAtivo('conversas') && <Route path="/conversas" element={<Conversas />} />}
            {moduloAtivo('campanhas') && <Route path="/campanhas" element={<Campanhas />} />}
            {moduloAtivo('campanhas') && <Route path="/campanhas/modelos" element={<ModelosMeta />} />}
            {moduloAtivo('campanhas') && <Route path="/campanhas/nova" element={<NovaCampanha />} />}
            {moduloAtivo('campanhas') && <Route path="/campanhas/:id/editar" element={<NovaCampanha />} />}
            {moduloAtivo('campanhas') && <Route path="/campanhas/:id" element={<CampanhaDetalhe />} />}
            {moduloAtivo('casos') && <Route path="/casos" element={<Casos />} />}
            <Route path="/agenda" element={<Agenda />} />
            <Route path="/radar" element={<Radar />} />
            <Route path="/tarefas" element={<Tarefas />} />
            <Route path="/avisos" element={<Avisos />} />
            {moduloAtivo('projetos') && <Route path="/projetos" element={<Projetos />} />}
            <Route path="/equipe" element={<Profissionais />} />
            <Route path="/servicos" element={<Procedimentos />} />
            <Route path="/procedimentos" element={<Procedimentos />} />

            {/* Só gestor. Consultor que chegar pela URL volta ao Dashboard —
                e, se chegasse, o banco recusaria cada ação do mesmo jeito. */}
            <Route element={<RotaDeGestor />}>
              {moduloAtivo('melhorias') && <Route path="/melhorias-assistente" element={<MelhoriasAssistente />} />}
              <Route path="/usuarios" element={<Usuarios />} />
              {moduloAtivo('assistente') && <Route path="/assistente-ia" element={<Assistente />} />}
              {moduloAtivo('conversas') && <Route path="/automacoes" element={<Automacoes />} />}
              <Route path="/configuracoes" element={<Configuracoes />} />
            </Route>
            <Route path="/leads" element={<Leads />} />
            {moduloAtivo('captacao') && <Route path="/captacao" element={<Captacao />} />}
            <Route path="/clientes" element={<Clientes />} />
            <Route path="/leads/:id" element={<LeadDetail />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
