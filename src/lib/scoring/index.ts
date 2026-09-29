// Scoring engine. Pure functions only: no I/O, no Supabase. Spec: docs/design/02-scoring-engine.md
// All arithmetic runs in integer hundredths so ties are exact (assumption A2).

// sum: every judge counts. drop_high_low: each category drops its highest and lowest judge (IMBB, IML prelims).
// drop_high_low_total: drop the two judges whose overall totals are highest and lowest (IML finals).
export type Aggregation = 'sum' | 'drop_high_low' | 'drop_high_low_total'

// A tiebreak step re-totals the listed categories. allJudges adds the dropped high and low scores back in.
// Categories not in the round being computed contribute nothing, so one step list serves prelims and finals.
export type TiebreakStep = { categoryIds: string[]; allJudges: boolean }

// A tally-master deduction a category allows, e.g. overtime. points come off the category on the scale the
// contest reports (per-judge average or sum); percent comes off the category's aggregated score.
export type Deduction = { label: string; points?: number; percent?: number }

export type Category = {
  id: string
  name: string
  components: { id: string; min: number; max: number; step: number }[]
  // producer: one score per contestant, e.g. a community vote. cross_panel: only the cross-panel (guest) judges
  // score it, as their own panel: high and low drop when the contest drops them and there are at least 5 guests.
  scoredBy?: 'judges' | 'producer' | 'cross_panel'
  guestAverage?: boolean // panel categories only: the guests' average counts as one more judge
  deductions?: Deduction[]
}

export type ScoringInput = {
  aggregation: Aggregation
  thresholdPct: number | null
  thresholdSingleOnly?: boolean // the minimum applies only when there is a single contestant
  reportAs?: 'total' | 'average' // average: each category is the average of its counted judges
  categories: Category[]
  tiebreakSteps: TiebreakStep[]
  judges: { id: string; guest?: boolean }[]
  contestants: { id: string; withdrawn: boolean }[]
  recusals: { judgeId: string; contestantId: string }[]
  scores: { judgeId: string | null; contestantId: string; componentId: string; value: number }[] // null judge: producer-scored
  penalties?: { contestantId: string; categoryId: string; tier: number }[]
  manualWinnerId?: string | null
}

// Breakdown column for the cross-panel average and for producer-entered scores.
export const CROSS_PANEL = 'cross-panel'
export const PRODUCER = 'producer'

export type Standing = {
  contestantId: string
  rank: number
  total: number
  pct: number
  categoryTotals: Record<string, number>
  completeness: number // 0..1 of expected score cells (recused cells count once backfilled)
  // Per category, one entry per judge (input order, then the cross-panel average), or a single PRODUCER entry.
  // subtotal is null until all of that judge's components are in.
  breakdown: Record<string, { judgeId: string; subtotal: number | null; dropped: boolean; backfilled: boolean }[]>
  deductions: { categoryId: string; label: string; amount: number }[] // on the reported scale
  tiebreakPath?: { step: number; value: number }[]
}

export type Winner =
  | { kind: 'decided'; contestantId: string; manual?: boolean }
  | { kind: 'no_title'; reason: 'below_threshold' }
  | { kind: 'tie_unresolved'; contestantIds: string[] }
  | { kind: 'incomplete'; projectedId: string | null }

export type Result = {
  maxPossible: number
  thresholdPoints: number | null
  standings: Standing[]
  winner: Winner
  warnings: string[]
}

type Row = {
  id: string
  totalH: number
  pct: number
  catH: Record<string, number>
  fullCatH: Record<string, number> // every judge counted
  breakdown: Standing['breakdown']
  deductions: { categoryId: string; label: string; amountU: number }[]
  completeness: number
  complete: boolean
  path: { step: number; value: number }[]
  rank: number
}

const toH = (n: number) => Math.round(n * 100)
const fromH = (n: number) => n / 100
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
const lcm = (xs: number[]) => xs.reduce((a, b) => (a * b) / gcd(a, b), 1)

