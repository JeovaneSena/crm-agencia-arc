import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BellRing, CheckCircle2 } from 'lucide-react'
import { Button, Card, EmptyState, LoadingState, Notice, PageHeader } from '../components/ui'
import { ROTULO_GRAVIDADE, haQuanto, rotaSegura, useAvisos, type Aviso } from '../lib/avisos'

const TOM: Record<Aviso['gravidade'], string> = { critico: 'danger', atencao: 'warning', info: 'muted' }

export default function Avisos() {
  const [aba, setAba] = useState<'abertos' | 'resolvidos'>('abertos')
  const { avisos, carregando, erro, dispensar } = useAvisos(aba === 'resolvidos')
  const [dispensando, setDispensando] = useState<string | null>(null)

  async function dispensarAviso(id: string) {
    setDispensando(id)
    await dispensar(id)
    setDispensando(null)
  }

  return <div className="page-content">
    <PageHeader
      eyebrow="Gestão"
      title="Avisos"
      description="O que o sistema pede que a equipe olhe. Um aviso some sozinho quando o problema é resolvido; dispensar silencia o mesmo aviso por algumas horas."
    />
    <div role="tablist" aria-label="Estado dos avisos" style={{ display: 'flex', gap: 8, margin: '0 0 16px' }}>
      <Button role="tab" aria-selected={aba === 'abertos'} variant={aba === 'abertos' ? 'primary' : 'secondary'} onClick={() => setAba('abertos')}>Abertos</Button>
      <Button role="tab" aria-selected={aba === 'resolvidos'} variant={aba === 'resolvidos' ? 'primary' : 'secondary'} onClick={() => setAba('resolvidos')}>Resolvidos</Button>
    </div>
    {erro && <Notice tone="danger">{erro}</Notice>}
    {carregando ? <LoadingState label="Carregando avisos…" /> : avisos.length === 0
      ? <Card><EmptyState title={aba === 'abertos' ? 'Nenhum aviso aberto' : 'Nada resolvido recentemente'}>{aba === 'abertos' ? 'Quando algo precisar de atenção, aparece aqui.' : 'Os últimos 50 avisos resolvidos aparecem aqui.'}</EmptyState></Card>
      : <div style={{ display: 'grid', gap: 12 }}>
        {avisos.map(a => {
          const rota = rotaSegura(a.rota)
          return <Card key={a.id} aria-label={a.titulo}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: '1 1 280px' }}>
                <span className={`arc-tag arc-tag-${TOM[a.gravidade]}`}>{ROTULO_GRAVIDADE[a.gravidade]}</span>
                <h2 style={{ fontSize: 16, margin: '8px 0 4px' }}>{a.titulo}</h2>
                {a.detalhe && <p style={{ margin: '0 0 6px', color: 'var(--muted)' }}>{a.detalhe}</p>}
                <small style={{ color: 'var(--muted)' }}>
                  {a.resolvido_em ? `${a.resolucao === 'automatica' ? 'Resolvido sozinho' : 'Dispensado'} ${haQuanto(a.resolvido_em)}` : `Última vez ${haQuanto(a.ultima_em)}`}
                  {a.ocorrencias > 1 && ` · ${a.ocorrencias} ocorrências`}
                  {a.somente_gestor && ' · só gestor'}
                </small>
              </div>
              {!a.resolvido_em && <div style={{ display: 'flex', gap: 8 }}>
                {rota && <Link className="arc-button arc-button-secondary" to={rota}><BellRing size={15} />Ver</Link>}
                <Button onClick={() => void dispensarAviso(a.id)} disabled={dispensando === a.id}><CheckCircle2 size={15} />Dispensar</Button>
              </div>}
            </div>
          </Card>
        })}
      </div>}
  </div>
}
