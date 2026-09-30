import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { friendly } from '../lib/errors'
import { useWrites } from '../lib/useWrites'
import { copyInvite, sendSignInLink } from '../lib/invites'
import { parseContestants, parseJudges } from '../lib/bulk'
import { ContestHeader } from '../components/ContestHeader'
import { button, buttonQuiet, card, h2, iconButton, input, label } from '../components/ui'

type Contest = { id: string; name: string; status: string; org_id: string; event_id: string; events: { name: string } | null }
type Contestant = {
  id: string; display_name: string; number: number | null; represents: string | null; sort: number; withdrawn: boolean
  contestant_contacts: { email: string } | null
}
type Judge = { id: string; name: string; email: string | null; user_id: string | null; sort: number; guest: boolean }
type Recusal = { judge_id: string; contestant_id: string }

const blankContestant = { display_name: '', number: '', represents: '', email: '' }
const blankJudge = { name: '', email: '', guest: false }

export function ContestPeople() {
  const { contestId = '' } = useParams()
  const [contest, setContest] = useState<Contest | null>(null)
  const [contestants, setContestants] = useState<Contestant[]>([])
  const [judges, setJudges] = useState<Judge[]>([])
  const [recusals, setRecusals] = useState<Recusal[]>([])
  const [isProducer, setIsProducer] = useState(false)
  const [newContestant, setNewContestant] = useState(blankContestant)
  const [newJudge, setNewJudge] = useState(blankJudge)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    const [c, cs, js, rs, me] = await Promise.all([
      supabase.from('contests').select('id, name, status, org_id, event_id, events(name)').eq('id', contestId).maybeSingle(),
      supabase.from('contestants')
        .select('id, display_name, number, represents, sort, withdrawn, contestant_contacts(email)')
        .eq('contest_id', contestId).order('sort').order('created_at'),
      supabase.from('judges').select('id, name, email, user_id, sort, guest').eq('contest_id', contestId).order('sort').order('created_at'),
      supabase.from('recusals').select('judge_id, contestant_id, judges!inner(contest_id)').eq('judges.contest_id', contestId),
      supabase.auth.getUser(),
    ])
    const failed = c.error ?? cs.error ?? js.error ?? rs.error
    if (failed) return setError(friendly(failed))
    if (!c.data) return setError("This contest doesn't exist, or you're not a member of its organization.")
    const role = await supabase.from('org_members').select('role')
      .eq('org_id', c.data.org_id).eq('user_id', me.data.user?.id ?? '').maybeSingle()
    setContest(c.data)
    setContestants(cs.data ?? [])
    setJudges(js.data ?? [])
    setRecusals(rs.data ?? [])
    setIsProducer(role.data?.role === 'producer')
  }, [contestId])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; setState runs after the awaits
  useEffect(() => { load() }, [load])

  const { busy, run, saveField } = useWrites(load, setError)

  if (!contest) return error ? <p role="alert" className="text-danger">{error}</p> : <p className="text-muted">Loading…</p>

  const draft = contest.status === 'draft'
  const recused = new Set(recusals.map(r => `${r.judge_id}|${r.contestant_id}`))
  const nextSort = (list: { sort: number }[]) => Math.max(0, ...list.map(x => x.sort)) + 1

  async function addContestant(e: FormEvent) {
    e.preventDefault()
    const { data, error } = await supabase.from('contestants').insert({
      contest_id: contestId,
      display_name: newContestant.display_name.trim(),
      number: newContestant.number ? Number(newContestant.number) : null,
      represents: newContestant.represents.trim() || null,
      sort: nextSort(contestants),
    }).select('id').single()
    if (error) return setError(friendly(error))
    const email = newContestant.email.trim()
    if (email && !(await run(supabase.from('contestant_contacts').insert({ contestant_id: data.id, email })))) return
    setNewContestant(blankContestant)
    await run()
  }

  // Pasted lists. Contestants come back in insert order, so emails are matched by position.
  async function addContestants(text: string) {
    const list = parseContestants(text)
    const { data, error } = await supabase.from('contestants').insert(list.map((c, i) => ({
      contest_id: contestId, display_name: c.display_name, number: c.number, represents: c.represents, sort: nextSort(contestants) + i,
    }))).select('id')
    if (error) { setError(friendly(error)); return false }
    const contacts = list.flatMap((c, i) => (c.email && data[i] ? [{ contestant_id: data[i].id, email: c.email }] : []))
    return contacts.length ? run(supabase.from('contestant_contacts').insert(contacts)) : run()
  }
  const addJudges = (text: string) => run(supabase.from('judges').insert(parseJudges(text).map((j, i) => ({
    contest_id: contestId, name: j.name, email: j.email, sort: nextSort(judges) + i, guest: false,
  }))))

  async function addJudge(e: FormEvent) {
    e.preventDefault()
    const ok = await run(supabase.from('judges').insert({
      contest_id: contestId, name: newJudge.name.trim(), email: newJudge.email.trim() || null, sort: nextSort(judges), guest: newJudge.guest,
    }))
    if (ok) setNewJudge(blankJudge)
  }

  const setEmail = (c: Contestant, email: string) => run(email
    ? supabase.from('contestant_contacts').upsert({ contestant_id: c.id, email })
    : supabase.from('contestant_contacts').delete().eq('contestant_id', c.id))

  const reorder = (i: number, j: number) => {
    const order = [...contestants]
    ;[order[i], order[j]] = [order[j]!, order[i]!]
    return run(...order.map((c, idx) => supabase.from('contestants').update({ sort: idx + 1 }).eq('id', c.id)))
  }

  const toggleRecusal = (judgeId: string, contestantId: string) => run(recused.has(`${judgeId}|${contestantId}`)
    ? supabase.from('recusals').delete().eq('judge_id', judgeId).eq('contestant_id', contestantId)
    : supabase.from('recusals').insert({ judge_id: judgeId, contestant_id: contestantId }))

  const text = (value: string | null, save: (v: string | null) => Promise<boolean>, props: { 'aria-label': string; type?: string; className?: string }) => (
    <input {...props} key={value ?? ''} defaultValue={value ?? ''} disabled={!isProducer} className={`${input} ${props.className ?? ''}`}
      onBlur={e => { const v = e.target.value.trim() || null; if (v !== value) saveField(e.target, value, () => save(v)) }} />
  )

  return (
    <div className="grid gap-10">
      <ContestHeader contest={contest} />
      {error && <p role="alert" className="rounded border border-danger px-4 py-3 text-danger">{error}</p>}
      {notice && <p role="status" className="rounded border border-accent px-4 py-3">{notice}</p>}

      <fieldset disabled={busy} className="grid gap-10">
        {/* ── Contestants ── */}
        <section className="grid gap-3">
          <h2 className={h2}>Contestants · {contestants.filter(c => !c.withdrawn).length}</h2>
          <p className="text-sm text-muted">Listed in stage order. Emails are only visible to producers and are used for sending feedback.</p>
          {contestants.length > 0 && (
            <div className={`${card} overflow-x-auto`}>
              <table className="w-full text-sm">
                <thead className="text-left text-muted">
                  <tr className="border-b border-rule">
                    <th className="w-20 px-3 py-2 font-normal">#</th><th className="px-2 font-normal">Name</th>
                    <th className="px-2 font-normal">Representing</th>{isProducer && <th className="px-2 font-normal">Email</th>}
                    <th className="px-2 font-normal">Withdrawn</th><th className="w-28" />
                  </tr>
                </thead>
                <tbody>
                  {contestants.map((c, i) => (
                    <tr key={c.id} className={`border-b border-rule last:border-0 ${c.withdrawn ? 'opacity-50' : ''}`}>
                      <td className="px-3 py-1.5">
                        {text(c.number == null ? null : String(c.number),
                          v => run(supabase.from('contestants').update({ number: v == null ? null : Number(v) }).eq('id', c.id)),
                          { 'aria-label': `${c.display_name} number`, type: 'number', className: 'font-mono' })}
                      </td>
                      <td className="px-2">
                        {text(c.display_name, v => run(supabase.from('contestants').update({ display_name: v ?? c.display_name }).eq('id', c.id)),
                          { 'aria-label': `${c.display_name} name` })}
                      </td>
                      <td className="px-2">
                        {text(c.represents, v => run(supabase.from('contestants').update({ represents: v }).eq('id', c.id)),
                          { 'aria-label': `${c.display_name} representing` })}
                      </td>
                      {isProducer && (
                        <td className="px-2">
                          {text(c.contestant_contacts?.email ?? null, v => setEmail(c, v ?? ''), { 'aria-label': `${c.display_name} email`, type: 'email' })}
                        </td>
                      )}
                      <td className="px-2">
                        <input type="checkbox" aria-label={`${c.display_name} withdrawn`} checked={c.withdrawn} disabled={!isProducer}
                          onChange={e => run(supabase.from('contestants').update({ withdrawn: e.target.checked }).eq('id', c.id))} />
                      </td>
                      <td className="whitespace-nowrap px-2 text-right">
                        {isProducer && <>
                          <button type="button" className={iconButton} aria-label={`Move ${c.display_name} earlier`} disabled={i === 0} onClick={() => reorder(i, i - 1)}>↑</button>{' '}
                          <button type="button" className={iconButton} aria-label={`Move ${c.display_name} later`} disabled={i === contestants.length - 1} onClick={() => reorder(i, i + 1)}>↓</button>{' '}
                          {draft && <button type="button" className={iconButton} aria-label={`Delete ${c.display_name}`}
                            onClick={() => window.confirm(`Delete ${c.display_name}?`) && run(supabase.from('contestants').delete().eq('id', c.id))}>✕</button>}
                        </>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!draft && isProducer && <p className="text-xs text-muted">Scoring has started, so contestants can be withdrawn but not deleted.</p>}
          {isProducer && (
            <form onSubmit={addContestant} className="grid gap-2 sm:grid-cols-[5rem_2fr_2fr_2fr_auto] sm:items-end">
              <div className="grid gap-1"><label htmlFor="nc-number" className={label}>#</label>
                <input id="nc-number" type="number" min={1} className={`${input} font-mono`} value={newContestant.number}
                  onChange={e => setNewContestant({ ...newContestant, number: e.target.value })} /></div>
              <div className="grid gap-1"><label htmlFor="nc-name" className={label}>Name</label>
                <input id="nc-name" required maxLength={120} className={input} value={newContestant.display_name}
                  onChange={e => setNewContestant({ ...newContestant, display_name: e.target.value })} /></div>
              <div className="grid gap-1"><label htmlFor="nc-rep" className={label}>Representing</label>
                <input id="nc-rep" maxLength={200} placeholder="Mr Chicago Leather 2026" className={input} value={newContestant.represents}
                  onChange={e => setNewContestant({ ...newContestant, represents: e.target.value })} /></div>
              <div className="grid gap-1"><label htmlFor="nc-email" className={label}>Email (optional)</label>
                <input id="nc-email" type="email" className={input} value={newContestant.email}
                  onChange={e => setNewContestant({ ...newContestant, email: e.target.value })} /></div>
              <button className={button}>Add contestant</button>
            </form>
          )}
          {isProducer && draft && <Paste what="contestants" hint={'One per line, from a spreadsheet or typed:\n1, Rex Harlan, Mr. Pacific Leather, rex@example.com\n2, Marcus Vale'}
            count={t => parseContestants(t).length} onAdd={addContestants} />}
        </section>

        {/* ── Judges ── */}
        <section className="grid gap-3">
          <h2 className={h2}>Judges · {judges.length}</h2>
          <p className="text-sm text-muted">
            Give a judge an email and they can score on their phone: send them a sign-in link, or copy an invite to text them.
            When they sign in with that email they see only their own sheets. Judges without an email are scored from paper.
          </p>
          {judges.length > 0 && (
            <ul className={`${card} divide-y divide-rule`}>
              {judges.map(j => (
                <li key={j.id} className="grid items-center gap-2 px-3 py-2 sm:grid-cols-[2fr_2fr_auto_auto_auto]">
                  {text(j.name, v => run(supabase.from('judges').update({ name: v ?? j.name }).eq('id', j.id)), { 'aria-label': `${j.name} name` })}
                  {text(j.email, v => run(supabase.from('judges').update({ email: v }).eq('id', j.id)), { 'aria-label': `${j.name} email`, type: 'email' })}
                  <label className="flex items-center gap-1 text-xs text-muted" title="Scores only cross-panel categories; the cross-panel judges' average counts as one more judge">
                    <input type="checkbox" checked={j.guest} disabled={!isProducer}
                      onChange={e => run(supabase.from('judges').update({ guest: e.target.checked }).eq('id', j.id))} /> cross-panel
                  </label>
                  <span className="font-mono text-xs text-muted">{j.user_id ? '✓ signed in' : j.email ? 'not signed in yet' : 'paper only'}</span>
                  <span>{isProducer && draft && <button type="button" className={iconButton} aria-label={`Delete ${j.name}`}
                    onClick={() => window.confirm(`Delete judge ${j.name}?`) && run(supabase.from('judges').delete().eq('id', j.id))}>✕</button>}</span>
                  {!j.user_id && (
                    <Link to={`/c/${contestId}/sheets?judge=${j.id}`} className="text-xs text-accent underline sm:col-span-5">Print paper scoresheets for {j.name}</Link>
                  )}
                  {isProducer && j.email && !j.user_id && (
                    <span className="flex flex-wrap gap-2 sm:col-span-5">
                      <button type="button" className={buttonQuiet} onClick={async () => setNotice(await sendSignInLink(j.email!))}>Email a sign-in link</button>
                      <button type="button" className={buttonQuiet} onClick={async () => setNotice(await copyInvite(j.email!, `judge ${contest?.name ?? 'a contest'} (open it under Judging to score on your phone)`))}>Copy invite</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {isProducer && (
            <form onSubmit={addJudge} className="grid gap-2 sm:grid-cols-[2fr_2fr_auto_auto] sm:items-end">
              <div className="grid gap-1"><label htmlFor="nj-name" className={label}>Judge name</label>
                <input id="nj-name" required maxLength={120} className={input} value={newJudge.name}
                  onChange={e => setNewJudge({ ...newJudge, name: e.target.value })} /></div>
              <div className="grid gap-1"><label htmlFor="nj-email" className={label}>Email (to score on their phone)</label>
                <input id="nj-email" type="email" className={input} value={newJudge.email}
                  onChange={e => setNewJudge({ ...newJudge, email: e.target.value })} /></div>
              <label className="flex items-center gap-1 self-center text-sm">
                <input type="checkbox" checked={newJudge.guest} onChange={e => setNewJudge({ ...newJudge, guest: e.target.checked })} /> Cross-panel judge
              </label>
              <button className={button}>Add judge</button>
            </form>
          )}
          {isProducer && <Paste what="judges" hint={'One per line: name, email\nJudge Ana, ana@example.com\nJudge Bo'}
            count={t => parseJudges(t).length} onAdd={addJudges} />}
        </section>

        {/* ── Recusals ── */}
        <section className="grid gap-3">
          <h2 className={h2}>Recusals</h2>
          <p className="max-w-prose text-sm text-muted">
            Tick a box when a judge won't score a contestant (a partner, a business tie). Their slot is filled with the
            average of the other judges' scores for that contestant (a cross-panel judge's, from the other cross-panel judges).
          </p>
          {judges.length === 0 || contestants.length === 0 ? (
            <p className="text-sm text-muted">Add contestants and judges first.</p>
          ) : (
            <div className={`${card} overflow-x-auto`}>
              <table className="text-sm">
                <thead>
                  <tr className="border-b border-rule">
                    <th className="px-3 py-2 text-left font-normal text-muted">Contestant</th>
                    {judges.map(j => <th key={j.id} className="px-3 py-2 font-medium">{j.name}{j.guest && <span className="text-xs font-normal text-muted"> (cross-panel)</span>}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {contestants.filter(c => !c.withdrawn).map(c => (
                    <tr key={c.id} className="border-b border-rule last:border-0">
                      <th scope="row" className="px-3 py-1.5 text-left font-normal">{c.number != null && <span className="font-mono text-muted">{c.number} </span>}{c.display_name}</th>
                      {judges.map(j => (
                        <td key={j.id} className="px-3 text-center">
                          <input type="checkbox" aria-label={`${j.name} recused from ${c.display_name}`}
                            checked={recused.has(`${j.id}|${c.id}`)} onChange={() => toggleRecusal(j.id, c.id)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </fieldset>
    </div>
  )
}

function Paste({ what, hint, count, onAdd }: { what: string; hint: string; count: (text: string) => number; onAdd: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState('')
  const n = count(text)
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-accent">Paste a list of {what}</summary>
      <div className="mt-2 grid gap-2">
        <textarea aria-label={`Paste ${what}`} rows={5} placeholder={hint} className={`${input} font-mono text-sm`} value={text} onChange={e => setText(e.target.value)} />
        <button type="button" className={`${button} justify-self-start`} disabled={!n}
          onClick={async () => { if (await onAdd(text)) setText('') }}>Add {n} {what}</button>
      </div>
    </details>
  )
}
