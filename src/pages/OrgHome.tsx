import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { friendly } from '../lib/errors'
import { copyInvite, sendSignInLink } from '../lib/invites'
import { button, buttonQuiet, card, h1, h2, iconButton, input, label } from '../components/ui'

type Member = { user_id: string; role: string; profiles: { display_name: string | null } | null }
type Event = { id: string; name: string; starts_on: string | null; venue: string | null; archived_at: string | null }
type Invite = { email: string; role: string }
type Template = { id: string; name: string; description: string | null; visibility: string }

export function OrgHome() {
  const { orgId = '' } = useParams()
  const navigate = useNavigate()
  const [name, setName] = useState<string | null>(null)
  const [isProducer, setIsProducer] = useState(false)
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [invite, setInvite] = useState({ email: '', role: 'tabulator' })
  const [notice, setNotice] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [me, setMe] = useState('')
  const [events, setEvents] = useState<Event[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [form, setForm] = useState({ name: '', starts_on: '', venue: '' })
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [org, mem, ev, me, tp, inv] = await Promise.all([
      supabase.from('orgs').select('name').eq('id', orgId).maybeSingle(),
      supabase.from('org_members').select('user_id, role, profiles(display_name)').eq('org_id', orgId),
      supabase.from('events').select('id, name, starts_on, venue, archived_at').eq('org_id', orgId).order('starts_on', { ascending: false, nullsFirst: true }),
      supabase.auth.getUser(),
      supabase.from('templates').select('id, name, description, visibility').eq('org_id', orgId).order('name'),
      supabase.from('org_invites').select('email, role').eq('org_id', orgId).order('created_at'), // producers only; others get none
    ])
    const failed = org.error ?? mem.error ?? ev.error
    if (failed) return setError(friendly(failed))
    if (!org.data) return setError("This organization doesn't exist, or you're not a member.")
    setName(org.data.name)
    setMembers(mem.data ?? [])
    setEvents(ev.data ?? [])
    setTemplates(tp.data ?? [])
    setInvites(inv.data ?? [])
    setMe(me.data.user?.id ?? '')
    setIsProducer((mem.data ?? []).some(m => m.user_id === me.data.user?.id && m.role === 'producer'))
  }, [orgId])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; setState runs after the awaits
  useEffect(() => { load() }, [load])

  const act = async (p: PromiseLike<{ error: { code?: string; message: string } | null }>) => {
    const { error } = await p
    if (error) setError(friendly(error)); else { setError(''); load() }
  }
  async function inviteMember(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('org_invites').insert({ org_id: orgId, email: invite.email.trim(), role: invite.role })
    if (error) return setError(error.code === '23505' ? 'That email is already invited.' : friendly(error))
    setNotice(`${invite.email.trim()} is invited as a ${invite.role}. They join when they sign in with that email.`)
    setInvite({ email: '', role: 'tabulator' })
    load()
  }

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
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className={h1}>{name}</h1>
        <Link to={`/org/${orgId}`} className="text-sm text-accent">Public results page →</Link>
      </div>

      <section className="grid gap-3">
        <h2 className={h2}>Events</h2>
        {events.length === 0 ? (
          <p className="text-muted">No events yet.{isProducer && ' Create your first one below.'}</p>
        ) : (
          <ul className="grid gap-2">
            {events.filter(ev => showArchived || !ev.archived_at).map(ev => (
              <li key={ev.id}>
                <Link to={`/e/${ev.id}`} className={`${card} flex flex-wrap justify-between gap-2 px-4 py-3 hover:border-accent`}>
                  <span className="font-medium">{ev.name}{ev.archived_at && <span className="text-sm font-normal text-muted"> · archived</span>}</span>
                  <span className="text-sm text-muted">{[ev.starts_on, ev.venue].filter(Boolean).join(' · ')}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {events.some(ev => ev.archived_at) && (
          <button type="button" className="justify-self-start text-sm text-accent underline" onClick={() => setShowArchived(v => !v)}>
            {showArchived ? 'Hide archived events' : `Show archived events (${events.filter(ev => ev.archived_at).length})`}
          </button>
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
        <p className="max-w-prose text-sm text-muted">
          Producers run everything. Tabulators enter scores, submit sheets for judges and see standings, but can't change a
          contest's setup, unlock a submitted sheet or finalize. Judges are added per contest on its People tab.
        </p>
        <ul className={`${card} divide-y divide-rule`}>
          {members.map(m => (
            <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              <span>{m.profiles?.display_name ?? 'Unnamed'}{m.user_id === me && <span className="text-sm text-muted"> (you)</span>}</span>
              {isProducer ? (
                <span className="flex items-center gap-2">
                  <select aria-label={`${m.profiles?.display_name ?? 'Member'} role`} value={m.role} className={`${input} w-auto py-1 text-sm`}
                    onChange={e => act(supabase.from('org_members').update({ role: e.target.value }).eq('org_id', orgId).eq('user_id', m.user_id))}>
                    <option value="producer">producer</option>
                    <option value="tabulator">tabulator</option>
                  </select>
                  <button type="button" className={iconButton} aria-label={`Remove ${m.profiles?.display_name ?? 'member'}`}
                    onClick={() => window.confirm(`Remove ${m.profiles?.display_name ?? 'this member'} from ${name}?`) &&
                      act(supabase.from('org_members').delete().eq('org_id', orgId).eq('user_id', m.user_id))}>✕</button>
                </span>
              ) : <span className="font-mono text-sm text-muted">{m.role}</span>}
            </li>
          ))}
          {invites.map(i => (
            <li key={i.email} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              <span>{i.email} <span className="text-sm text-muted">· invited as {i.role}, not signed in yet</span></span>
              <span className="flex flex-wrap items-center gap-2">
                <button type="button" className={buttonQuiet} onClick={async () => setNotice(await sendSignInLink(i.email))}>Email a sign-in link</button>
                <button type="button" className={buttonQuiet} onClick={async () => setNotice(await copyInvite(i.email, `help run ${name}'s contests`))}>Copy invite</button>
                <button type="button" className={iconButton} aria-label={`Cancel the invite for ${i.email}`}
                  onClick={() => act(supabase.from('org_invites').delete().eq('org_id', orgId).eq('email', i.email))}>✕</button>
              </span>
            </li>
          ))}
        </ul>
        {isProducer && (
          <form onSubmit={inviteMember} className="grid gap-2 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
            <div className="grid gap-1"><label htmlFor="inv-email" className={label}>Invite by email</label>
              <input id="inv-email" type="email" required className={input} value={invite.email} onChange={e => setInvite({ ...invite, email: e.target.value })} /></div>
            <div className="grid gap-1"><label htmlFor="inv-role" className={label}>Role</label>
              <select id="inv-role" className={input} value={invite.role} onChange={e => setInvite({ ...invite, role: e.target.value })}>
                <option value="tabulator">Tabulator</option>
                <option value="producer">Producer</option>
              </select></div>
            <button className={button}>Invite</button>
          </form>
        )}
        {notice && <p role="status" className="text-sm">{notice}</p>}
      </section>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  )
}
