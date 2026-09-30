import { useEffect, useState } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useSession } from '../context/auth'
import { Brand } from '../components/Brand'

// Signed-in shell. Everything under it requires a session.
export function Layout() {
  const session = useSession()
  const [admin, setAdmin] = useState(false)
  const [pending, setPending] = useState(0)
  const { pathname } = useLocation()
  const userId = session?.user.id
  useEffect(() => {
    if (userId) supabase.from('profiles').select('is_platform_admin').eq('id', userId).maybeSingle().then(({ data }) => setAdmin(!!data?.is_platform_admin))
  }, [userId])
  // Platform admins: count approval requests waiting on them, rechecked on every page change.
  // ponytail: fetches the whole approval list; add a count RPC if events number in the thousands.
  useEffect(() => {
    if (admin) supabase.rpc('event_approvals').then(({ data }) => setPending((data ?? []).filter(r => r.requested_at && !r.approved_at).length))
  }, [admin, pathname])
  if (session === undefined) return null
  if (!session) return <Navigate to="/login" replace />
  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule bg-surface print:hidden">
        <div className="flag-stripes h-[9px]" aria-hidden />
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <Link to="/"><Brand className="text-2xl" /></Link>
          <div className="flex items-center gap-3 text-sm text-muted">
            <Link to="/dashboard" className="hover:text-fg">Dashboard</Link>
            {admin && (
              <Link to="/admin" className="flex items-center gap-1 hover:text-fg">
                Approvals
                {pending > 0 && <span className="rounded-full bg-danger px-1.5 font-mono text-xs text-on-accent" aria-label={`${pending} waiting`}>{pending}</span>}
              </Link>
            )}
            <span className="hidden sm:inline">{session?.user.email}</span>
            <button className="rounded border border-rule px-3 py-1 hover:border-accent" onClick={() => supabase.auth.signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      {pending > 0 && pathname !== '/admin' && (
        <div className="border-b border-danger bg-surface print:hidden">
          <p className="mx-auto max-w-5xl px-4 py-2 text-sm">
            <strong>{pending} event{pending === 1 ? '' : 's'} waiting for approval.</strong>{' '}
            <Link to="/admin" className="text-accent underline">Review requests</Link>
          </p>
        </div>
      )}
      <main className="mx-auto max-w-5xl px-4 py-8 print:max-w-none print:p-0">
        <Outlet />
      </main>
    </div>
  )
}
