import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { friendly } from '../lib/errors'
import { button, card, h1, h2, input, label } from '../components/ui'

type Member = { user_id: string; role: string; profiles: { display_name: string | null } | null }
type Event = { id: string; name: string; starts_on: string | null; venue: string | null }
type Template = { id: string; name: string; description: string | null; visibility: string }

export function OrgHome() {
  const { orgId = '' } = useParams()
  const navigate = useNavigate()
  const [name, setName] = useState<string | null>(null)
  const [isProducer, setIsProducer] = useState(false)
  const [members, setMembers] = useState<Member[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [form, setForm] = useState({ name: '', starts_on: '', venue: '' })
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [org, mem, ev, me, tp] = await Promise.all([
      supabase.from('orgs').select('name').eq('id', orgId).maybeSingle(),
      supabase.from('org_members').select('user_id, role, profiles(display_name)').eq('org_id', orgId),
      supabase.from('events').select('id, name, starts_on, venue').eq('org_id', orgId).order('starts_on', { ascending: false, nullsFirst: true }),
      supabase.auth.getUser(),
      supabase.from('templates').select('id, name, description, visibility').eq('org_id', orgId).order('name'),
    ])
    const failed = org.error ?? mem.error ?? ev.error
    if (failed) return setError(friendly(failed))
    if (!org.data) return setError("This organization doesn't exist, or you're not a member.")
    setName(org.data.name)
    setMembers(mem.data ?? [])
    setEvents(ev.data ?? [])
    setTemplates(tp.data ?? [])
    setIsProducer((mem.data ?? []).some(m => m.user_id === me.data.user?.id && m.role === 'producer'))
  }, [orgId])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; setState runs after the awaits
  useEffect(() => { load() }, [load])

  async function createEvent(e: FormEvent) {
    e.preventDefault()
    const { data, error } = await supabase.from('events')
      .insert({ org_id: orgId, name: form.name, starts_on: form.starts_on || null, venue: form.venue || null })
      .select('id').single()
    if (error) return setError(friendly(error))
    navigate(`/e/${data.id}`)
  }

  if (name === null) return error ? <p role="alert" className="text-danger">{error}</p> : <p className="text-muted">Loading…</p>

  return (
    <div className="grid gap-10">
      <h1 className={h1}>{name}</h1>

      <section className="grid gap-3">
        <h2 className={h2}>Events</h2>
        {events.length === 0 ? (
          <p className="text-muted">No events yet.{isProducer && ' Create your first one below.'}</p>
        ) : (
          <ul className="grid gap-2">
            {events.map(ev => (
              <li key={ev.id}>
                <Link to={`/e/${ev.id}`} className={`${card} flex flex-wrap justify-between gap-2 px-4 py-3 hover:border-accent`}>
                  <span className="font-medium">{ev.name}</span>
                  <span className="text-sm text-muted">{[ev.starts_on, ev.venue].filter(Boolean).join(' · ')}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {isProducer && (
          <form onSubmit={createEvent} className="grid max-w-2xl gap-3 sm:grid-cols-[2fr_1fr_1.5fr_auto] sm:items-end">
            <div className="grid gap-1">
              <label htmlFor="ev-name" className={label}>Event name</label>
              <input id="ev-name" required maxLength={120} placeholder="IML Weekend 2027" className={input}
                value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <label htmlFor="ev-date" className={label}>Starts</label>
              <input id="ev-date" type="date" className={input} value={form.starts_on} onChange={e => setForm({ ...form, starts_on: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <label htmlFor="ev-venue" className={label}>Venue</label>
              <input id="ev-venue" className={input} value={form.venue} onChange={e => setForm({ ...form, venue: e.target.value })} />
            </div>
            <button className={button}>Create event</button>
          </form>
        )}
      </section>

      {templates.length > 0 && (
        <section className="grid gap-3">
          <h2 className={h2}>Templates</h2>
          <ul className={`${card} divide-y divide-rule`}>
            {templates.map(t => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                <span className="flex-1"><span className="font-medium">{t.name}</span>{t.description && <span className="text-sm text-muted"> · {t.description}</span>}</span>
                {isProducer ? (
                  <select aria-label={`Who can use ${t.name}`} className={`${input} w-auto py-1 text-sm`} value={t.visibility}
                    onChange={async e => { const { error } = await supabase.from('templates').update({ visibility: e.target.value }).eq('id', t.id); if (error) setError(friendly(error)); load() }}>
                    <option value="private">My organization</option>
                    <option value="public">Any producer</option>
                  </select>
                ) : <span className="font-mono text-xs text-muted">{t.visibility === 'public' ? 'any producer' : 'this organization'}</span>}
                {isProducer && <button className="rounded border border-rule px-2 py-1 font-mono text-xs hover:border-accent" aria-label={`Delete ${t.name}`}
                  onClick={async () => { if (!window.confirm(`Delete template "${t.name}"? Contests made from it are not affected.`)) return
                    const { error } = await supabase.from('templates').delete().eq('id', t.id); if (error) setError(friendly(error)); load() }}>✕</button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-3">
        <h2 className={h2}>Members</h2>
        <ul className={`${card} divide-y divide-rule`}>
          {members.map(m => (
            <li key={m.user_id} className="flex justify-between px-4 py-2">
              <span>{m.profiles?.display_name ?? 'Unnamed'}</span>
              <span className="font-mono text-sm text-muted">{m.role}</span>
            </li>
          ))}
        </ul>
      </section>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  )
}
