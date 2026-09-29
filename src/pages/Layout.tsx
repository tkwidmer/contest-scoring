import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useSession } from '../context/auth'
import { Brand } from '../components/Brand'
import { Landing } from './Landing'

// Signed-in shell. Everything under it requires a session; signed-out visitors to / get the landing page.
export function Layout() {
  const session = useSession()
  const { pathname } = useLocation()
  if (session === undefined) return null
  if (!session) return pathname === '/' ? <Landing /> : <Navigate to="/login" replace />
  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule bg-surface print:hidden">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/"><Brand className="text-2xl" /></Link>
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
