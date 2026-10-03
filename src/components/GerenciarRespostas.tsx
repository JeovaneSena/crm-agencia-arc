import { useState } from 'react'
import { Pencil, Trash2, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useSessao } from '../lib/sessao'
import type { RespostaRapida } from '../lib/respostasRapidas'
import ModalPortal from './ModalPortal'
import { Button, Notice } from './ui'

/**
 * Criar, editar e apagar respostas rápidas. Pessoais: cada um as suas. Da equipe: só o gestor
 * (a policy do banco recusa os outros; a tela só esconde a opção).
 */
const VAZIO = { titulo: '', texto: '', atalho: '', equipe: false }

export default function GerenciarRespostas({ respostas, onFechar, onMudou }: { respostas: RespostaRapida[]; onFechar: () => void; onMudou: () => void }) {
  const { usuario, gestor } = useSessao()
  const [form, setForm] = useState(VAZIO)
  const [editando, setEditando] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const podeMexer = (r: RespostaRapida) => r.dono_id === null ? gestor : r.dono_id === usuario?.id
  const atalhoLimpo = form.atalho.trim().replace(/^\//, '').toLowerCase()
  const valido = form.titulo.trim().length > 0 && form.texto.trim().length > 0 && (atalhoLimpo === '' || /^[a-z0-9_-]{1,20}$/.test(atalhoLimpo))

  async function salvar() {
    if (!usuario || !valido) return
    setSalvando(true); setErro('')
    const campos = { titulo: form.titulo.trim(), texto: form.texto.trim(), atalho: atalhoLimpo || null }
    const { error } = editando
      ? await supabase.from('respostas_rapidas').update(campos).eq('id', editando)
      : await supabase.from('respostas_rapidas').insert({ ...campos, dono_id: form.equipe ? null : usuario.id, criada_por: usuario.id })
    setSalvando(false)
    if (error) { setErro(error.code === '23505' ? 'Já existe uma resposta com esse atalho.' : 'Não foi possível salvar. Confira os campos.'); return }
    setForm(VAZIO); setEditando(null); onMudou()
  }

  async function apagar(r: RespostaRapida) {
    const { error } = await supabase.from('respostas_rapidas').delete().eq('id', r.id)
    if (error) { setErro('Não foi possível apagar.'); return }
    if (editando === r.id) { setForm(VAZIO); setEditando(null) }
    onMudou()
  }

  return <ModalPortal label="Respostas rápidas" onClose={onFechar} busy={salvando}>
    <div onClick={(e) => { if (e.target === e.currentTarget) onFechar() }}>
      <div className="arc-card" style={{ maxWidth: 640, margin: '0 auto', display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>Respostas rápidas</h2>
          <button type="button" aria-label="Fechar" onClick={onFechar} style={{ background: 'none', border: 0, cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>Use <code>{'{{nome}}'}</code> e <code>{'{{primeiro_nome}}'}</code> no texto. Na conversa, digite <code>/atalho</code> e Enter para inserir.</p>
        {erro && <Notice tone="danger">{erro}</Notice>}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
          {respostas.map((r) => <li key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 10px' }}>
            <span style={{ minWidth: 0 }}><strong>{r.titulo}</strong> {r.atalho && <code>/{r.atalho}</code>} <small style={{ color: 'var(--muted)' }}>{r.dono_id === null ? 'da equipe' : 'minha'}</small>
              <span style={{ display: 'block', color: 'var(--muted)', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.texto}</span></span>
            {podeMexer(r) && <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button type="button" aria-label={`Editar ${r.titulo}`} onClick={() => { setEditando(r.id); setForm({ titulo: r.titulo, texto: r.texto, atalho: r.atalho ?? '', equipe: r.dono_id === null }) }}><Pencil size={15} /></button>
              <button type="button" aria-label={`Apagar ${r.titulo}`} onClick={() => void apagar(r)}><Trash2 size={15} /></button>
            </span>}
          </li>)}
          {respostas.length === 0 && <li style={{ color: 'var(--muted)', fontSize: 13 }}>Nenhuma resposta ainda.</li>}
        </ul>
        <form onSubmit={(e) => { e.preventDefault(); void salvar() }} style={{ display: 'grid', gap: 10, borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
          <strong style={{ fontSize: 14 }}>{editando ? 'Editar resposta' : 'Nova resposta'}</strong>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Título<input className="arc-field" maxLength={60} value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} /></label>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Texto<textarea className="arc-field" rows={4} maxLength={1000} value={form.texto} onChange={(e) => setForm({ ...form, texto: e.target.value })} /></label>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Atalho (opcional, sem espaços)<input className="arc-field" maxLength={21} placeholder="ex.: endereco" value={form.atalho} onChange={(e) => setForm({ ...form, atalho: e.target.value })} /></label>
          {gestor && !editando && <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={form.equipe} onChange={(e) => setForm({ ...form, equipe: e.target.checked })} /> Compartilhar com a equipe toda</label>}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" type="submit" disabled={!valido || salvando}>{salvando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Criar resposta'}</Button>
            {editando && <Button type="button" onClick={() => { setForm(VAZIO); setEditando(null) }}>Cancelar edição</Button>}
          </div>
        </form>
      </div>
    </div>
  </ModalPortal>
}
