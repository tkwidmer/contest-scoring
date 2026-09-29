import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { friendly } from '../lib/errors'
import { generateTiebreakSteps } from '../lib/scoring'
import { useWrites } from '../lib/useWrites'
import { ContestHeader } from '../components/ContestHeader'
import { buttonQuiet, card, h2, iconButton, input, label } from '../components/ui'

type Component = { id: string; name: string; min_points: number; max_points: number; step: number; sort: number }
type Category = { id: string; name: string; sort: number; drop_rank: number | null; round: string; components: Component[] }
type Step = { step_no: number; category_ids: string[]; all_judges: boolean }
type Contest = {
  id: string; name: string; status: string; aggregation: string; threshold_pct: number | null
  anonymize_comments: boolean; event_id: string; events: { name: string } | null
  finalist_count: number | null; prelim_aggregation: string; prelim_carries: boolean
}

const num = (s: string) => (s.trim() === '' ? null : Number(s))
const fmt = (n: number) => Number(n.toFixed(2)).toString()

export function ContestSetup() {
  const { contestId = '' } = useParams()
  const [contest, setContest] = useState<Contest | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [steps, setSteps] = useState<Step[]>([])
  const [tpl, setTpl] = useState<{ name: string; description: string; visibility: string; saved: string }>({ name: '', description: '', visibility: 'private', saved: '' })
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [c, cats, st] = await Promise.all([
      supabase.from('contests')
        .select('id, name, status, aggregation, threshold_pct, anonymize_comments, event_id, events(name), finalist_count, prelim_aggregation, prelim_carries')
        .eq('id', contestId).maybeSingle(),
      supabase.from('categories')
        .select('id, name, sort, drop_rank, round, components(id, name, min_points, max_points, step, sort)')
        .eq('contest_id', contestId).order('sort').order('sort', { referencedTable: 'components' }),
      supabase.from('tiebreak_steps').select('step_no, category_ids, all_judges').eq('contest_id', contestId).order('step_no'),
    ])
    const failed = c.error ?? cats.error ?? st.error
    if (failed) return setError(friendly(failed))
    if (!c.data) return setError("This contest doesn't exist, or you're not a member of its organization.")
    setContest(c.data)
    setCategories(cats.data ?? [])
    setSteps(st.data ?? [])
  }, [contestId])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; setState runs after the awaits
  useEffect(() => { load() }, [load])

  const { busy, run, saveField } = useWrites(load, setError)

  if (!contest) return error ? <p role="alert" className="text-danger">{error}</p> : <p className="text-muted">Loading…</p>

  const locked = contest.status !== 'draft'
  const rounds = contest.finalist_count != null
  const catMax = (c: Category) => c.components.reduce((t, k) => t + k.max_points, 0)
  const perJudgeMax = categories.reduce((s, c) => s + catMax(c), 0)
  const prelimMax = categories.filter(c => c.round === 'prelim').reduce((s, c) => s + catMax(c), 0)
  const dropOrder = [...categories].sort((a, b) => (a.drop_rank ?? Infinity) - (b.drop_rank ?? Infinity))
  const catName = new Map(categories.map(c => [c.id, c.name]))

  const updateContest = (patch: Partial<Pick<Contest, 'name' | 'aggregation' | 'threshold_pct' | 'anonymize_comments' | 'finalist_count' | 'prelim_aggregation' | 'prelim_carries'>>) =>
    run(supabase.from('contests').update(patch).eq('id', contest.id))
  const updateCategory = (id: string, patch: Partial<Pick<Category, 'name' | 'round'>>) => run(supabase.from('categories').update(patch).eq('id', id))
  const updateComponent = (id: string, patch: Partial<Component>) => run(supabase.from('components').update(patch).eq('id', id))

  const addCategory = () => run(supabase.from('categories').insert({
    contest_id: contest.id, name: 'New category',
    sort: Math.max(0, ...categories.map(c => c.sort)) + 1,
    drop_rank: categories.length + 1, // new categories are dropped last
  }))
  const deleteCategory = (c: Category) => {
    if (window.confirm(`Delete "${c.name}" and its ${c.components.length} component(s)?`)) {
      run(supabase.from('categories').delete().eq('id', c.id))
    }
  }
  const addComponent = (c: Category) => run(supabase.from('components').insert({
    category_id: c.id, name: 'New component', min_points: 0, max_points: 10, step: 1,
    sort: Math.max(0, ...c.components.map(k => k.sort)) + 1,
  }))

  // Reorder by swapping two neighbours, then rewriting every position (lists are short).
  const reorder = (list: Category[], i: number, j: number, field: 'sort' | 'drop_rank') => {
    const order = [...list]
    ;[order[i], order[j]] = [order[j]!, order[i]!]
    return run(...order.map((c, idx) => supabase.from('categories').update(field === 'sort' ? { sort: idx + 1 } : { drop_rank: idx + 1 }).eq('id', c.id)))
  }

  const regenerateSteps = async () => {
    const generated = generateTiebreakSteps(categories.map(c => ({ id: c.id, dropRank: c.drop_rank })))
    // Delete first so the new step numbers don't collide with the old ones.
    if (!(await run(supabase.from('tiebreak_steps').delete().eq('contest_id', contest.id)))) return
    await run(generated.length
      ? supabase.from('tiebreak_steps').insert(generated.map((ids, i) => ({ contest_id: contest.id, step_no: i + 1, category_ids: ids })))
      : Promise.resolve({ error: null }))
  }
  const toggleStepCategory = (s: Step, catId: string) => {
    const ids = s.category_ids.includes(catId) ? s.category_ids.filter(id => id !== catId) : [...s.category_ids, catId]
    const q = supabase.from('tiebreak_steps')
    return run(ids.length
      ? q.update({ category_ids: ids }).eq('contest_id', contest.id).eq('step_no', s.step_no)
      : q.delete().eq('contest_id', contest.id).eq('step_no', s.step_no))
  }
  const addStep = () => run(supabase.from('tiebreak_steps').insert({
    contest_id: contest.id, step_no: Math.max(0, ...steps.map(s => s.step_no)) + 1, category_ids: categories.map(c => c.id),
  }))

  return (
    <div className="grid gap-10">
      <ContestHeader contest={contest} />

      <div className={`${card} flex flex-wrap items-center justify-between gap-3 px-4 py-3`}>
        <p>
          {contest.status === 'draft'
            ? 'Draft: build the scoresheet and add people, then start scoring.'
            : contest.status === 'scoring'
              ? '🔒 Scoring has started, so the scoresheet, scoring method and threshold are locked. You can still rename the contest.'
              : `🔒 This contest is ${contest.status}.`}
        </p>
        {contest.status === 'draft' && (
          <button type="button" className={buttonQuiet} disabled={busy} onClick={() =>
            window.confirm('Start scoring? The scoresheet, scoring method and threshold will be locked.') &&
            run(supabase.rpc('set_contest_status', { p_contest: contest.id, p_status: 'scoring' }))}>Start scoring</button>
        )}
        {contest.status === 'scoring' && (
          <button type="button" className={buttonQuiet} disabled={busy}
            onClick={() => run(supabase.rpc('set_contest_status', { p_contest: contest.id, p_status: 'draft' }))}>Back to draft</button>
        )}
      </div>
      {error && <p role="alert" className="rounded border border-danger px-4 py-3 text-danger">{error}</p>}

      <fieldset disabled={busy} className="grid gap-10">
        {/* ── Settings ── */}
        <section className="grid gap-4">
          <h2 className={h2}>Settings</h2>
          <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
            <div className="grid gap-1">
              <label htmlFor="c-name" className={label}>Contest name</label>
              <input id="c-name" key={contest.name} defaultValue={contest.name} maxLength={120} className={input}
                onBlur={e => e.target.value.trim() && e.target.value !== contest.name && saveField(e.target, contest.name, () => updateContest({ name: e.target.value.trim() }))} />
            </div>
            <div className="grid gap-1">
              <label htmlFor="c-agg" className={label}>{rounds ? "Finals: combining judges' scores" : "Combining judges' scores"}</label>
              <select id="c-agg" value={contest.aggregation} disabled={locked} className={input}
                onChange={e => updateContest({ aggregation: e.target.value })}>
                <option value="sum">Add up every judge</option>
                <option value="drop_high_low">Drop each category's highest and lowest judge (5+ judges)</option>
                <option value="drop_high_low_total">Drop the judges with the highest and lowest overall totals (5+ judges)</option>
              </select>
            </div>
            <div className="grid gap-1">
              <label htmlFor="c-threshold" className={label}>Minimum to award the title (% of max possible)</label>
              <input id="c-threshold" key={String(contest.threshold_pct)} type="number" min={0} max={100} step="0.5"
                placeholder="No minimum" defaultValue={contest.threshold_pct ?? ''} disabled={locked} className={input}
                onBlur={e => num(e.target.value) !== contest.threshold_pct && saveField(e.target, contest.threshold_pct, () => updateContest({ threshold_pct: num(e.target.value) }))} />
              <p className="text-xs text-muted">
                {contest.threshold_pct == null
                  ? 'Leave blank to always award the title.'
                  : `A contestant needs ${contest.threshold_pct}% of the maximum possible points to win the title.`}
              </p>
            </div>
            <label className="flex items-center gap-2 self-center">
              <input type="checkbox" checked={rounds} disabled={locked}
                onChange={e => updateContest({ finalist_count: e.target.checked ? 5 : null })} />
              <span>Preliminaries, then finals for the top contestants</span>
            </label>
            {rounds && <>
              <div className="grid gap-1">
                <label htmlFor="c-finalists" className={label}>Finalists (top N after prelims)</label>
                <input id="c-finalists" key={String(contest.finalist_count)} type="number" min={1} defaultValue={contest.finalist_count ?? ''} disabled={locked} className={input}
                  onBlur={e => { const v = num(e.target.value); if (v && v !== contest.finalist_count) saveField(e.target, contest.finalist_count, () => updateContest({ finalist_count: v })) }} />
              </div>
              <div className="grid gap-1">
                <label htmlFor="c-prelim-agg" className={label}>Prelims: combining judges' scores</label>
                <select id="c-prelim-agg" value={contest.prelim_aggregation} disabled={locked} className={input}
                  onChange={e => updateContest({ prelim_aggregation: e.target.value })}>
                  <option value="sum">Add up every judge</option>
                <option value="drop_high_low">Drop each category's highest and lowest judge (5+ judges)</option>
                <option value="drop_high_low_total">Drop the judges with the highest and lowest overall totals (5+ judges)</option>
                </select>
              </div>
              <label className="flex items-center gap-2 self-center">
                <input type="checkbox" checked={contest.prelim_carries} disabled={locked}
                  onChange={e => updateContest({ prelim_carries: e.target.checked })} />
                <span>Prelim scores count toward the finals (IMBB). Leave off to start the finals fresh (IML).</span>
              </label>
            </>}
            <label className="flex items-center gap-2 self-center">
              <input type="checkbox" checked={contest.anonymize_comments}
                onChange={e => updateContest({ anonymize_comments: e.target.checked })} />
              <span>Hide judges' names on feedback sent to contestants</span>
            </label>
          </div>
        </section>

        {/* ── Rubric ── */}
        <section className="grid gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className={h2}>Scoresheet</h2>
            <p className="font-mono text-sm">
              {rounds
                ? <>Prelims <strong>{fmt(prelimMax)}</strong> · Finals <strong>{fmt(contest.prelim_carries ? perJudgeMax : perJudgeMax - prelimMax)}</strong> pts per judge</>
                : <>Max per judge: <strong>{fmt(perJudgeMax)}</strong> pts</>}
            </p>
          </div>
          {categories.length === 0 && <p className="text-muted">Add the categories judges score, like Speech, Interview or Fantasy.</p>}
          {categories.map((c, i) => (
            <div key={c.id} className={`${card} grid gap-3 p-4`}>
              <div className="flex flex-wrap items-center gap-2">
                <input aria-label="Category name" key={c.name} defaultValue={c.name} maxLength={120} disabled={locked}
                  className={`${input} flex-1 font-semibold`}
                  onBlur={e => e.target.value.trim() && e.target.value !== c.name && saveField(e.target, c.name, () => updateCategory(c.id, { name: e.target.value.trim() }))} />
                {rounds && (
                  <select aria-label={`${c.name} round`} value={c.round} disabled={locked} className={`${input} w-auto py-1 text-sm`}
                    onChange={e => run(supabase.from('categories').update({ round: e.target.value }).eq('id', c.id))}>
                    <option value="prelim">Prelims</option>
                    <option value="final">Finals</option>
                  </select>
                )}
                <span className="font-mono text-sm text-muted">{fmt(catMax(c))} pts</span>
                {!locked && <>
                  <button type="button" className={iconButton} aria-label={`Move ${c.name} up`} disabled={i === 0}
                    onClick={() => reorder(categories, i, i - 1, 'sort')}>↑</button>
                  <button type="button" className={iconButton} aria-label={`Move ${c.name} down`} disabled={i === categories.length - 1}
                    onClick={() => reorder(categories, i, i + 1, 'sort')}>↓</button>
                  <button type="button" className={iconButton} aria-label={`Delete ${c.name}`} onClick={() => deleteCategory(c)}>✕</button>
                </>}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted">
                    <tr><th className="py-1 font-normal">Component</th><th className="w-24 font-normal">Min</th><th className="w-24 font-normal">Max</th><th className="w-24 font-normal">Step</th><th className="w-10" /></tr>
                  </thead>
                  <tbody>
                    {c.components.map(k => (
                      <tr key={k.id}>
                        <td className="py-1 pr-2">
                          <input aria-label="Component name" key={k.name} defaultValue={k.name} maxLength={120} disabled={locked} className={input}
                            onBlur={e => e.target.value.trim() && e.target.value !== k.name && saveField(e.target, k.name, () => updateComponent(k.id, { name: e.target.value.trim() }))} />
                        </td>
                        {(['min_points', 'max_points', 'step'] as const).map(f => (
                          <td key={f} className="pr-2">
                            <input aria-label={`${k.name} ${f.replace('_points', '')}`} key={k[f]} type="number" min={0} step="0.25"
                              defaultValue={k[f]} disabled={locked} className={`${input} font-mono`}
                              onBlur={e => { const v = num(e.target.value); if (v != null && v !== k[f]) saveField(e.target, k[f], () => updateComponent(k.id, { [f]: v })) }} />
                          </td>
                        ))}
                        <td>
                          {!locked && <button type="button" className={iconButton} aria-label={`Delete ${k.name}`}
                            onClick={() => run(supabase.from('components').delete().eq('id', k.id))}>✕</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!locked && <button type="button" className={`${buttonQuiet} justify-self-start`} onClick={() => addComponent(c)}>+ Add component</button>}
            </div>
          ))}
          {!locked && <button type="button" className={`${buttonQuiet} justify-self-start`} onClick={addCategory}>+ Add category</button>}
        </section>

        {/* ── Tiebreaks ── */}
        <section className="grid gap-4">
          <h2 className={h2}>Tiebreaks</h2>
          <p className="max-w-prose text-sm text-muted">
            When contestants tie on total, each step re-totals only the listed categories. Steps are tried in order until the tie breaks.
            If it never breaks, you choose the winner.
          </p>
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div className="grid content-start gap-2">
              <h3 className="font-semibold">Drop order</h3>
              <p className="text-xs text-muted">First category listed is dropped first.</p>
              <ol className={`${card} divide-y divide-rule`}>
                {dropOrder.map((c, i) => (
                  <li key={c.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="w-5 font-mono text-xs text-muted">{i + 1}</span>
                    <span className="flex-1 truncate">{c.name}</span>
                    {!locked && <>
                      <button type="button" className={iconButton} aria-label={`Drop ${c.name} earlier`} disabled={i === 0} onClick={() => reorder(dropOrder, i, i - 1, 'drop_rank')}>↑</button>
                      <button type="button" className={iconButton} aria-label={`Drop ${c.name} later`} disabled={i === dropOrder.length - 1} onClick={() => reorder(dropOrder, i, i + 1, 'drop_rank')}>↓</button>
                    </>}
                  </li>
                ))}
              </ol>
              {!locked && categories.length > 1 && (
                <button type="button" className={`${buttonQuiet} justify-self-start`} onClick={regenerateSteps}>Rebuild steps from drop order</button>
              )}
            </div>

            <div className="grid content-start gap-2">
              <h3 className="font-semibold">Steps</h3>
              {steps.length === 0 && <p className="text-sm text-muted">No tiebreak steps. Ties will go straight to your decision.</p>}
              {steps.map((s, i) => (
                <div key={s.step_no} className={`${card} flex flex-wrap items-center gap-2 px-3 py-2`}>
                  <span className="w-14 font-mono text-xs text-muted">Step {i + 1}</span>
                  <label className="flex items-center gap-1 text-xs text-muted" title="Add the dropped highest and lowest scores back in for this step">
                    <input type="checkbox" checked={s.all_judges} disabled={locked}
                      onChange={e => run(supabase.from('tiebreak_steps').update({ all_judges: e.target.checked }).eq('contest_id', contest.id).eq('step_no', s.step_no))} />
                    every judge
                  </label>
                  {categories.map(c => {
                    const on = s.category_ids.includes(c.id)
                    return (
                      <button key={c.id} type="button" aria-pressed={on} disabled={locked}
                        className={`rounded-full border px-3 py-0.5 text-sm ${on ? 'border-accent bg-accent text-on-accent' : 'border-rule text-muted line-through'}`}
                        onClick={() => toggleStepCategory(s, c.id)}>
                        {catName.get(c.id)}
                      </button>
                    )
                  })}
                </div>
              ))}
              {!locked && categories.length > 0 && (
                <button type="button" className={`${buttonQuiet} justify-self-start`} onClick={addStep}>+ Add step</button>
              )}
            </div>
          </div>
        </section>
        {/* ── Template ── */}
        <section className="grid gap-3">
          <h2 className={h2}>Save as template</h2>
          <p className="max-w-prose text-sm text-muted">
            Reuse this scoresheet, scoring method, minimum and tiebreaks for future contests. Contestants, judges and scores are not included.
          </p>
          <form className="grid max-w-3xl gap-2 sm:grid-cols-[2fr_3fr_auto_auto] sm:items-end" onSubmit={async e => {
            e.preventDefault()
            const name = tpl.name.trim() || contest.name
            const ok = await run(supabase.rpc('save_contest_as_template', { p_contest: contest.id, p_name: name, p_description: tpl.description, p_visibility: tpl.visibility }))
            if (ok) setTpl({ ...tpl, name: '', description: '', saved: name })
          }}>
            <div className="grid gap-1"><label htmlFor="tpl-name" className={label}>Template name</label>
              <input id="tpl-name" maxLength={120} placeholder={contest.name} className={input} value={tpl.name} onChange={e => setTpl({ ...tpl, name: e.target.value })} /></div>
            <div className="grid gap-1"><label htmlFor="tpl-desc" className={label}>Description</label>
              <input id="tpl-desc" maxLength={2000} className={input} value={tpl.description} onChange={e => setTpl({ ...tpl, description: e.target.value })} /></div>
            <div className="grid gap-1"><label htmlFor="tpl-vis" className={label}>Who can use it</label>
              <select id="tpl-vis" className={input} value={tpl.visibility} onChange={e => setTpl({ ...tpl, visibility: e.target.value })}>
                <option value="private">My organization</option>
                <option value="public">Any producer</option>
              </select></div>
            <button className={buttonQuiet}>Save template</button>
          </form>
          {tpl.saved && <p role="status" className="text-sm text-muted">Saved "{tpl.saved}". It's now available when adding a contest.</p>}
        </section>
      </fieldset>
    </div>
  )
}
