import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Org = { id: string; name: string }

export function Home() {
  const navigate = useNavigate()
  const [orgs, setOrgs] = useState<Org[] | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('orgs').select('id, name').order('name').then(({ data, error }) => {
      if (error) setError(error.message)
      setOrgs(data ?? [])
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
      <section className="grid gap-3">
        <h1 className="font-display text-3xl font-extrabold uppercase">Your organizations</h1>
        {orgs === null ? (
          <p className="text-muted">Loading…</p>
        ) : orgs.length === 0 ? (
          <p className="text-muted">You're not in any organization yet. Create one below to start producing contests.</p>
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
