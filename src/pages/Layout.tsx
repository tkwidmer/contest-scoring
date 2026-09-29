import { Link, Navigate, Outlet } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useSession } from '../context/auth'
import { Brand } from '../components/Brand'

// Signed-in shell. Everything under it requires a session.
export function Layout() {
  const session = useSession()
  if (session === undefined) return null
  if (!session) return <Navigate to="/login" replace />
  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule bg-surface print:hidden">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/dashboard"><Brand className="text-2xl" /></Link>
          <div className="flex items-center gap-3 text-sm text-muted">
            <span className="hidden sm:inline">{session?.user.email}</span>
            <button className="rounded border border-rule px-3 py-1 hover:border-accent" onClick={() => supabase.auth.signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
