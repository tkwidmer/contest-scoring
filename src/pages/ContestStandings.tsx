import { Fragment, useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { Json } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import { friendly } from '../lib/errors'
import { useWrites } from '../lib/useWrites'
import { computeResults, type Result, type ScoringInput } from '../lib/scoring'
import { ContestHeader } from '../components/ContestHeader'
import { button, buttonQuiet, card, h2, input } from '../components/ui'

type Contest = {
  id: string; name: string; status: string; event_id: string; events: { name: string } | null
  aggregation: string; threshold_pct: number | null; manual_winner_contestant_id: string | null
  manual_winner_reason: string | null; final_result: Json | null; finalized_at: string | null
}
type Named = { id: string; name: string }

const fmt = (n: number) => Number(n.toFixed(2)).toString()
const pct = (n: number) => `${(n * 100).toFixed(1)}%`

export function ContestStandings() {
  const { contestId = '' } = useParams()
  const [contest, setContest] = useState<Contest | null>(null)
  const [input_, setInput] = useState<ScoringInput | null>(null)
  const [names, setNames] = useState<{ contestants: Map<string, string>; judges: Named[]; categories: Named[] }>()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [manual, setManual] = useState({ id: '', reason: '' })
  const [error, setError] = useState('')
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)

  const load = useCallback(async () => {
    const [c, cats, cs, js, rs, sc, ts] = await Promise.all([
      supabase.from('contests').select('id, name, status, event_id, events(name), aggregation, threshold_pct, manual_winner_contestant_id, manual_winner_reason, final_result, finalized_at')
        .eq('id', contestId).maybeSingle(),
      supabase.from('categories').select('id, name, components(id, min_points, max_points, step)')
        .eq('contest_id', contestId).order('sort').order('sort', { referencedTable: 'components' }),
      supabase.from('contestants').select('id, display_name, number, withdrawn').eq('contest_id', contestId).order('sort'),
      supabase.from('judges').select('id, name').eq('contest_id', contestId).order('sort'),
      supabase.from('recusals').select('judge_id, contestant_id, judges!inner(contest_id)').eq('judges.contest_id', contestId),
      supabase.from('scores').select('judge_id, contestant_id, component_id, value').eq('contest_id', contestId),
      supabase.from('tiebreak_steps').select('category_ids').eq('contest_id', contestId).order('step_no'),
    ])
    const failed = c.error ?? cats.error ?? cs.error ?? js.error ?? rs.error ?? sc.error ?? ts.error
    if (failed) return setError(friendly(failed))
    if (!c.data) return setError("This contest doesn't exist, or you're not a member of its organization.")
    setContest(c.data)
    setInput({
      aggregation: c.data.aggregation as ScoringInput['aggregation'],
      thresholdPct: c.data.threshold_pct,
      categories: (cats.data ?? []).map(cat => ({
        id: cat.id, name: cat.name,
        components: cat.components.map(k => ({ id: k.id, min: k.min_points, max: k.max_points, step: k.step })),
      })),
      tiebreakSteps: (ts.data ?? []).map(t => t.category_ids),
      judges: (js.data ?? []).map(j => ({ id: j.id })),
      contestants: (cs.data ?? []).map(x => ({ id: x.id, withdrawn: x.withdrawn })),
      recusals: (rs.data ?? []).map(r => ({ judgeId: r.judge_id, contestantId: r.contestant_id })),
      scores: (sc.data ?? []).map(s => ({ judgeId: s.judge_id, contestantId: s.contestant_id, componentId: s.component_id, value: s.value })),
      manualWinnerId: c.data.manual_winner_contestant_id,
    })
    setNames({
      contestants: new Map((cs.data ?? []).map(x => [x.id, x.number != null ? `${x.number} · ${x.display_name}` : x.display_name])),
      judges: js.data ?? [],
      categories: (cats.data ?? []).map(cat => ({ id: cat.id, name: cat.name })),
    })
    setLoadedAt(new Date())
  }, [contestId])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; setState runs after the awaits
  useEffect(() => { load() }, [load])

  const { busy, run } = useWrites(load, setError)

  if (!contest || !input_ || !names) return error ? <p role="alert" className="text-danger">{error}</p> : <p className="text-muted">Loading…</p>

  // Once finalized, show the frozen result, not a recomputation.
  const finalized = contest.status === 'finalized' || contest.status === 'published'
  const result: Result = finalized && contest.final_result ? contest.final_result as unknown as Result : computeResults(input_)
  const name = (id: string | null | undefined) => (id && names.contestants.get(id)) || 'Unknown'
  const judgeName = new Map(names.judges.map(j => [j.id, j.name]))
  const { winner } = result
  const leader = result.standings[0]
  const firstBelow = result.thresholdPoints == null ? -1 : result.standings.findIndex(s => s.total < result.thresholdPoints!)

  // Cells still to enter, per judge and category (recused cells don't count).
  const recused = new Set(input_.recusals.map(r => `${r.judgeId}|${r.contestantId}`))
  const entered = new Set(input_.scores.map(s => `${s.judgeId}|${s.contestantId}|${s.componentId}`))
  const active = input_.contestants.filter(c => !c.withdrawn)
  const progress = (judgeId: string, catId: string) => {
    const comps = input_.categories.find(c => c.id === catId)!.components
    let done = 0, total = 0
    for (const c of active) {
      if (recused.has(`${judgeId}|${c.id}`)) continue
      for (const k of comps) { total++; if (entered.has(`${judgeId}|${c.id}|${k.id}`)) done++ }
    }
    return { done, total }
  }
  const missing = names.judges.reduce((s, j) => s + names.categories.reduce((t, c) => { const p = progress(j.id, c.id); return t + p.total - p.done }, 0), 0)

  const toggle = (id: string) => setExpanded(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const finalize = () => window.confirm('Finalize results? Scores will be locked. You can reopen scoring later if needed.') &&
    run(supabase.rpc('finalize_contest', { p_contest: contest.id, p_result: result as unknown as Json }))
  const saveManual = () => run(supabase.from('contests')
    .update({ manual_winner_contestant_id: manual.id || null, manual_winner_reason: manual.reason.trim() || null }).eq('id', contest.id))

  const banner = (() => {
    switch (winner.kind) {
      case 'incomplete':
        return <><strong>Projected winner: {winner.projectedId ? name(winner.projectedId) : 'none yet'}</strong>
          <span className="text-muted"> · {missing} score{missing === 1 ? '' : 's'} still to enter. Projections compare % of points possible on the scores entered so far.</span></>
      case 'decided': {
        const s = result.standings.find(x => x.contestantId === winner.contestantId)
        const step = s?.tiebreakPath?.at(-1)?.step
        return <><strong>Winner: {name(winner.contestantId)}</strong>
          <span className="text-muted"> · {fmt(s!.total)} pts ({pct(s!.pct)})
            {winner.manual ? ` · chosen by the producer${contest.manual_winner_reason ? `: ${contest.manual_winner_reason}` : ''}` : step ? ` · won on tiebreak step ${step}` : ''}</span></>
      }
      case 'no_title':
        return <><strong>No title awarded.</strong><span className="text-muted"> The leader, {name(leader?.contestantId)}, has {pct(leader?.pct ?? 0)}, below the {contest.threshold_pct}% minimum.</span></>
      case 'tie_unresolved':
        return <><strong>Tie: {winner.contestantIds.map(name).join(' and ')}</strong><span className="text-muted"> are still tied after every tiebreak step. Choose the winner below.</span></>
    }
  })()

  return (
    <div className="grid gap-6">
      <ContestHeader contest={contest} />
      {error && <p role="alert" className="rounded border border-danger px-4 py-3 text-danger print:hidden">{error}</p>}

      <div className={`${card} grid gap-1 px-4 py-4 text-lg`} role="status">
        <p>{banner}</p>
        {finalized && contest.finalized_at && <p className="text-sm text-muted">🔒 Finalized {new Date(contest.finalized_at).toLocaleString()}</p>}
      </div>

      {result.warnings.map(w => <p key={w} className="rounded border border-rule px-4 py-2 text-sm">⚠ {w}</p>)}

      {winner.kind === 'tie_unresolved' && !finalized && (
        <div className={`${card} grid gap-2 px-4 py-3 sm:grid-cols-[auto_1fr_auto] sm:items-end print:hidden`}>
          <label className="grid gap-1 text-sm"><span className="text-muted">Winner</span>
            <select className={input} value={manual.id} onChange={e => setManual({ ...manual, id: e.target.value })}>
              <option value="">Choose…</option>
              {winner.contestantIds.map(id => <option key={id} value={id}>{name(id)}</option>)}
            </select></label>
          <label className="grid gap-1 text-sm"><span className="text-muted">How it was decided (shown with the result)</span>
            <input className={input} value={manual.reason} placeholder="Judges' vote after deliberation" onChange={e => setManual({ ...manual, reason: e.target.value })} /></label>
          <button className={button} disabled={!manual.id || busy} onClick={saveManual}>Save winner</button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <button className={buttonQuiet} disabled={busy} onClick={() => load()}>Refresh</button>
        <span className="text-xs text-muted">{loadedAt && `Updated ${loadedAt.toLocaleTimeString()}`}</span>
        <span className="flex-1" />
        <button className={buttonQuiet} onClick={() => { setExpanded(new Set(result.standings.map(s => s.contestantId))); setTimeout(() => window.print(), 0) }}>Print tally</button>
        {contest.status === 'scoring' && (winner.kind === 'decided' || winner.kind === 'no_title') && (
          <button className={button} disabled={busy} onClick={finalize}>Finalize results</button>
        )}
        {contest.status === 'finalized' && (
          <button className={buttonQuiet} disabled={busy} onClick={() =>
            window.confirm('Reopen scoring? The finalized result is discarded until you finalize again.') &&
            run(supabase.rpc('set_contest_status', { p_contest: contest.id, p_status: 'scoring' }))}>Reopen scoring</button>
        )}
      </div>

      <section className="grid gap-2">
        <h2 className={h2}>Standings</h2>
        <p className="text-sm text-muted">
          Max possible {fmt(result.maxPossible)} pts
          {result.thresholdPoints != null && <> · minimum to win {fmt(result.thresholdPoints)} ({contest.threshold_pct}%)</>}
          {' · '}{input_.aggregation === 'drop_high_low' ? "each category drops its highest and lowest judge" : 'every judge counts'}
        </p>
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr className="border-b border-rule">
                <th className="px-3 py-2 font-normal">Rank</th><th className="px-3 font-normal">Contestant</th>
                {names.categories.map(c => <th key={c.id} className="px-3 text-right font-normal">{c.name}</th>)}
                <th className="px-3 text-right font-normal">Total</th><th className="px-3 text-right font-normal">%</th>
                <th className="px-3 text-right font-normal print:hidden">Scores in</th>
              </tr>
            </thead>
            <tbody>
              {result.standings.map((s, i) => (
                <Fragment key={s.contestantId}>
                  {i === firstBelow && (
                    <tr><td colSpan={names.categories.length + 5} className="border-t-2 border-dashed border-danger px-3 py-1 text-xs text-danger">
                      Below the {contest.threshold_pct}% minimum</td></tr>
                  )}
                  <tr className={`border-b border-rule ${firstBelow !== -1 && i >= firstBelow ? 'text-muted' : ''}`}>
                    <td className="px-3 py-2 font-mono">{s.rank}</td>
                    <td className="px-3">
                      <button className="text-left hover:text-accent print:pointer-events-none" aria-expanded={expanded.has(s.contestantId)} onClick={() => toggle(s.contestantId)}>
                        <span className="print:hidden">{expanded.has(s.contestantId) ? '▾' : '▸'} </span>{name(s.contestantId)}
                      </button>
                    </td>
                    {names.categories.map(c => <td key={c.id} className="px-3 text-right font-mono">{fmt(s.categoryTotals[c.id] ?? 0)}</td>)}
                    <td className="px-3 text-right font-mono font-semibold">{fmt(s.total)}</td>
                    <td className="px-3 text-right font-mono">{pct(s.pct)}</td>
                    <td className="px-3 text-right font-mono print:hidden">{Math.round(s.completeness * 100)}%</td>
                  </tr>
                  {expanded.has(s.contestantId) && (
                    <tr className="border-b border-rule bg-bg">
                      <td />
                      <td colSpan={names.categories.length + 4} className="px-3 py-2">
                        <table className="text-xs">
                          <thead><tr className="text-muted"><th />{names.judges.map(j => <th key={j.id} className="px-2 font-normal">{j.name}</th>)}</tr></thead>
                          <tbody>
                            {names.categories.map(c => (
                              <tr key={c.id}>
                                <th className="pr-3 text-left font-normal text-muted">{c.name}</th>
                                {(s.breakdown[c.id] ?? []).map(b => (
                                  <td key={b.judgeId} className={`px-2 text-right font-mono ${b.dropped ? 'text-muted line-through' : ''}`}
                                    title={[b.dropped && 'Dropped', b.backfilled && `${judgeName.get(b.judgeId)} is recused; filled with the others' average`].filter(Boolean).join('. ') || undefined}>
                                    {b.subtotal == null ? '–' : fmt(b.subtotal)}{b.backfilled && <sup>avg</sup>}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {s.tiebreakPath && (
                          <p className="mt-2 text-xs text-muted">
                            Tiebreak: {s.tiebreakPath.map(p => `step ${p.step} = ${fmt(p.value)}`).join(', ')}
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted print:hidden">Click a name for each judge's category totals. Struck-through values were dropped; <sup>avg</sup> marks a recused judge's filled-in slot.</p>
      </section>

      <section className="grid gap-2 print:hidden">
        <h2 className={h2}>Judge progress</h2>
        <div className={`${card} overflow-x-auto`}>
          <table className="text-sm">
            <thead><tr className="border-b border-rule text-muted"><th className="px-3 py-2 text-left font-normal">Judge</th>
              {names.categories.map(c => <th key={c.id} className="px-3 font-normal">{c.name}</th>)}</tr></thead>
            <tbody>
              {names.judges.map(j => (
                <tr key={j.id} className="border-b border-rule last:border-0">
                  <th className="px-3 py-1.5 text-left font-normal">{j.name}</th>
                  {names.categories.map(c => {
                    const p = progress(j.id, c.id)
                    return <td key={c.id} className={`px-3 text-center font-mono ${p.done === p.total ? 'text-muted' : ''}`}>{p.done === p.total ? '✓' : `${p.done}/${p.total}`}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
