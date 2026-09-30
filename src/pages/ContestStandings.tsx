import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import type { Json } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import { friendly } from '../lib/errors'
import { useWrites } from '../lib/useWrites'
import { CROSS_PANEL, PRODUCER, computeContest, type Aggregation, type Deduction, type Result, type Rounds, type ScoringInput } from '../lib/scoring'
import { ContestHeader } from '../components/ContestHeader'
import { button, buttonQuiet, card, h2, input } from '../components/ui'

type Contest = {
  id: string; name: string; status: string; event_id: string; events: { name: string } | null
  aggregation: string; threshold_pct: number | null; manual_winner_contestant_id: string | null
  manual_winner_reason: string | null; final_result: Json | null; finalized_at: string | null
  finalist_count: number | null; prelim_aggregation: string; prelim_carries: boolean; finalists_confirmed_at: string | null
  report_as: string; threshold_single_only: boolean
}
type Named = { id: string; name: string }
type Names = { contestants: Map<string, string>; judges: (Named & { guest: boolean })[]; categories: (Named & { round: string; scored_by: string; guest_average: boolean })[] }

const fmt = (n: number) => Number(n.toFixed(2)).toString()
const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const aggregationText: Record<string, string> = {
  sum: 'every judge counts',
  drop_high_low: "each category drops its highest and lowest judge",
  drop_high_low_total: 'the judges with the highest and lowest overall totals are dropped',
}