export function computeResults(input: ScoringInput): Result {
  const warnings: string[] = []
  const panel = input.judges.filter(j => !j.guest).map(j => j.id)
  const guests = input.judges.filter(j => j.guest).map(j => j.id)
  const J = panel.length

  let aggregation = input.aggregation
  if (aggregation !== 'sum' && J < 5) {
    warnings.push(`Drop high & low needs at least 5 judges (this contest has ${J}), so scores are summed instead.`)
    aggregation = 'sum'
  }

  const judgeCats = input.categories.filter(c => c.scoredBy !== 'producer')
  const producerCats = input.categories.filter(c => c.scoredBy === 'producer')
  const isCross = (c: Category) => c.scoredBy === 'cross_panel'
  const components = judgeCats.filter(c => !isCross(c)).flatMap(c => c.components)
  const crossComponents = judgeCats.filter(isCross).flatMap(c => c.components)
  const G = guests.length
  const crossDrop = input.aggregation !== 'sum' && G >= 5
  if (crossComponents.length && G === 0) warnings.push('Some categories are scored by cross-panel judges, but none are listed, so those categories count for nothing.')
  else if (crossComponents.length && input.aggregation !== 'sum' && !crossDrop)
    warnings.push(`Dropping the high & low cross-panel score needs at least 5 cross-panel judges (this contest has ${G}), so their scores are summed instead.`)
  const maxH = new Map(input.categories.flatMap(c => c.components).map(c => [c.id, toH(c.max)]))
  const catMaxH = (c: Category) => sum(c.components.map(k => maxH.get(k.id)!))
  const hasVirtual = (c: Category) => !isCross(c) && !!c.guestAverage && G > 0
  const slots = (c: Category) => (isCross(c) ? G : J + (hasVirtual(c) ? 1 : 0))
  const counted = (c: Category) => (isCross(c) ? (crossDrop ? G - 2 : G) : aggregation === 'sum' ? slots(c) : slots(c) - 2)

  // Internal unit: hundredths x U. Reporting averages divides each category by its judge count, so everything is
  // multiplied by the lcm of those counts to stay in whole numbers (ties remain exact).
  const average = input.reportAs === 'average'
  const U = average ? lcm(judgeCats.flatMap(c => [counted(c), slots(c)]).filter(n => n > 0)) : 1
  const per = (n: number) => (n > 0 ? U / (average ? n : 1) : 0) // multiplier for a category summed over n judges
  const toU = (h: number) => h * U // producer scores and point deductions sit on the reported scale
  const fromU = (x: number) => x / (100 * U)
  const maxPossibleU = sum(judgeCats.map(c => counted(c) * catMaxH(c) * per(counted(c)))) + sum(producerCats.map(c => toU(catMaxH(c))))

  const score = new Map(input.scores.map(s => [`${s.judgeId ?? PRODUCER}|${s.contestantId}|${s.componentId}`, toH(s.value)]))
  const recused = new Set(input.recusals.map(r => `${r.judgeId}|${r.contestantId}`))
  const mean = (xs: number[]) => Math.round(sum(xs) / xs.length) // ponytail: half-up only for non-negative scores

  const rows: Row[] = input.contestants.filter(c => !c.withdrawn).map(({ id: cid }) => {
    // values[judge][component] for one panel, recusals backfilled by the mean of that panel's other judges (A1, A2)
    const fill = (who: string[], comps: Category['components']) => who.map(j => {
      const byComp = new Map<string, number>()
      for (const comp of comps) {
        if (recused.has(`${j}|${cid}`)) {
          const others = who.filter(o => !recused.has(`${o}|${cid}`))
            .map(o => score.get(`${o}|${cid}|${comp.id}`)).filter((v): v is number => v !== undefined)
          if (others.length) byComp.set(comp.id, mean(others))
        } else {
          const v = score.get(`${j}|${cid}|${comp.id}`)
          if (v !== undefined) byComp.set(comp.id, v)
        }
      }
      return byComp
    })
    const values = fill(panel, components)
    const guestValues = fill(guests, crossComponents)
    // The cross-panel average: one extra "judge" in guest-average categories, present once every
    // non-recused guest has scored.
    const virtual = new Map<string, number>()
    const presentGuests = guests.filter(g => !recused.has(`${g}|${cid}`))
    let guestFilled = 0, guestExpected = 0
    for (const c of judgeCats.filter(hasVirtual)) for (const comp of c.components) {
      const vs = presentGuests.map(g => score.get(`${g}|${cid}|${comp.id}`)).filter((v): v is number => v !== undefined)
      guestFilled += vs.length
      guestExpected += presentGuests.length
      if (vs.length && vs.length === presentGuests.length) virtual.set(comp.id, mean(vs))
    }
    const producerComps = producerCats.flatMap(c => c.components)
    const producerFilled = producerComps.filter(k => score.has(`${PRODUCER}|${cid}|${k.id}`)).length

    const expected = J * components.length + G * crossComponents.length + guestExpected + producerComps.length
    const filled = sum([...values, ...guestValues].map(v => v.size)) + guestFilled + producerFilled
    const complete = expected > 0 && filled === expected

    // Drop exactly one high and one low (A1); among equal values the first judge in order is the one marked.
    const highLow = (xs: number[]) => {
      const order = xs.map((_, i) => i).sort((a, b) => xs[a]! - xs[b]! || a - b)
      return new Set([order[0]!, order[order.length - 1]!])
    }
    const judgeTotals = values.map(v => sum([...v.values()]))
    const droppedByTotal = complete && aggregation === 'drop_high_low_total' ? highLow(judgeTotals) : new Set<number>()
    const myPenalties = (input.penalties ?? []).filter(p => p.contestantId === cid)

    const catH: Record<string, number> = {}
    const fullCatH: Record<string, number> = {}
    const breakdown: Standing['breakdown'] = {}
    const deductions: Row['deductions'] = []
    let denomU = 0 // points possible on what's been entered, for comparing incomplete contestants

    // Deductions come off after aggregation; the every-judge figure used by tiebreaks gets the same deductions.
    const deduct = (c: Category, v: number, full: number) => {
      for (const p of myPenalties.filter(p => p.categoryId === c.id)) {
        const d = c.deductions?.[p.tier]
        if (!d) continue
        const off = (x: number) => (d.percent != null ? Math.round((x * d.percent) / 100) : toU(toH(d.points ?? 0)))
        const amount = Math.min(v, off(v))
        deductions.push({ categoryId: c.id, label: d.label, amountU: amount })
        v -= amount
        full -= Math.min(full, off(full))
      }
      catH[c.id] = v
      fullCatH[c.id] = full
    }

    for (const cat of judgeCats) {
      const cross = isCross(cat)
      const [who, vals] = cross ? [guests, guestValues] : [panel, values]
      const subtotals = vals.map(v => sum(cat.components.map(c => v.get(c.id) ?? 0)))
      const has = vals.map(v => cat.components.every(c => v.has(c.id)))
      if (hasVirtual(cat)) {
        subtotals.push(sum(cat.components.map(c => virtual.get(c.id) ?? 0)))
        has.push(cat.components.every(c => virtual.has(c.id)))
      }
      // A category drops its high and low as soon as every judge's scores for it are in. A cross-panel category
      // always drops within its own category, whichever way the panel drops.
      const catComplete = subtotals.length > 0 && has.every(Boolean)
      const dropped = cross ? (crossDrop && catComplete ? highLow(subtotals) : new Set<number>())
        : aggregation === 'drop_high_low' && catComplete ? highLow(subtotals) : droppedByTotal
      const kept = subtotals.length - dropped.size
      deduct(cat, sum(subtotals.filter((_, i) => !dropped.has(i))) * per(kept), sum(subtotals) * per(subtotals.length))
      const enteredMaxH = sum(vals.flatMap(v => cat.components.filter(c => v.has(c.id)).map(c => maxH.get(c.id)!)))
        + (hasVirtual(cat) ? sum(cat.components.filter(c => virtual.has(c.id)).map(c => maxH.get(c.id)!)) : 0)
      denomU += dropped.size ? kept * catMaxH(cat) * per(kept) : enteredMaxH * per(subtotals.length)
      breakdown[cat.id] = subtotals.map((st, i) => ({
        judgeId: i < who.length ? who[i]! : CROSS_PANEL,
        subtotal: has[i] ? fromH(st) : null,
        dropped: dropped.has(i),
        backfilled: i < who.length && recused.has(`${who[i]}|${cid}`),
      }))
    }

    for (const cat of producerCats) {
      const has = cat.components.every(k => score.has(`${PRODUCER}|${cid}|${k.id}`))
      const vH = sum(cat.components.map(k => score.get(`${PRODUCER}|${cid}|${k.id}`) ?? 0))
      deduct(cat, toU(vH), toU(vH))
      denomU += toU(sum(cat.components.filter(k => score.has(`${PRODUCER}|${cid}|${k.id}`)).map(k => maxH.get(k.id)!)))
      breakdown[cat.id] = [{ judgeId: PRODUCER, subtotal: has ? fromH(vH) : null, dropped: false, backfilled: false }]
    }

    const totalH = sum(Object.values(catH))
    // Incomplete contestants are compared by % of the points they could have earned so far.
    if (complete) denomU = maxPossibleU

    return {
      id: cid,
      totalH,
      pct: denomU ? totalH / denomU : 0,
      catH,
      fullCatH,
      breakdown,
      deductions,
      completeness: expected ? filled / expected : 0,
      complete,
      path: [],
      rank: 0,
    }
  })

  const allComplete = rows.length > 0 && rows.every(r => r.complete)

  const split = (group: Row[], key: (r: Row) => number): Row[][] => {
    const byKey = new Map<number, Row[]>()
    for (const r of group) byKey.set(key(r), [...(byKey.get(key(r)) ?? []), r])
    return [...byKey.entries()].sort((a, b) => b[0] - a[0]).map(([, g]) => g)
  }

  const resolve = (group: Row[], stepIdx: number): Row[][] => {
    const step = input.tiebreakSteps[stepIdx]
    // Tiebreaks need real category totals, so they only apply when everyone in the tied group is fully scored.
    if (group.length < 2 || group.some(r => !r.complete) || !step) return [group]
    const value = (r: Row) => sum(step.categoryIds.map(catId => (step.allJudges ? r.fullCatH : r.catH)[catId] ?? 0))
    for (const r of group) r.path.push({ step: stepIdx + 1, value: fromU(value(r)) })
    return split(group, value).flatMap(g => resolve(g, stepIdx + 1))
  }

  const groups = split(rows, r => (allComplete ? r.totalH : r.pct)).flatMap(g => resolve(g, 0))
  let rank = 1
  for (const g of groups) {
    for (const r of g) r.rank = rank
    rank += g.length
  }

  const thresholdPct = input.thresholdPct
  const top = groups[0] ?? []
  let winner: Winner
  if (!allComplete) {
    winner = { kind: 'incomplete', projectedId: top[0]?.id ?? null }
  } else if (thresholdPct != null && (!input.thresholdSingleOnly || rows.length === 1) && top[0]!.totalH * 100 < maxPossibleU * thresholdPct) {
    winner = { kind: 'no_title', reason: 'below_threshold' }
  } else if (top.length > 1) {
    const manual = top.find(r => r.id === input.manualWinnerId)
    winner = manual
      ? { kind: 'decided', contestantId: manual.id, manual: true }
      : { kind: 'tie_unresolved', contestantIds: top.map(r => r.id) }
  } else {
    winner = { kind: 'decided', contestantId: top[0]!.id }
  }

  return {
    maxPossible: fromU(maxPossibleU),
    thresholdPoints: thresholdPct == null || (input.thresholdSingleOnly && rows.length !== 1) ? null : fromU(maxPossibleU) * thresholdPct / 100,
    standings: groups.flat().map(r => ({
      contestantId: r.id,
      rank: r.rank,
      total: fromU(r.totalH),
      pct: r.pct,
      categoryTotals: Object.fromEntries(Object.entries(r.catH).map(([k, v]) => [k, fromU(v)])),
      completeness: r.completeness,
      breakdown: r.breakdown,
      deductions: r.deductions.map(d => ({ categoryId: d.categoryId, label: d.label, amount: fromU(d.amountU) })),
      ...(r.path.length ? { tiebreakPath: r.path } : {}),
    })),
    winner,
    warnings,
  }
}

