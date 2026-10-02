import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'

export function Button({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  return <button className={`arc-button arc-button-${variant} ${className}`} {...props} />
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return <header className="page-header"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</header>
}

export function Card({ className = '', ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`arc-card ${className}`} {...props} />
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'danger' | 'success' | 'warning' }) {
  return <div className={`arc-notice arc-notice-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>{children}</div>
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty-state"><strong>{title}</strong>{children && <p>{children}</p>}</div>
}

export function LoadingState({ label = 'Carregando…' }: { label?: string }) {
  return <div className="loading-state" role="status"><span className="spinner" aria-hidden="true" />{label}</div>
}
