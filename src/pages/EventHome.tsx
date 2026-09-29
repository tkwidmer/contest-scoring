import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { TablesInsert } from '../lib/database.types'
import { friendly } from '../lib/errors'
import { button, card, h1, h2, input, label } from '../components/ui'

type Contest = { id: string; name: string; status: string }
type Source = { value: string; label: string } // '' = blank, 'c:<id>' = copy a contest, 't:<id>' = template
type Event = { name: string; org_id: string; starts_on: string | null; venue: string | null; orgs: { name: string } | null }

export function EventHome() {
  const { eventId = '' } = useParams()
  const navigate = useNavigate()
  const [event, setEvent] = useState<Event | null>(null)
  const [contests, setContests] = useState<Contest[]>([])
  const [name, setName] = useState('')
  const [source, setSource] = useState('')
  const [sources, setSources] = useState<{ group: string; options: Source[] }[]>([])
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
    const [past, tpl] = await Promise.all([
      supabase.from('contests').select('id, name, events(name)').eq('org_id', ev.data.org_id).order('created_at', { ascending: false }),
      supabase.from('templates').select('id, name, visibility, org_id').order('name'),
    ])
    const t = tpl.data ?? []
    const orgId = ev.data.org_id
    const opts = (list: typeof t) => list.map(x => ({ value: `t:${x.id}`, label: x.name }))
    setSources([
      { group: 'Official templates', options: opts(t.filter(x => x.visibility === 'curated')) },
      { group: "Your organization's templates", options: opts(t.filter(x => x.org_id === orgId)) },
      { group: 'Shared by other producers', options: opts(t.filter(x => x.visibility === 'public' && x.org_id !== orgId)) },
      { group: 'Copy a contest', options: (past.data ?? []).map(c => ({ value: `c:${c.id}`, label: `${c.name} (${c.events?.name})` })) },
    ].filter(g => g.options.length))
  }, [eventId])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; setState runs after the awaits
  useEffect(() => { load() }, [load])

  async function createContest(e: FormEvent) {
    e.preventDefault()
    const [kind, id = ''] = source.split(':')
    const { data, error } = kind === 'c'
      ? await supabase.rpc('clone_contest', { p_source: id, p_event: eventId, p_name: name })
      : kind === 't'
        ? await supabase.rpc('create_contest_from_template', { p_template: id, p_event: eventId, p_name: name })
        // org_id is filled in from the event by the contests_set_org trigger; the generated types don't know that.
        : await supabase.from('contests').insert({ event_id: eventId, name } as TablesInsert<'contests'>).select('id').single().then(r => ({ ...r, data: r.data?.id }))
    if (error) return setError(friendly(error))
    navigate(`/c/${data}/setup`)
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
        <form onSubmit={createContest} className="grid max-w-2xl gap-2 sm:grid-cols-[2fr_2fr_auto] sm:items-end">
          <div className="grid gap-1">
            <label htmlFor="contest-name" className={label}>New contest (title)</label>
            <input id="contest-name" required maxLength={120} placeholder="International Mr. Leather" className={input}
              value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <label htmlFor="contest-source" className={label}>Scoresheet</label>
            <select id="contest-source" className={input} value={source} onChange={e => setSource(e.target.value)}>
              <option value="">Start blank</option>
              {sources.map(g => (
                <optgroup key={g.group} label={g.group}>
                  {g.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <button className={button}>Add contest</button>
        </form>
        <p className="text-xs text-muted">Templates and copies bring the scoresheet, scoring method, minimum and tiebreaks. Contestants and judges are added fresh.</p>
      </section>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  )
}
