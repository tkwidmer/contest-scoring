import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { friendly } from '../lib/errors'
import { cellKey, createSaveQueue, type QueueState } from '../lib/saveQueue'
import { fmt, problem, sendCell, type ScoreComponent } from '../lib/scoreCells'
import { button, card, h1 } from '../components/ui'
import type { TablesInsert } from '../lib/database.types'

// A judge scoring their own sheets on a phone (design doc 04, section 5). RLS shows them only their own scores,
// so nothing here can reveal another judge's numbers. A sheet is one contestant x one category; submitting locks it
// (with its comment). Comments go to the producer, who reviews them before contestants see them.
type Category = { id: string; name: string; round: string; scored_by: string; guest_average: boolean; components: (ScoreComponent & { description: string | null })[] }
type Contestant = { id: string; display_name: string; number: number | null; withdrawn: boolean; finalist: boolean }
type Contest = { id: string; name: string; status: string; finalist_count: number | null; events: { name: string } | null }
type Me = { id: string; name: string; guest: boolean }
type Submission = { contestant_id: string; category_id: string; unlocked_at: string | null; unlock_reason: string | null }

const label = (c: Contestant) => `${c.number != null ? `${c.number} · ` : ''}${c.display_name}`

export function JudgeSheet() {
  const { contestId = '' } = useParams()
  const [contest, setContest] = useState<Contest | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [contestants, setContestants] = useState<Contestant[]>([])
  const [recused, setRecused] = useState<Set<string>>(new Set())
  const [values, setValues] = useState<Map<string, number | null>>(new Map())
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [comments, setComments] = useState<Map<string, string>>(new Map()) // contestant|category ('' = overall) -> text
  const [current, setCurrent] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState<QueueState>({ pending: 0, failing: new Map(), offline: false })
  const queue = useMemo(() => createSaveQueue({ storageKey: `judge:${contestId}`, send: sendCell }), [contestId])

  const load = useCallback(async () => {
    const uid = (await supabase.auth.getUser()).data.user?.id ?? ''
    const [c, j] = await Promise.all([
      supabase.from('contests').select('id, name, status, finalist_count, events(name)').eq('id', contestId).maybeSingle(),
      supabase.from('judges').select('id, name, guest').eq('contest_id', contestId).eq('user_id', uid).maybeSingle(),
    ])
    if (c.error ?? j.error) return setError(friendly((c.error ?? j.error)!))
    if (!c.data || !j.data) return setError("You're not a judge for this contest. Sign in with the email the producer invited.")
    const judge = j.data
    const [cats, cs, rs, sc, sub, cm] = await Promise.all([
      supabase.from('categories').select('id, name, round, scored_by, guest_average, components(id, name, description, min_points, max_points, step)')
        .eq('contest_id', contestId).order('sort').order('sort', { referencedTable: 'components' }),
      supabase.from('contestants').select('id, display_name, number, withdrawn, finalist').eq('contest_id', contestId).order('sort'),
      supabase.from('recusals').select('contestant_id').eq('judge_id', judge.id),
      supabase.from('scores').select('contestant_id, component_id, value').eq('judge_id', judge.id),
      supabase.from('sheet_submissions').select('contestant_id, category_id, unlocked_at, unlock_reason').eq('judge_id', judge.id),
      supabase.from('comments').select('contestant_id, category_id, body').eq('judge_id', judge.id),
    ])
    const failed = cats.error ?? cs.error ?? rs.error ?? sc.error ?? sub.error ?? cm.error
    if (failed) return setError(friendly(failed))
    setContest(c.data)
    setMe(judge)
    setCategories(cats.data ?? [])
    setContestants((cs.data ?? []).filter(x => !x.withdrawn))
    setRecused(new Set((rs.data ?? []).map(r => r.contestant_id)))
    const server = new Map((sc.data ?? []).map(s => [cellKey({ judge_id: judge.id, contestant_id: s.contestant_id, component_id: s.component_id }), s.value as number | null]))
    for (const [k, v] of queue.pendingValues()) server.set(k, v) // unsaved edits win over older server values
    setValues(server)
    setSubmissions(sub.data ?? [])
    setComments(new Map((cm.data ?? []).map(x => [`${x.contestant_id}|${x.category_id ?? ''}`, x.body])))
  }, [contestId, queue])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; setState runs after the awaits
  useEffect(() => { load() }, [load])
  // Same resilience as the producer's score entry: retry as soon as the phone is back online, warn before closing
  // with unsaved scores, and send anything left over from the last visit.
  useEffect(() => {
    const unsubscribe = queue.subscribe(setSaving)
    const retry = () => queue.flush()
    const warn = (e: BeforeUnloadEvent) => { if (queue.pendingValues().size) e.preventDefault() }
    window.addEventListener('online', retry)
    window.addEventListener('beforeunload', warn)
    queue.flush()
    return () => { unsubscribe(); queue.dispose(); window.removeEventListener('online', retry); window.removeEventListener('beforeunload', warn) }
  }, [queue])

  if (!contest || !me) return error ? <p role="alert" className="text-danger">{error}</p> : <p className="text-muted">Loading…</p>

  // The categories this judge scores: panel judges the panel's; cross-panel judges their own and any averaged-in ones.
  const mine = categories.filter(c => me.guest ? c.scored_by === 'cross_panel' || (c.scored_by === 'judges' && c.guest_average) : c.scored_by === 'judges')
  const scoresIn = (cat: Category, who: Contestant) => !recused.has(who.id) && (!contest.finalist_count || cat.round === 'prelim' || who.finalist)
  const people = contestants.filter(p => mine.some(c => scoresIn(c, p)))
  const sub = (cid: string, cat: string) => submissions.find(s => s.contestant_id === cid && s.category_id === cat)
  const locked = (cid: string, cat: string) => { const s = sub(cid, cat); return !!s && !s.unlocked_at }
  const filled = (cid: string, cat: Category) => cat.components.every(k => values.get(cellKey({ judge_id: me.id, contestant_id: cid, component_id: k.id })) != null)
  const selected = people.find(p => p.id === current) ?? people[0]
  const idx = selected ? people.indexOf(selected) : -1
  const open = contest.status === 'scoring'

  // Comments for the contestant, saved when the box loses focus. The producer reviews them before they're shared.
  const saveComment = async (who: Contestant, catId: string | null, text: string) => {
    const key = `${who.id}|${catId ?? ''}`
    if (text.trim() === (comments.get(key) ?? '')) return
    const match = { judge_id: me.id, contestant_id: who.id, category_id: catId }
    const { error } = text.trim() === ''
      ? await (catId ? supabase.from('comments').delete().match(match) : supabase.from('comments').delete().match({ judge_id: me.id, contestant_id: who.id }).is('category_id', null))
      : await supabase.from('comments').upsert({ ...match, body: text.trim() } as TablesInsert<'comments'>, { onConflict: 'judge_id,contestant_id,category_id' })
    if (error) return setError(friendly(error))
    setError('')
    setComments(m => new Map(m).set(key, text.trim()))
  }
  const commentBox = (who: Contestant, catId: string | null, label: string, disabled: boolean) => (
    <label className="grid gap-1">
      <span className="text-sm text-muted">{label}</span>
      <textarea rows={3} maxLength={4000} disabled={disabled} key={`${who.id}|${catId}|${comments.get(`${who.id}|${catId ?? ''}`) ?? ''}`}
        defaultValue={comments.get(`${who.id}|${catId ?? ''}`) ?? ''} onBlur={e => saveComment(who, catId, e.target.value)}
        className="rounded border border-rule bg-surface px-3 py-2 focus:border-accent focus:outline-none disabled:opacity-60" />
    </label>
  )

  const submitAll = async (who: Contestant, cats: Category[]) => {
    if (!window.confirm(`Submit your ${cats.map(c => c.name).join(', ')} scores for ${who.display_name}? You can't change them afterwards.`)) return
    await queue.flush()
    for (const cat of cats) {
      const { error } = await supabase.rpc('submit_sheet', { p_judge: me.id, p_contestant: who.id, p_category: cat.id })
      if (error) { setError(friendly(error)); break }
    }
    load()
  }

  const submit = async (who: Contestant, cat: Category) => {
    if (!window.confirm(`Submit your ${cat.name} scores for ${who.display_name}? You can't change them afterwards.`)) return
    await queue.flush()
    const { error } = await supabase.rpc('submit_sheet', { p_judge: me.id, p_contestant: who.id, p_category: cat.id })
    if (error) setError(friendly(error)); else { setError(''); load() }
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <p className="text-sm text-muted">{contest.events?.name}</p>
        <h1 className={h1}>{contest.name}</h1>
        <p className="text-sm text-muted">Judging as <strong className="text-fg">{me.name}</strong>. Only you and the tally team see your scores.</p>
      </div>

      {!open && (
        <p className={`${card} px-4 py-3`}>
          {contest.status === 'draft' ? 'Scoring hasn’t opened yet. Check back when the producer starts the contest.' : 'Scoring is closed for this contest.'}
        </p>
      )}
      {error && <p role="alert" className="text-danger">{error}</p>}

      {people.length === 0 ? <p className="text-muted">No sheets for you in this contest.</p> : (
        <>
          <nav aria-label="Contestants" className="flex gap-2 overflow-x-auto pb-1">
            {people.map(p => {
              const done = mine.filter(c => scoresIn(c, p)).every(c => locked(p.id, c.id))
              return (
                <button key={p.id} onClick={() => setCurrent(p.id)}
                  className={`min-h-11 shrink-0 rounded border px-3 text-sm ${p === selected ? 'border-accent bg-accent text-on-accent' : 'border-rule bg-surface'}`}>
                  {label(p)}{done && ' ✓'}
                </button>
              )
            })}
          </nav>

          {selected && (
            <section className="grid gap-4" aria-label={`Sheets for ${selected.display_name}`}>
              <h2 className="text-2xl font-semibold">{label(selected)}</h2>
              {mine.filter(c => scoresIn(c, selected)).map(cat => {
                const s = sub(selected.id, cat.id)
                const isLocked = locked(selected.id, cat.id)
                return (
                  <div key={cat.id} className={`${card} grid gap-3 p-4`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-lg font-semibold">{cat.name}</h3>
                      <span className="text-sm text-muted">{isLocked ? '🔒 Submitted' : s?.unlocked_at ? 'Reopened' : filled(selected.id, cat) ? 'Ready to submit' : 'Not finished'}</span>
                    </div>
                    {s?.unlocked_at && <p className="text-sm text-muted">The producer reopened this sheet: {s.unlock_reason}</p>}
                    {cat.components.map(k => {
                      const cell = { judge_id: me.id, contestant_id: selected.id, component_id: k.id }
                      const key = cellKey(cell)
                      const v = values.get(key)
                      const fail = saving.failing.get(key)
                      return (
                        <label key={k.id} className="grid gap-1">
                          <span className="flex justify-between gap-2"><span>{k.name}</span><span className="text-sm text-muted">{fmt(k.min_points)}–{fmt(k.max_points)}</span></span>
                          {k.description && <span className="text-sm text-muted">{k.description}</span>}
                          <input inputMode="decimal" disabled={!open || isLocked} key={`${key}:${v ?? ''}`} defaultValue={v ?? ''}
                            aria-invalid={!!fail || undefined}
                            className="h-12 rounded border border-rule bg-surface px-3 font-mono text-lg focus:border-accent focus:outline-none disabled:opacity-60 aria-invalid:border-danger"
                            onBlur={e => {
                              const raw = e.target.value.trim()
                              const value = raw === '' ? null : Number(raw)
                              if (value === (v ?? null)) return
                              const bad = value == null ? null : problem(value, k)
                              if (bad) { setError(`${k.name}: ${bad}`); e.target.value = v == null ? '' : String(v); return }
                              setError('')
                              setValues(m => new Map(m).set(key, value))
                              queue.set({ ...cell, value })
                            }} />
                          {fail && <span className="text-sm text-danger">{fail}</span>}
                        </label>
                      )
                    })}
                    {commentBox(selected, cat.id, `Comment for ${selected.display_name} on ${cat.name} (optional)`, !open || isLocked)}
                    {open && !isLocked && (
                      <button className={`${button} min-h-11`} disabled={!filled(selected.id, cat)} onClick={() => submit(selected, cat)}>
                        Submit {cat.name}
                      </button>
                    )}
                  </div>
                )
              })}
              <div className={`${card} p-4`}>{commentBox(selected, null, `Overall comment for ${selected.display_name} (optional)`, !open)}</div>
              {(() => {
                // This contestant at a glance: the judge's own total, and every finished sheet submitted in one go.
                const cats = mine.filter(c => scoresIn(c, selected))
                const ks = cats.flatMap(c => c.components)
                const val = (k: ScoreComponent) => values.get(cellKey({ judge_id: me.id, contestant_id: selected.id, component_id: k.id }))
                const ready = cats.filter(c => !locked(selected.id, c.id) && filled(selected.id, c))
                return (
                  <div className={`${card} grid gap-3 p-4`}>
                    <p className="flex justify-between gap-2 text-lg">
                      <span>Your total for {selected.display_name}</span>
                      <span className="font-mono font-semibold">{fmt(ks.reduce((t, k) => t + (val(k) ?? 0), 0))} / {fmt(ks.reduce((t, k) => t + k.max_points, 0))}</span>
                    </p>
                    {open && ready.length > 0 && (
                      <button className={`${button} min-h-11`} onClick={() => submitAll(selected, ready)}>
                        Submit {ready.length === 1 ? ready[0]!.name : `all ${ready.length} finished sheets`}
                      </button>
                    )}
                  </div>
                )
              })()}
              <div className="flex justify-between gap-2">
                <button className="min-h-11 rounded border border-rule px-4 disabled:opacity-40" disabled={idx <= 0} onClick={() => setCurrent(people[idx - 1]!.id)}>← Previous</button>
                <button className="min-h-11 rounded border border-rule px-4 disabled:opacity-40" disabled={idx >= people.length - 1} onClick={() => setCurrent(people[idx + 1]!.id)}>Next →</button>
              </div>
            </section>
          )}
        </>
      )}

      <p className="font-mono text-xs text-muted" role="status">
        {saving.offline ? 'Offline: your scores are kept on this phone and will save when you reconnect.' : saving.pending ? 'Saving…' : 'All saved'}
      </p>
      <Link to="/dashboard" className="text-sm text-accent">← Dashboard</Link>
    </div>
  )
}
