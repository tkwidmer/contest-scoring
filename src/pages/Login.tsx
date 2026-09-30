import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { supabase } from '../lib/supabase'
import { useSession } from '../context/auth'

const input = 'w-full rounded border border-rule bg-surface px-3 py-2 focus:border-accent focus:outline-none'
const button = 'w-full rounded bg-accent px-4 py-2 font-medium text-on-accent disabled:opacity-60'

export function Login() {
  const session = useSession()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Only offer Google when it's switched on for this Supabase project (off locally unless configured).
  const [googleOn, setGoogleOn] = useState(false)
  useEffect(() => {
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY } })
      .then(r => r.json()).then(s => setGoogleOn(!!s?.external?.google)).catch(() => {})
  }, [])

  if (session) return <Navigate to="/dashboard" replace />

  async function run(action: () => Promise<{ error: Error | null }>, onOk?: () => void) {
    setBusy(true)
    setError('')
    const { error } = await action()
    setBusy(false)
    if (error) setError(error.message)
    else onOk?.()
  }

  const sendCode = (e: FormEvent) => {
    e.preventDefault()
    run(() => supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/dashboard` } }), () => setSent(true))
  }
  const google = () => run(async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/dashboard` } })
    return { error }
  })
  const verify = (e: FormEvent) => {
    e.preventDefault()
    run(() => supabase.auth.verifyOtp({ email, token: code.trim(), type: 'email' }))
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-sm content-center gap-6 px-4">
      <h1><Link to="/"><Brand className="text-4xl" /></Link></h1>
      {!sent && googleOn && <>
        {/* Google sign-in sends no email, so it works whatever the email setup (same flow as Inkborn Forge). The account's
            email is what judge seats and org invites are matched against. */}
        <button type="button" disabled={busy} onClick={google}
          className="flex w-full items-center justify-center gap-3 rounded border border-rule bg-surface px-4 py-2 font-medium hover:border-accent disabled:opacity-60">
          <svg aria-hidden viewBox="0 0 48 48" className="h-5 w-5"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          Continue with Google
        </button>
        <p className="flex items-center gap-3 text-xs uppercase tracking-wider text-muted"><span className="h-px flex-1 bg-rule" />or use your email<span className="h-px flex-1 bg-rule" /></p>
      </>}
      {!sent ? (
        <form onSubmit={sendCode} className="grid gap-3">
          <label htmlFor="email" className="text-sm text-muted">Email</label>
          <input id="email" type="email" required autoComplete="email" className={input} value={email} onChange={e => setEmail(e.target.value)} />
          <button className={button} disabled={busy}>{busy ? 'Sending…' : 'Email me a sign-in link'}</button>
        </form>
      ) : (
        <form onSubmit={verify} className="grid gap-3">
          <p className="text-sm text-muted">Check <strong className="text-fg">{email}</strong> and click the sign-in link. If the email shows a 6-digit code, you can enter it here instead.</p>
          <label htmlFor="code" className="text-sm text-muted">6-digit code</label>
          <input id="code" inputMode="numeric" autoComplete="one-time-code" required className={`${input} font-mono tracking-widest`} value={code} onChange={e => setCode(e.target.value)} />
          <button className={button} disabled={busy}>{busy ? 'Checking…' : 'Sign in'}</button>
          <button type="button" className="text-sm text-accent underline" onClick={() => { setSent(false); setCode('') }}>Use a different email</button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <p className="text-xs text-muted">By signing in you agree to our <Link to="/terms" className="underline">terms</Link> and <Link to="/privacy" className="underline">privacy policy</Link>.</p>
    </main>
  )
}
