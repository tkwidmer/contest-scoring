import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { GoogleButton } from '../components/GoogleButton'
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
  const verify = (e: FormEvent) => {
    e.preventDefault()
    run(() => supabase.auth.verifyOtp({ email, token: code.trim(), type: 'email' }))
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-sm content-center gap-6 px-4">
      <h1><Link to="/"><Brand className="text-4xl" /></Link></h1>
      {!sent && googleOn && <>
        {/* Google sign-in sends no email, so it works whatever the email setup. The account's email is what judge seats
            and org invites are matched against. */}
        <GoogleButton onError={setError} />
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