export function ContestStandings() {
  const { contestId = '' } = useParams()
  const [contest, setContest] = useState<Contest | null>(null)
  const [input_, setInput] = useState<ScoringInput | null>(null)
  const [names, setNames] = useState<Names>()
  const [confirmed, setConfirmed] = useState<string[]>([])
  const [cutPicks, setCutPicks] = useState<string[]>([])
  const [manual, setManual] = useState({ id: '', reason: '' })
  const [error, setError] = useState('')
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)

  const load = useCallback(async () => {
    const [c, cats, cs, js, rs, sc, ts, pn, fr] = await Promise.all([
      supabase.from('contests').select('id, name, status, event_id, events(name), aggregation, threshold_pct, manual_winner_contestant_id, manual_winner_reason, finalized_at, finalist_count, prelim_aggregation, prelim_carries, finalists_confirmed_at, report_as, threshold_single_only')
        .eq('id', contestId).maybeSingle(),
      supabase.from('categories').select('id, name, round, scored_by, guest_average, deductions, components(id, min_points, max_points, step)')
        .eq('contest_id', contestId).order('sort').order('sort', { referencedTable: 'components' }),
      supabase.from('contestants').select('id, display_name, number, withdrawn, finalist').eq('contest_id', contestId).order('sort'),
      supabase.from('judges').select('id, name, guest').eq('contest_id', contestId).order('sort'),
      supabase.from('recusals').select('judge_id, contestant_id, judges!inner(contest_id)').eq('judges.contest_id', contestId),
      supabase.from('scores').select('judge_id, contestant_id, component_id, value').eq('contest_id', contestId),
      supabase.from('tiebreak_steps').select('category_ids, all_judges').eq('contest_id', contestId).order('step_no'),
      supabase.from('penalties').select('contestant_id, category_id, tier').eq('contest_id', contestId),
      // The frozen result holds every judge's scores, so it's only readable through this members-only RPC.
      supabase.rpc('contest_final_result', { p_contest: contestId }),
    ])
    const failed = c.error ?? cats.error ?? cs.error ?? js.error ?? rs.error ?? sc.error ?? ts.error ?? pn.error ?? fr.error
    if (failed) return setError(friendly(failed))
    if (!c.data) return setError("This contest doesn't exist, or you're not a member of its organization.")
    setContest({ ...c.data, final_result: fr.data })
    setInput({
      aggregation: c.data.aggregation as Aggregation,
      thresholdPct: c.data.threshold_pct,
      thresholdSingleOnly: c.data.threshold_single_only,
      reportAs: c.data.report_as as ScoringInput['reportAs'],
      penalties: (pn.data ?? []).map(p => ({ contestantId: p.contestant_id, categoryId: p.category_id, tier: p.tier })),
      categories: (cats.data ?? []).map(cat => ({
        id: cat.id, name: cat.name,
        scoredBy: cat.scored_by as 'judges' | 'producer' | 'cross_panel', guestAverage: cat.guest_average, deductions: cat.deductions as Deduction[],
        components: cat.components.map(k => ({ id: k.id, min: k.min_points, max: k.max_points, step: k.step })),
      })),
      tiebreakSteps: (ts.data ?? []).map(t => ({ categoryIds: t.category_ids, allJudges: t.all_judges })),
      judges: (js.data ?? []).map(j => ({ id: j.id, guest: j.guest })),
      contestants: (cs.data ?? []).map(x => ({ id: x.id, withdrawn: x.withdrawn })),
      recusals: (rs.data ?? []).map(r => ({ judgeId: r.judge_id, contestantId: r.contestant_id })),
      scores: (sc.data ?? []).map(s => ({ judgeId: s.judge_id, contestantId: s.contestant_id, componentId: s.component_id, value: s.value })),
      manualWinnerId: c.data.manual_winner_contestant_id,
    })
    setConfirmed(c.data.finalists_confirmed_at ? (cs.data ?? []).filter(x => x.finalist).map(x => x.id) : [])
    setNames({
      contestants: new Map((cs.data ?? []).map(x => [x.id, x.number != null ? `${x.number} · ${x.display_name}` : x.display_name])),
      judges: js.data ?? [],
      categories: (cats.data ?? []).map(cat => ({ id: cat.id, name: cat.name, round: cat.round, scored_by: cat.scored_by, guest_average: cat.guest_average })),
    })
    setLoadedAt(new Date())
  }, [contestId])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; setState runs after the awaits
  useEffect(() => { load() }, [load])

  const { busy, run } = useWrites(load, setError)

  if (!contest || !input_ || !names) return error ? <p role="alert" className="text-danger">{error}</p> : <p className="text-muted">Loading…</p>

  const hasRounds = contest.finalist_count != null
  const rounds: Rounds | null = hasRounds ? {
    prelimCategoryIds: names.categories.filter(c => c.round === 'prelim').map(c => c.id),
    prelimAggregation: contest.prelim_aggregation as Aggregation,
    finalistCount: contest.finalist_count!,
    carryPrelim: contest.prelim_carries,
    finalistIds: contest.finalists_confirmed_at ? confirmed : null,
    manualFinalistIds: cutPicks.length ? cutPicks : confirmed, // after confirming, the confirmed pick stands
  } : null
  const live = computeContest(input_, rounds)
  // Once finalized, show the frozen finals result, not a recomputation.
  const finalized = contest.status === 'finalized' || contest.status === 'published'
  const final: Result | null = finalized && contest.final_result ? contest.final_result as unknown as Result : live.final
  const prelim = live.prelim
  const name = (id: string | null | undefined) => (id && names.contestants.get(id)) || 'Unknown'
  const scaleNote = contest.report_as === 'average' ? ' · category scores are the average of the counted judges' : ''

  // Score cells still to enter, per judge and category (recused cells and non-finalists in the finals don't count).
  const recused = new Set(input_.recusals.map(r => `${r.judgeId}|${r.contestantId}`))
  const entered = new Set(input_.scores.map(s => `${s.judgeId}|${s.contestantId}|${s.componentId}`))
  const active = input_.contestants.filter(c => !c.withdrawn)
  // Rows of the progress grid: each judge, plus "Producer" when some categories are producer-entered.
  const fillers = [...names.judges, ...(names.categories.some(c => c.scored_by === 'producer') ? [{ id: PRODUCER, name: 'Producer', guest: false }] : [])]
  const progress = (judgeId: string, catId: string) => {
    const cat = names.categories.find(c => c.id === catId)!
    const guest = names.judges.find(j => j.id === judgeId)?.guest
    const fills = judgeId === PRODUCER ? cat.scored_by === 'producer'
      : cat.scored_by === 'cross_panel' ? guest : cat.scored_by === 'judges' && (!guest || cat.guest_average)
    if (!fills) return { done: 0, total: 0 }
    const comps = input_.categories.find(c => c.id === catId)!.components
    const who = hasRounds && cat.round === 'final' ? active.filter(c => confirmed.includes(c.id)) : active
    const key = judgeId === PRODUCER ? 'null' : judgeId
    let done = 0, total = 0
    for (const c of who) {
      if (recused.has(`${judgeId}|${c.id}`)) continue
      for (const k of comps) { total++; if (entered.has(`${key}|${c.id}|${k.id}`)) done++ }
    }
    return { done, total }
  }
  const missingIn = (round?: string) => fillers.reduce((s, j) => s + names.categories
    .filter(c => !round || !hasRounds || c.round === round)
    .reduce((t, c) => { const p = progress(j.id, c.id); return t + p.total - p.done }, 0), 0)

  const finalize = () => final && window.confirm('Finalize results? Scores will be locked. You can reopen scoring later if needed.') &&
    run(supabase.rpc('finalize_contest', { p_contest: contest.id, p_result: final as unknown as Json }))
  const saveManual = () => run(supabase.from('contests')
    .update({ manual_winner_contestant_id: manual.id || null, manual_winner_reason: manual.reason.trim() || null }).eq('id', contest.id))
  const confirmCut = (ids: string[]) => window.confirm(`Confirm these ${ids.length} finalists? Finals scores open for them only.\n\n${ids.map(name).join('\n')}`) &&
    run(supabase.rpc('confirm_finalists', { p_contest: contest.id, p_finalists: ids })).then(ok => ok && setCutPicks([]))

  const banner = (() => {
    if (hasRounds && !contest.finalists_confirmed_at) {
      const cut = prelim!.cut
      if (!cut.complete) return <><strong>Preliminaries in progress</strong><span className="text-muted"> · {missingIn('prelim')} prelim score{missingIn('prelim') === 1 ? '' : 's'} still to enter.</span></>
      if (!cut.proposed) return <><strong>Tie at the cut line</strong><span className="text-muted"> · {cut.tied.map(name).join(', ')} are tied for {cut.slots} finalist spot{cut.slots === 1 ? '' : 's'}. Choose below.</span></>
      return <><strong>Preliminaries complete</strong><span className="text-muted"> · confirm the {cut.proposed.length} finalists below to open the finals.</span></>
    }
    if (!final) return null
    const { winner } = final
    const leader = final.standings[0]
    switch (winner.kind) {
      case 'incomplete':
        return <><strong>Projected winner: {winner.projectedId ? name(winner.projectedId) : 'none yet'}</strong>
          <span className="text-muted"> · {missingIn(hasRounds ? 'final' : undefined)} {hasRounds ? 'finals ' : ''}score{missingIn(hasRounds ? 'final' : undefined) === 1 ? '' : 's'} still to enter. Projections compare % of points possible on the scores entered so far.</span></>
      case 'decided': {
        const s = final.standings.find(x => x.contestantId === winner.contestantId)
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

  // What the tally covers: the finals (or the only round), then the prelims.
  const sections: TallySection[] = [
    ...(final ? [{ title: hasRounds ? 'Finals' : 'Standings', result: final, thresholdPct: contest.threshold_pct,
      categories: names.categories.filter(c => !hasRounds || contest.prelim_carries || c.round === 'final'),
      note: aggregationText[contest.aggregation]! + scaleNote }] : []),
    ...(prelim ? [{ title: 'Preliminaries', result: prelim, categories: names.categories.filter(c => c.round === 'prelim'),
      note: aggregationText[contest.prelim_aggregation]! + scaleNote, finalists: contest.finalists_confirmed_at ? confirmed : null }] : []),
  ]

  return (<>
    <div className="grid gap-6 print:hidden">
      <ContestHeader contest={contest} />
      {error && <p role="alert" className="rounded border border-danger px-4 py-3 text-danger print:hidden">{error}</p>}

      <div className={`${card} grid gap-1 px-4 py-4 text-lg`} role="status">
        <p>{banner}</p>
        {finalized && contest.finalized_at && <p className="text-sm text-muted">🔒 Finalized {new Date(contest.finalized_at).toLocaleString()}</p>}
      </div>

      {[...(prelim?.warnings ?? []), ...(final?.warnings ?? [])].filter((w, i, a) => a.indexOf(w) === i)
        .map(w => <p key={w} className="rounded border border-rule px-4 py-2 text-sm">⚠ {w}</p>)}

      {final?.winner.kind === 'tie_unresolved' && !finalized && (
        <div className={`${card} grid gap-2 px-4 py-3 sm:grid-cols-[auto_1fr_auto] sm:items-end print:hidden`}>
          <label className="grid gap-1 text-sm"><span className="text-muted">Winner</span>
            <select className={input} value={manual.id} onChange={e => setManual({ ...manual, id: e.target.value })}>
              <option value="">Choose…</option>
              {final.winner.contestantIds.map(id => <option key={id} value={id}>{name(id)}</option>)}
            </select></label>
          <label className="grid gap-1 text-sm"><span className="text-muted">How it was decided (shown with the result)</span>
            <input className={input} value={manual.reason} placeholder="Judges' vote" onChange={e => setManual({ ...manual, reason: e.target.value })} /></label>
          <button className={button} disabled={!manual.id || busy} onClick={saveManual}>Save winner</button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <button className={buttonQuiet} disabled={busy} onClick={() => load()}>Refresh</button>
        <span className="text-xs text-muted">{loadedAt && `Updated ${loadedAt.toLocaleTimeString()}`}</span>
        <span className="flex-1" />
        <button className={buttonQuiet} onClick={() => window.print()}>Print tally</button>
        {contest.status === 'scoring' && final && (final.winner.kind === 'decided' || final.winner.kind === 'no_title') && (
          <button className={button} disabled={busy} onClick={finalize}>Finalize results</button>
        )}
        {contest.status === 'finalized' && (
          <button className={buttonQuiet} disabled={busy} onClick={() =>
            window.confirm('Reopen scoring? The finalized result is discarded until you finalize again.') &&
            run(supabase.rpc('set_contest_status', { p_contest: contest.id, p_status: 'scoring' }))}>Reopen scoring</button>
        )}
      </div>

      {final && (
        <StandingsTable title={hasRounds ? 'Finals' : 'Standings'} result={final} names={names}
          categories={names.categories.filter(c => !hasRounds || contest.prelim_carries || c.round === 'final')}
          note={aggregationText[contest.aggregation]! + scaleNote} thresholdPct={contest.threshold_pct} />
      )}

      {prelim && (
        <section className="grid gap-2">
          <StandingsTable title="Preliminaries" result={prelim} names={names} cutAfter={contest.finalist_count!}
            categories={names.categories.filter(c => c.round === 'prelim')} note={aggregationText[contest.prelim_aggregation]! + scaleNote}
            finalists={contest.finalists_confirmed_at ? confirmed : null} />
          {!finalized && prelim.cut.complete && (
            <div className={`${card} grid gap-3 px-4 py-3 print:hidden`}>
              {prelim.cut.tied.length > 0 && (
                <fieldset className="grid gap-1">
                  <legend className="text-sm text-muted">
                    Tied at the cut line after every tiebreak step. Choose {prelim.cut.slots} to advance (for example by the judges' vote):
                  </legend>
                  <div className="flex flex-wrap gap-3">
                    {prelim.cut.tied.map(id => (
                      <label key={id} className="flex items-center gap-1">
                        <input type="checkbox" aria-label={`Advance ${name(id)}`} checked={(cutPicks.length ? cutPicks : confirmed).includes(id)}
                          onChange={e => setCutPicks(p => { const base = p.length ? p : confirmed.filter(x => prelim.cut.tied.includes(x)); return e.target.checked ? [...base, id] : base.filter(x => x !== id) })} /> {name(id)}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm">
                  {prelim.cut.proposed
                    ? <>Finalists: {prelim.cut.proposed.map(name).join(', ')}</>
                    : <span className="text-muted">Pick {prelim.cut.slots} from the tie to complete the list.</span>}
                </span>
                <span className="flex-1" />
                <button className={contest.finalists_confirmed_at ? buttonQuiet : button} disabled={busy || !prelim.cut.proposed || contest.status !== 'scoring'}
                  onClick={() => prelim.cut.proposed && confirmCut(prelim.cut.proposed)}>
                  {contest.finalists_confirmed_at ? 'Re-confirm finalists' : 'Confirm finalists'}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="grid gap-2 print:hidden">
        <h2 className={h2}>Judge progress</h2>
        <div className={`${card} overflow-x-auto`}>
          <table className="text-sm">
            <thead><tr className="border-b border-rule text-muted"><th className="px-3 py-2 text-left font-normal">Judge</th>
              {names.categories.map(c => <th key={c.id} className="px-3 font-normal">{c.name}{hasRounds && <span className="block text-xs">{c.round === 'prelim' ? 'prelims' : 'finals'}</span>}</th>)}</tr></thead>
            <tbody>
              {fillers.map(j => (
                <tr key={j.id} className="border-b border-rule last:border-0">
                  <th className="px-3 py-1.5 text-left font-normal">{j.name}{j.guest && <span className="text-xs text-muted"> (cross-panel)</span>}</th>
                  {names.categories.map(c => {
                    const p = progress(j.id, c.id)
                    return <td key={c.id} className={`px-3 text-center font-mono ${p.done === p.total ? 'text-muted' : ''}`}>
                      {p.total === 0 ? '–' : p.done === p.total ? '✓' : `${p.done}/${p.total}`}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
    <PrintTally contest={contest} banner={banner} sections={sections} names={names} />
  </>)
}

// ── Printed tally: its own layout (landscape, set in src/index.css), never the screen tables. A summary, then one
// block per contestant with every judge's category scores; blocks and rows never split across pages.
type TallySection = { title: string; result: Result; categories: Named[]; note: string; thresholdPct?: number | null; finalists?: string[] | null }

// The judges who appear in any category, then the cross-panel average and producer entries.
function breakdownColumns(result: Result, names: Names) {
  const present = new Set(result.standings.flatMap(s => Object.values(s.breakdown).flat().map(b => b.judgeId)))
  return [...names.judges.map(j => j.id), CROSS_PANEL, PRODUCER].filter(id => present.has(id))
}

function PrintTally({ contest, banner, sections, names }: { contest: Contest; banner: ReactNode; sections: TallySection[]; names: Names }) {
  const name = (id: string) => names.contestants.get(id) ?? 'Unknown'
  const judge = new Map(names.judges.map(j => [j.id, j]))
  const judgeName = (id: string) => id === CROSS_PANEL ? 'Cross-panel avg' : id === PRODUCER ? 'Producer' : judge.get(id)?.name ?? ''
  const cell = 'border border-rule px-1.5 py-0.5'
  return (
    <div className="hidden text-[9pt] leading-snug print:block">
      <header className="flex items-end justify-between gap-4 border-b-2 border-fg pb-2">
        <div>
          <p className="text-muted">{contest.events?.name}</p>
          <h1 className="font-display text-2xl font-extrabold uppercase">{contest.name}: tally</h1>
        </div>
        <p className="text-right text-muted">
          Printed {new Date().toLocaleString()}<br />
          {contest.finalized_at ? `Finalized ${new Date(contest.finalized_at).toLocaleString()}` : 'Not finalized: results may still change'}
        </p>
      </header>
      <p className="my-3 text-[11pt]">{banner}</p>

      {sections.map(sec => {
        const threshold = sec.result.thresholdPoints
        return (
          <section key={sec.title} className="mt-4">
            <h2 className="text-[11pt] font-semibold uppercase tracking-wider">{sec.title}</h2>
            <p className="mb-1.5 text-muted">
              Max possible {fmt(sec.result.maxPossible)} pts
              {threshold != null && <> · minimum to win {fmt(threshold)} ({sec.thresholdPct}%)</>} · {sec.note}
            </p>
            <table className="w-full border-collapse">
              <thead>
                <tr className="align-bottom">
                  <th className={`${cell} text-left`}>Rank</th><th className={`${cell} text-left`}>Contestant</th>
                  {sec.categories.map(c => <th key={c.id} className={`${cell} text-right font-normal`}>{c.name}</th>)}
                  <th className={`${cell} text-right`}>Total</th><th className={`${cell} text-right`}>%</th>
                </tr>
              </thead>
              <tbody>
                {sec.result.standings.map(s => (
                  <tr key={s.contestantId} className={`break-inside-avoid ${threshold != null && s.total < threshold ? 'text-muted' : ''}`}>
                    <td className={`${cell} font-mono`}>{s.rank}</td>
                    <td className={cell}>{name(s.contestantId)}{sec.finalists?.includes(s.contestantId) && ' (finalist)'}
                      {threshold != null && s.total < threshold && <span className="text-[8pt]"> · below minimum</span>}</td>
                    {sec.categories.map(c => <td key={c.id} className={`${cell} text-right font-mono`}>{fmt(s.categoryTotals[c.id] ?? 0)}</td>)}
                    <td className={`${cell} text-right font-mono font-semibold`}>{fmt(s.total)}</td>
                    <td className={`${cell} text-right font-mono`}>{pct(s.pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )
      })}

      <footer className="mt-10 grid break-inside-avoid grid-cols-3 gap-8">
        {['Tally master', 'Head judge', 'Date'].map(l => <p key={l} className="border-t border-fg pt-1 text-muted">{l}</p>)}
      </footer>

      {/* One page per contestant: every judge's score per category. */}
      {sections.flatMap(sec => {
        const cols = breakdownColumns(sec.result, names)
        return sec.result.standings.map(s => (
          <section key={`${sec.title}|${s.contestantId}`} className="break-before-page text-[10pt]">
            <header className="flex items-end justify-between gap-4 border-b-2 border-fg pb-2">
              <div>
                <p className="text-muted">{contest.name}{sections.length > 1 && ` · ${sec.title}`}</p>
                <h2 className="font-display text-2xl font-extrabold uppercase">{name(s.contestantId)}</h2>
              </div>
              <p className="text-right text-[11pt]">
                Rank <strong>{s.rank}</strong> of {sec.result.standings.length} · <strong>{fmt(s.total)}</strong> pts ({pct(s.pct)})
              </p>
            </header>
            <table className="mt-3 w-full border-collapse">
              <thead>
                <tr className="align-bottom text-[9pt]">
                  <th className={`${cell} w-44 text-left font-normal`}>Category</th>
                  {cols.map(id => (
                    <th key={id} className={`${cell} text-right font-normal`}>
                      {judgeName(id)}{judge.get(id)?.guest && <span className="block text-muted">cross-panel</span>}
                    </th>
                  ))}
                  <th className={`${cell} text-right`}>Counted</th>
                </tr>
              </thead>
              <tbody>
                {sec.categories.map(c => (
                  <tr key={c.id}>
                    <th className={`${cell} py-1 text-left font-normal`}>{c.name}</th>
                    {cols.map(id => {
                      const b = s.breakdown[c.id]?.find(x => x.judgeId === id)
                      return (
                        <td key={id} className={`${cell} text-right font-mono ${b?.dropped ? 'text-muted line-through' : ''}`}>
                          {b ? (b.subtotal == null ? '–' : fmt(b.subtotal)) : ''}{b?.backfilled && <sup>avg</sup>}
                        </td>
                      )
                    })}
                    <td className={`${cell} text-right font-mono font-semibold`}>{fmt(s.categoryTotals[c.id] ?? 0)}</td>
                  </tr>
                ))}
                <tr>
                  <th colSpan={cols.length + 1} className={`${cell} py-1 text-right`}>Total</th>
                  <td className={`${cell} text-right font-mono font-semibold`}>{fmt(s.total)}</td>
                </tr>
              </tbody>
            </table>
            {s.deductions.length > 0 && (
              <p className="mt-2">Deductions (already taken off Counted): {s.deductions.map(d => `${sec.categories.find(c => c.id === d.categoryId)?.name ?? ''} −${fmt(d.amount)} (${d.label})`).join(', ')}</p>
            )}
            {s.tiebreakPath && <p className="mt-2">Tiebreak: {s.tiebreakPath.map(p => `step ${p.step} = ${fmt(p.value)}`).join(', ')}</p>}
            <p className="mt-3 text-[9pt] text-muted">
              <s>Struck-through</s> scores were dropped. <sup>avg</sup> marks a recused judge's slot, filled with the other judges' average.
              Counted is the category score after drops and deductions.
            </p>
          </section>
        ))
      })}
    </div>
  )
}

type TableProps = {
  title: string; result: Result; names: Names; categories: Named[]; note: string
  thresholdPct?: number | null; cutAfter?: number; finalists?: string[] | null
}

function StandingsTable({ title, result, names, categories, note, thresholdPct, cutAfter, finalists }: TableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const name = (id: string) => names.contestants.get(id) ?? 'Unknown'
  const judgeName = new Map<string, string>([...names.judges.map(j => [j.id, j.name] as const), [CROSS_PANEL, 'Cross-panel'], [PRODUCER, 'Producer']])
  const breakdownCols = breakdownColumns(result, names)
  const firstBelow = result.thresholdPoints == null ? -1 : result.standings.findIndex(s => s.total < result.thresholdPoints!)
  // The cut line sits after the last contestant ranked within the top N (ties at the line sit below it).
  // Once finalists are confirmed a tie can put a finalist below a non-finalist, so the badge and muting say it instead.
  const firstOut = cutAfter == null || finalists ? -1 : result.standings.findIndex(s => s.rank > cutAfter)
  const cols = categories.length + 5
  const toggle = (id: string) => setExpanded(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <section className="grid gap-2">
      <h2 className={h2}>{title}</h2>
      <p className="text-sm text-muted">
        Max possible {fmt(result.maxPossible)} pts
        {result.thresholdPoints != null && <> · minimum to win {fmt(result.thresholdPoints)} ({thresholdPct}%)</>}
        {' · '}{note}
      </p>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr className="border-b border-rule">
              <th className="px-3 py-2 font-normal">Rank</th><th className="px-3 font-normal">Contestant</th>
              {categories.map(c => <th key={c.id} className="px-3 text-right font-normal">{c.name}</th>)}
              <th className="px-3 text-right font-normal">Total</th><th className="px-3 text-right font-normal">%</th>
              <th className="px-3 text-right font-normal print:hidden">Scores in</th>
            </tr>
          </thead>
          <tbody>
            {result.standings.map((s, i) => (
              <Fragment key={s.contestantId}>
                {i === firstOut && (
                  <tr><td colSpan={cols} className="border-t-2 border-dashed border-accent px-3 py-1 text-xs text-accent">
                    Top {cutAfter} advance to the finals</td></tr>
                )}
                {i === firstBelow && (
                  <tr><td colSpan={cols} className="border-t-2 border-dashed border-danger px-3 py-1 text-xs text-danger">
                    Below the {thresholdPct}% minimum</td></tr>
                )}
                <tr className={`border-b border-rule ${(firstBelow !== -1 && i >= firstBelow) || (firstOut !== -1 && i >= firstOut) || (finalists && !finalists.includes(s.contestantId)) ? 'text-muted' : ''}`}>
                  <td className="px-3 py-2 font-mono">{s.rank}</td>
                  <td className="px-3">
                    <button className="text-left hover:text-accent print:pointer-events-none" aria-expanded={expanded.has(s.contestantId)} onClick={() => toggle(s.contestantId)}>
                      <span className="print:hidden">{expanded.has(s.contestantId) ? '▾' : '▸'} </span>{name(s.contestantId)}
                      {finalists?.includes(s.contestantId) && <span className="ml-2 font-mono text-xs text-accent">finalist</span>}
                    </button>
                  </td>
                  {categories.map(c => <td key={c.id} className="px-3 text-right font-mono">{fmt(s.categoryTotals[c.id] ?? 0)}</td>)}
                  <td className="px-3 text-right font-mono font-semibold">{fmt(s.total)}</td>
                  <td className="px-3 text-right font-mono">{pct(s.pct)}</td>
                  <td className="px-3 text-right font-mono print:hidden">{Math.round(s.completeness * 100)}%</td>
                </tr>
                <tr className={`border-b border-rule bg-bg ${expanded.has(s.contestantId) ? '' : 'hidden print:table-row'}`}>
                  <td />
                  <td colSpan={cols - 1} className="px-3 py-2">
                    <table className="text-xs">
                      <thead><tr className="text-muted"><th />{breakdownCols.map(id => <th key={id} className="px-2 font-normal">{judgeName.get(id)}</th>)}</tr></thead>
                      <tbody>
                        {categories.map(c => (
                          <tr key={c.id}>
                            <th className="pr-3 text-left font-normal text-muted">{c.name}</th>
                            {breakdownCols.map(id => {
                              const b = s.breakdown[c.id]?.find(x => x.judgeId === id)
                              if (!b) return <td key={id} />
                              return (
                                <td key={id} className={`px-2 text-right font-mono ${b.dropped ? 'text-muted line-through' : ''}`}
                                  title={[b.dropped && 'Dropped', b.backfilled && `${judgeName.get(b.judgeId)} is recused; filled with the others' average`].filter(Boolean).join('. ') || undefined}>
                                  {b.subtotal == null ? '–' : fmt(b.subtotal)}{b.backfilled && <sup>avg</sup>}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {s.deductions.length > 0 && (
                      <p className="mt-2 text-xs text-danger">
                        Deductions: {s.deductions.map(d => `${categories.find(c => c.id === d.categoryId)?.name ?? ''} −${fmt(d.amount)} (${d.label})`).join(', ')}
                      </p>
                    )}
                    {s.tiebreakPath && (
                      <p className="mt-2 text-xs text-muted">Tiebreak: {s.tiebreakPath.map(p => `step ${p.step} = ${fmt(p.value)}`).join(', ')}</p>
                    )}
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted print:hidden">Click a name for each judge's category totals. Struck-through values were dropped; <sup>avg</sup> marks a recused judge's filled-in slot.</p>
    </section>
  )
}
