import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Member = { user_id: string; role: string; profiles: { display_name: string | null } | null }

export function OrgHome() {
  const { orgId = '' } = useParams()
  const [name, setName] = useState<string | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      supabase.from('orgs').select('name').eq('id', orgId).maybeSingle(),
      supabase.from('org_members').select('user_id, role, profiles(display_name)').eq('org_id', orgId),
    ]).then(([org, mem]) => {
      if (org.error || mem.error) return setError((org.error ?? mem.error)!.message)
      if (!org.data) return setError("This organization doesn't exist, or you're not a member.")
      setName(org.data.name)
      setMembers(mem.data ?? [])
    })
  }, [orgId])

  if (error) return <p role="alert" className="text-danger">{error}</p>
  if (name === null) return <p className="text-muted">Loading…</p>

  return (
    <div className="grid gap-8">
      <h1 className="font-display text-3xl font-extrabold uppercase">{name}</h1>
      <section className="grid gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Events</h2>
        <p className="text-muted">Events and contests arrive in P1.</p>
      </section>
      <section className="grid gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Members</h2>
        <ul className="divide-y divide-rule rounded border border-rule bg-surface">
          {members.map(m => (
            <li key={m.user_id} className="flex justify-between px-4 py-2">
              <span>{m.profiles?.display_name ?? 'Unnamed'}</span>
              <span className="font-mono text-sm text-muted">{m.role}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
