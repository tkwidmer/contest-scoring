import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { TablesInsert } from '../lib/database.types'
import { friendly } from '../lib/errors'
import { button, card, h1, h2, input, label } from '../components/ui'

type Contest = { id: string; name: string; status: string }
type Event = { name: string; org_id: string; starts_on: string | null; venue: string | null; orgs: { name: string } | null }

export function EventHome() {
  const { eventId = '' } = useParams()
  const navigate = useNavigate()
  const [event, setEvent] = useState<Event | null>(null)
  const [contests, setContests] = useState<Contest[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [ev, cs] = await Promise.all([
      supabase.from('events').select('name, org_id, starts_on, venue, orgs(name)').eq('id', eventId).maybeSingle(),
      supabase.from('contests').select('id, name, status').eq('event_id', eventId).order('created_at'),
    ])
    const failed = ev.error ?? cs.error
    if (failed) return setError(friendly(failed))
    if (!ev.data) return setError("This event doesn't exist, or you're not a member of its organization.")
    setEvent(ev.data)
    setContests(cs.data ?? [])
  }, [eventId])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; setState runs after the awaits
  useEffect(() => { load() }, [load])

  async function createContest(e: FormEvent) {
    e.preventDefault()
    // org_id is filled in from the event by the contests_set_org trigger; the generated types don't know that.
    const row = { event_id: eventId, name } as TablesInsert<'contests'>
    const { data, error } = await supabase.from('contests').insert(row).select('id').single()
    if (error) return setError(friendly(error))
    navigate(`/c/${data.id}/setup`)
  }

  if (!event) return error ? <p role="alert" className="text-danger">{error}</p> : <p className="text-muted">Loading…</p>

  return (
    <div className="grid gap-10">
      <div className="grid gap-1">
        <Link to={`/o/${event.org_id}`} className="text-sm text-accent">← {event.orgs?.name}</Link>
        <h1 className={h1}>{event.name}</h1>
        <p className="text-muted">{[event.starts_on, event.venue].filter(Boolean).join(' · ')}</p>
      </div>

      <section className="grid gap-3">
        <h2 className={h2}>Contests</h2>
        {contests.length === 0 ? (
          <p className="text-muted">No contests yet. Add one for each title awarded at this event.</p>
        ) : (
          <ul className="grid gap-2">
            {contests.map(c => (
              <li key={c.id}>
                <Link to={`/c/${c.id}/setup`} className={`${card} flex justify-between gap-2 px-4 py-3 hover:border-accent`}>
                  <span className="font-medium">{c.name}</span>
                  <span className="font-mono text-sm text-muted">{c.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={createContest} className="grid max-w-md gap-1">
          <label htmlFor="contest-name" className={label}>New contest (title)</label>
          <div className="flex gap-2">
            <input id="contest-name" required maxLength={120} placeholder="Mr Great Lakes Leather" className={input}
              value={name} onChange={e => setName(e.target.value)} />
            <button className={button}>Add</button>
          </div>
        </form>
      </section>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  )
}
