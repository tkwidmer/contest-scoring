import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { TablesInsert } from '../lib/database.types'
import { friendly } from '../lib/errors'
import { button, buttonQuiet, card, h1, h2, iconButton, input, label } from '../components/ui'

type Contest = { id: string; name: string; status: string }
type Source = { value: string; label: string } // '' = blank, 'c:<id>' = copy a contest, 't:<id>' = template
type Event = { name: string; org_id: string; starts_on: string | null; venue: string | null; approval_requested_at: string | null; approved_at: string | null; archived_at: string | null; orgs: { name: string } | null }

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
      supabase.from('events').select('name, org_id, starts_on, venue, approval_requested_at, approved_at, archived_at, orgs(name)').eq('id', eventId).maybeSingle(),
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

  // Deletes are refused by RLS unless the rows are drafts, so a scored contest can never be lost here.
  const remove = async (table: 'contests', id: string) => {
    const { error, count } = await supabase.from(table).delete({ count: 'exact' }).eq('id', id)
    if (error || !count) setError(error ? friendly(error) : "That can't be deleted: only producers can delete, and only drafts."); else load()
  }

  if (!event) return error ? <p role="alert" className="text-danger">{error}</p> : <p className="text-muted">Loading…</p>

  return (
    <div className="grid gap-10">
      <div className="grid gap-1">
        <Link to={`/o/${event.org_id}`} className="text-sm text-accent">← {event.orgs?.name}</Link>
        <h1 className={h1}>{event.name}</h1>
        <p className="text-muted">{[event.starts_on, event.venue].filter(Boolean).join(' · ')}</p>
      </div>

      <Approval event={event} onRequest={async () => {
        const { error } = await supabase.rpc('request_event_approval', { p_event: eventId })
        if (error) setError(friendly(error)); else load()
      }} onDate={async date => {
        const { error } = await supabase.from('events').update({ starts_on: date || null }).eq('id', eventId)
        if (error) setError(friendly(error)); else load()
      }} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {event.archived_at && <p className="text-sm text-muted">This event is archived: it's hidden from the organization's list.</p>}

      <section className="grid gap-3">
        <h2 className={h2}>Contests</h2>
        {contests.length === 0 ? (
          <p className="text-muted">No contests yet. Add one for each title awarded at this event.</p>
        ) : (
          <ul className="grid gap-2">
            {contests.map(c => (
              <li key={c.id} className="flex items-stretch gap-2">
                <Link to={`/c/${c.id}/setup`} className={`${card} flex flex-1 justify-between gap-2 px-4 py-3 hover:border-accent`}>
                  <span className="font-medium">{c.name}</span>
                  <span className="font-mono text-sm text-muted">{c.status}</span>
                </Link>
                {c.status === 'draft' && <button type="button" className={iconButton} aria-label={`Delete ${c.name}`}
                  onClick={() => window.confirm(`Delete the draft contest ${c.name}? Its setup, contestants and judges are deleted too.`) && remove('contests', c.id)}>✕</button>}
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
      <section className="flex flex-wrap gap-2 border-t border-rule pt-4">
        <button type="button" className={buttonQuiet} onClick={async () => {
          const { error } = await supabase.from('events').update({ archived_at: event.archived_at ? null : new Date().toISOString() }).eq('id', eventId)
          if (error) setError(friendly(error)); else load()
        }}>{event.archived_at ? 'Unarchive event' : 'Archive event'}</button>
        {contests.every(c => c.status === 'draft') && (
          <button type="button" className={buttonQuiet} onClick={async () => {
            if (!window.confirm(`Delete ${event.name}${contests.length ? ` and its ${contests.length} draft contest${contests.length === 1 ? '' : 's'}` : ''}? This can't be undone.`)) return
            const { error } = await supabase.from('events').delete().eq('id', eventId)
            if (error) setError(friendly(error)); else navigate(`/o/${event.org_id}`)
          }}>Delete event</button>
        )}
      </section>
    </div>
  )
}

// Approval covers one date: contests can start scoring from 14 days before the event to 14 days after
// (enforced by set_contest_status, supabase/migrations/20260930001200_approval_window.sql).
const WINDOW_DAYS = 14
const shift = (iso: string, days: number) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + days); return d }
const long = (d: Date) => d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })

function Approval({ event, onRequest, onDate }: { event: Event; onRequest: () => void; onDate: (date: string) => void }) {
  if (event.approved_at) {
    const anchor = event.starts_on ?? event.approved_at.slice(0, 10)
    const opens = shift(anchor, -WINDOW_DAYS), closes = shift(anchor, WINDOW_DAYS)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    if (today > closes) return (
      <div role="status" className={`${card} border-danger px-4 py-3`}>
        <strong>This event's approval ended on {long(closes)}.</strong> Contests already scored stay here, but new ones can't
        start scoring. Create a new event for your next contest.
      </div>
    )
    return <p className="text-sm text-muted">✓ Approved. Contests can start scoring from {long(opens)} to {long(closes)}.</p>
  }
  return (
    <div role="status" className={`${card} grid gap-3 border-accent px-4 py-3`}>
      <p><strong>This event isn't approved yet.</strong> Set up contests now; scoring opens once the $100 event fee is paid and
        the event is approved. Approval covers contests that start scoring within two weeks of the event date.{' '}
        <Link to="/pricing" className="text-accent underline">Pricing</Link></p>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Event date</span>
        <input type="date" className={`${input} max-w-48`} defaultValue={event.starts_on ?? ''} key={event.starts_on}
          onBlur={e => e.target.value !== (event.starts_on ?? '') && onDate(e.target.value)} />
      </label>
      {event.approval_requested_at
        ? <p className="text-sm text-muted">Approval requested {new Date(event.approval_requested_at).toLocaleDateString()}. We'll email you how to pay the fee.</p>
        : <button className={`${button} justify-self-start`} disabled={!event.starts_on} onClick={onRequest}>
            {event.starts_on ? 'Request approval' : 'Add the event date to request approval'}</button>}
    </div>
  )
}