// Default tiebreak steps from a drop order (dropRank 1 = dropped first). Unranked categories are never dropped.
// Producers can edit the generated steps; the engine only reads the stored ones.
export function generateTiebreakSteps(categories: { id: string; dropRank: number | null }[]): string[][] {
  const dropOrder = categories
    .filter(c => c.dropRank != null)
    .sort((a, b) => a.dropRank! - b.dropRank!)
    .map(c => c.id)
  const steps: string[][] = []
  for (let k = 1; k <= dropOrder.length; k++) {
    const dropped = new Set(dropOrder.slice(0, k))
    const kept = categories.filter(c => !dropped.has(c.id)).map(c => c.id)
    if (kept.length === 0) break
    steps.push(kept)
  }
  return steps
}

// ── Two rounds: prelims cut to the top N, then finals ─────────────────────────
export type Rounds = {
  prelimCategoryIds: string[]
  prelimAggregation: Aggregation
  finalistCount: number
  carryPrelim: boolean // prelim scores count in the finals (IMBB) or not (IML)
  finalistIds: string[] | null // confirmed finalists; null until the producer confirms the cut
  manualFinalistIds?: string[] // producer's picks from a tie at the cut line
}

export type Cut = {
  complete: boolean // every prelim score is in
  certain: string[] // above the cut line
  tied: string[] // a tie straddling the line that survived every tiebreak step
  slots: number // how many of the tied group advance
  proposed: string[] | null // full finalist list, or null while incomplete or the tie is unresolved
}

