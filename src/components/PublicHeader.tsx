import { Link } from 'react-router-dom'
import { Brand } from './Brand'
import { useSession } from '../context/auth'

// Header for the public pages (landing, pricing).
export function PublicHeader() {
  const session = useSession()
  return (
    <header className="border-b border-rule bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link to="/"><Brand className="text-2xl" /></Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link to="/pricing" className="hover:text-accent">Pricing</Link>
          {session
            ? <Link to="/dashboard" className="rounded bg-accent px-3 py-1 font-medium text-on-accent hover:opacity-90">Dashboard</Link>
            : <Link to="/login" className="rounded border border-rule px-3 py-1 hover:border-accent">Sign in</Link>}
        </nav>
      </div>
    </header>
  )
}

export function PublicFooter() {
  return (
    <footer className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-4 py-6 text-sm text-muted">
      <Brand className="text-base" />
      <span>Made by and for the leather community.</span>
    </footer>
  )
}
