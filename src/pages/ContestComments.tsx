import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { friendly } from '../lib/errors'
import { ContestHeader } from '../components/ContestHeader'
import { button, buttonQuiet, card, h2, input, label } from '../components/ui'
import type { TablesInsert } from '../lib/database.types'
import { fmt } from '../lib/scoreCells'

// Producer review of judges' comments (design doc 04, section 6): keep the original, edit a shared version,
// approve. Only approved comments are printed or exported, with judge names only if the contest allows it.
type Contest = { id: string; name: string; status: string; event_id: string; anonymize_comments: boolean; events: { name: string } | null }
type Comment = { id: string; judge_id: string; contestant_id: string; category_id: string | null; body: string; edited_body: string | null; approved: boolean }
type Named = { id: string; name: string }
type Judge = Named & { user_id: string | null }
// The contestant's own line of the finalized result (packets show nobody else's scores).
type Placing = { contestantId: string; rank: number; total: number; pct: number; categoryTotals: Record<string, number> }

export function ContestComments() {
  const { contestId = '' } = useParams()
  const [contest, setContest] = useState<Contest | null>(null)
  const [categories, setCategories] = useState<Named[]>([])
  const [contestants, setContestants] = useState<Named[]>([])
  const [judges, setJudges] = useState<Judge[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [placings, setPlacings] = useState<Placing[]>([])
  const [add, setAdd] = useState({ judge: '', contestant: '', category: '', body: '' })
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [c, cats, cs, js, cm, fr] = await Promise.all([
      supabase.from('contests').select('id, name, status, event_id, anonymize_comments, events(name)').eq('id', contestId).maybeSingle(),
      supabase.from('categories').select('id, name').eq('contest_id', contestId).order('sort'),
      supabase.from('contestants').select('id, display_name, number').eq('contest_id', contestId).eq('withdrawn', false).order('sort'),
      supabase.from('judges').select('id, name, user_id').eq('contest_id', contestId).order('sort'),
      supabase.from('comments').select('id, judge_id, contestant_id, category_id, body, edited_body, approved').eq('contest_id', contestId).order('created_at'),
      supabase.rpc('contest_final_result', { p_contest: contestId }),
    ])
    const failed = c.error ?? cats.error ?? cs.error ?? js.error ?? cm.error
    if (failed) return setError(friendly(failed))
    if (!c.data) return setError("This contest doesn't exist, or you're not a member of its organization.")
    setContest(c.data)
    setCategories(cats.data ?? [])
    setContestants((cs.data ?? []).map(x => ({ id: x.id, name: x.number != null ? `${x.number} · ${x.display_name}` : x.display_name })))
    setJudges(js.data ?? [])
    setComments(cm.data ?? [])
    setPlacings(((fr.data as { standings?: Placing[] } | null)?.standings) ?? [])
  }, [contestId])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; setState runs after the awaits
  useEffect(() => { load() }, [load])

  if (!contest) return error ? <p role="alert" className="text-danger">{error}</p> : <p className="text-muted">Loading…</p>

  const frozen = contest.status === 'published'
  const nameOf = (list: Named[], id: string | null) => list.find(x => x.id === id)?.name ?? ''
  const where = (c: Comment) => (c.category_id ? nameOf(categories, c.category_id) : 'Overall')
  const shared = (c: Comment) => c.edited_body ?? c.body
  const approved = comments.filter(c => c.approved)
  const order = (list: Comment[]) => [...list].sort((a, b) =>
    (a.category_id ? categories.findIndex(x => x.id === a.category_id) : categories.length) - (b.category_id ? categories.findIndex(x => x.id === b.category_id) : categories.length))
  const act = async (p: PromiseLike<{ error: { code?: string; message: string } | null }>) => {
    const { error } = await p
    if (error) setError(friendly(error)); else { setError(''); load() }
  }
  const review = (c: Comment, text: string, ok: boolean) => {
    const edited = text.trim() === c.body ? null : text.trim()
    setComments(list => list.map(x => x.id === c.id ? { ...x, edited_body: edited, approved: ok } : x)) // show it now; load() confirms
    return act(supabase.rpc('review_comment', { p_comment: c.id, p_edited_body: edited ?? '', p_approved: ok }))
  }

  async function addComment(e: FormEvent) {
    e.preventDefault()
    await act(supabase.from('comments').insert({ judge_id: add.judge, contestant_id: add.contestant, category_id: add.category || null, body: add.body.trim() } as TablesInsert<'comments'>))
    setAdd(a => ({ ...a, body: '' }))
  }

  function downloadCsv() {
    const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
    const rows = [['Contestant', 'Category', ...(contest!.anonymize_comments ? [] : ['Judge']), 'Comment'],
      ...contestants.flatMap(p => order(approved.filter(c => c.contestant_id === p.id)).map(c =>
        [p.name, where(c), ...(contest!.anonymize_comments ? [] : [nameOf(judges, c.judge_id)]), shared(c)]))]
    const url = URL.createObjectURL(new Blob([rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: `${contest!.name} comments.csv` })
    a.click()
    URL.revokeObjectURL(url)
  }

  const paperJudges = judges.filter(j => !j.user_id)
  return (<>
    <div className="grid gap-6 print:hidden">
      <ContestHeader contest={contest} />
      {error && <p role="alert" className="rounded border border-danger px-4 py-3 text-danger">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted">{comments.length} comment{comments.length === 1 ? '' : 's'} · {approved.length} approved</span>
        <span className="flex-1" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!contest.anonymize_comments} disabled={frozen}
            onChange={e => act(supabase.from('contests').update({ anonymize_comments: !e.target.checked }).eq('id', contest.id))} />
          Show judge names to contestants
        </label>
        <button className={buttonQuiet} disabled={!approved.length && !placings.length} onClick={() => window.print()}>Print contestant packets</button>
        <button className={buttonQuiet} disabled={!approved.length} onClick={downloadCsv}>Download CSV</button>
      </div>
      <p className="max-w-prose text-sm text-muted">
        Only approved comments are shared. Each contestant's packet is one page: once results are finalized, it opens with their
        own placing and category scores (never anyone else's), then their approved comments. Edit the shared version to fix typos or soften wording;
        the judge's original is kept. {frozen && 'Results are published, so comments are read-only.'}
      </p>

      {contestants.map(p => {
        const mine = order(comments.filter(c => c.contestant_id === p.id))
        return (
          <section key={p.id} className="grid gap-2">
            <h2 className={h2}>{p.name} · {mine.length}</h2>
            {mine.length === 0 ? <p className="text-sm text-muted">No comments yet.</p> : mine.map(c => (
              <div key={c.id} className={`${card} grid gap-2 p-3`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span><strong>{nameOf(judges, c.judge_id)}</strong> · {where(c)}</span>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={c.approved} disabled={frozen}
                      onChange={e => review(c, shared(c), e.target.checked)} /> Approved
                  </label>
                </div>
                {c.edited_body && <p className="text-sm text-muted">Original: {c.body}</p>}
                <textarea aria-label={`Shared version of ${nameOf(judges, c.judge_id)}'s ${where(c)} comment for ${p.name}`}
                  rows={2} maxLength={4000} disabled={frozen} key={shared(c)} defaultValue={shared(c)} className={input}
                  onBlur={e => e.target.value.trim() !== shared(c) && review(c, e.target.value, c.approved)} />
              </div>
            ))}
          </section>
        )
      })}

      {paperJudges.length > 0 && !frozen && (
        <form onSubmit={addComment} className={`${card} grid gap-2 p-4`}>
          <h2 className={h2}>Add a comment from a paper sheet</h2>
          <div className="grid gap-2 sm:grid-cols-3">
            {([['judge', 'Judge', paperJudges, false], ['contestant', 'Contestant', contestants, false], ['category', 'Category', categories, true]] as const).map(([key, text, list, overall]) => (
              <label key={key} className="grid gap-1"><span className={label}>{text}</span>
                <select aria-label={text} required={!overall} className={input} value={add[key]} onChange={e => setAdd({ ...add, [key]: e.target.value })}>
                  <option value="">{overall ? 'Overall' : 'Choose…'}</option>
                  {list.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select></label>
            ))}
          </div>
          <textarea aria-label="Comment" required rows={3} maxLength={4000} className={input} value={add.body} onChange={e => setAdd({ ...add, body: e.target.value })} />
          <button className={`${button} justify-self-start`}>Add comment</button>
        </form>
      )}
    </div>

    {/* Printed feedback: one page per contestant with approved comments. */}
    <div className="hidden print:block">
      {contestants.filter(p => approved.some(c => c.contestant_id === p.id) || placings.some(x => x.contestantId === p.id)).map(p => {
        const mine = placings.find(x => x.contestantId === p.id)
        return (
        <section key={p.id} className="break-after-page text-[11pt] leading-relaxed [page:feedback]">
          <p className="text-muted">{contest.events?.name} · {contest.name}</p>
          <h1 className="border-b-2 border-fg pb-2 font-display text-3xl font-extrabold uppercase">{p.name}</h1>
          {mine && (
            <div className="mt-4">
              <p className="text-lg">Placed <strong>{mine.rank}</strong> of {placings.length} · {fmt(mine.total)} points ({(mine.pct * 100).toFixed(1)}%)</p>
              <table className="mt-2 border-collapse">
                <tbody>
                  {categories.filter(c => c.id in mine.categoryTotals).map(c => (
                    <tr key={c.id}><td className="border border-rule px-2 py-0.5">{c.name}</td><td className="border border-rule px-2 py-0.5 text-right font-mono">{fmt(mine.categoryTotals[c.id]!)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {approved.some(c => c.contestant_id === p.id) && <h2 className="mt-6 text-sm font-semibold uppercase tracking-wider">Judges' comments</h2>}
          {order(approved.filter(c => c.contestant_id === p.id)).map(c => (
            <div key={c.id} className="mt-4 break-inside-avoid">
              <p className="text-sm font-semibold uppercase tracking-wider text-muted">{where(c)}</p>
              <p className="whitespace-pre-wrap">{shared(c)}</p>
              {!contest.anonymize_comments && <p className="text-sm text-muted">— {nameOf(judges, c.judge_id)}</p>}
            </div>
          ))}
        </section>
      )})}
    </div>
  </>)
}