export type ContestResult = { prelim: (Result & { cut: Cut }) | null; final: Result | null }

export function computeContest(input: ScoringInput, rounds: Rounds | null): ContestResult {
  if (!rounds) return { prelim: null, final: computeResults(input) }

  const inPrelim = new Set(rounds.prelimCategoryIds)
  const prelim = computeResults({
    ...input,
    aggregation: rounds.prelimAggregation,
    categories: input.categories.filter(c => inPrelim.has(c.id)),
    thresholdPct: null,
    manualWinnerId: null,
  })

  const n = rounds.finalistCount
  const certain: string[] = []
  let tied: string[] = []
  for (const s of prelim.standings) {
    const group = prelim.standings.filter(x => x.rank === s.rank)
    if (s.rank + group.length - 1 <= n) certain.push(s.contestantId)
    else if (s.rank <= n) tied = group.map(x => x.contestantId)
  }
  const slots = n - certain.length
  const complete = prelim.winner.kind !== 'incomplete'
  const picks = (rounds.manualFinalistIds ?? []).filter(id => tied.includes(id))
  const proposed = !complete ? null
    : tied.length === 0 ? certain
    : picks.length === slots ? [...certain, ...picks]
    : null

  const finalist = new Set(rounds.finalistIds ?? [])
  const final = rounds.finalistIds && computeResults({
    ...input,
    categories: rounds.carryPrelim ? input.categories : input.categories.filter(c => !inPrelim.has(c.id)),
    contestants: input.contestants.map(c => ({ ...c, withdrawn: c.withdrawn || !finalist.has(c.id) })),
  })

  return { prelim: { ...prelim, cut: { complete, certain, tied, slots, proposed } }, final }
}
