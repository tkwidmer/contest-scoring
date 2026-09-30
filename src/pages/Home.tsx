import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Org = { id: string; name: string }
type Seat = { id: string; contests: { id: string; name: string; status: string; events: { name: string } | null } | null }

export function Home() {
  const navigate = useNavigate()
  const [orgs, setOrgs] = useState<Org[] | null>(null)
  const [seats, setSeats] = useState<Seat[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    // Claim any judge seats and org invites sent to this email first, so they show up below.
    supabase.rpc('claim_invites').then(async () => {
      const uid = (await supabase.auth.getUser()).data.user?.id ?? ''
      const [o, j] = await Promise.all([
        supabase.from('orgs').select('id, name').order('name'),
        supabase.from('judges').select('id, contests(id, name, status, events(name))').eq('user_id', uid),
      ])
      if (o.error ?? j.error) setError((o.error ?? j.error)!.message)
      setOrgs(o.data ?? [])
      setSeats(j.data ?? [])
    })
  }, [])

  async function createOrg(e: FormEvent) {
    e.preventDefault()
    const { data, error } = await supabase.rpc('create_org', { p_name: name })
    if (error) return setError(error.message)
    navigate(`/o/${data}`)
  }

  return (
    <div className="grid gap-8">
      {seats.length > 0 && (
        <section className="grid gap-3">
          <h1 className="font-display text-3xl font-extrabold uppercase">Judging</h1>
          <ul className="grid gap-2">
            {seats.map(s => s.contests && (
              <li key={s.id}>
                <Link to={`/judge/${s.contests.id}`} className="flex items-baseline justify-between gap-3 rounded border border-rule bg-surface px-4 py-3 hover:border-accent">
                  <span><span className="font-medium">{s.contests.name}</span> <span className="text-sm text-muted">{s.contests.events?.name}</span></span>
                  <span className="font-mono text-sm text-muted">{s.contests.status === 'scoring' ? 'scoring open' : s.contests.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="grid gap-3">
        <h1 className="font-display text-3xl font-extrabold uppercase">Your organizations</h1>
        {orgs === null ? (
          <p className="text-muted">Loading…</p>
        ) : orgs.length === 0 ? (
          <p className="text-muted">You're not in any organization yet. Producing a contest? Create one below.</p>
        ) : (
          <ul className="grid gap-2">
            {orgs.map(o => (
              <li key={o.id}>
                <Link to={`/o/${o.id}`} className="block rounded border border-rule bg-surface px-4 py-3 hover:border-accent">{o.name}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form onSubmit={createOrg} className="grid max-w-md gap-2">
        <label htmlFor="org-name" className="text-sm text-muted">New organization name</label>
        <div className="flex gap-2">
          <input id="org-name" required maxLength={120} placeholder="International Mr. Leather, Inc." className="min-w-0 flex-1 rounded border border-rule bg-surface px-3 py-2 focus:border-accent focus:outline-none" value={name} onChange={e => setName(e.target.value)} />
          <button className="rounded bg-accent px-4 py-2 font-medium text-on-accent">Create</button>
        </div>
      </form>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  )
}
