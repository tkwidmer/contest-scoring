// Scoring engine. Pure functions only: no I/O, no Supabase. Spec: docs/design/02-scoring-engine.md
// All arithmetic runs in integer hundredths so ties are exact (assumption A2).

export type Aggregation = 'sum' | 'drop_high_low'

export type ScoringInput = {
  aggregation: Aggregation
  thresholdPct: number | null
  categories: { id: string; name: string; components: { id: string; min: number; max: number; step: number }[] }[]
  tiebreakSteps: string[][] // ordered lists of category ids
  judges: { id: string }[]
  contestants: { id: string; withdrawn: boolean }[]
  recusals: { judgeId: string; contestantId: string }[]
  scores: { judgeId: string; contestantId: string; componentId: string; value: number }[]
  manualWinnerId?: string | null
}

export type Standing = {
  contestantId: string
  rank: number
  total: number
  pct: number
  categoryTotals: Record<string, number>
  completeness: number // 0..1 of expected score cells (recused cells count once backfilled)
  // Per category, one entry per judge (input order). subtotal is null until all of that judge's components are in.
  breakdown: Record<string, { judgeId: string; subtotal: number | null; dropped: boolean; backfilled: boolean }[]>
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
  breakdown: Standing['breakdown']
  completeness: number
  complete: boolean
  path: { step: number; value: number }[]
  rank: number
}

const toH = (n: number) => Math.round(n * 100)
const fromH = (n: number) => n / 100
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

export function computeResults(input: ScoringInput): Result {
  const warnings: string[] = []
  const judges = input.judges.map(j => j.id)
  const J = judges.length

  let aggregation = input.aggregation
  if (aggregation === 'drop_high_low' && J < 5) {
    warnings.push(`Drop high & low needs at least 5 judges (this contest has ${J}), so scores are summed instead.`)
    aggregation = 'sum'
  }

  const components = input.categories.flatMap(c => c.components)
  const maxH = new Map(components.map(c => [c.id, toH(c.max)]))
  const countedJudges = aggregation === 'drop_high_low' ? J - 2 : J
  const maxPossibleH = countedJudges * sum(components.map(c => toH(c.max)))

  const score = new Map(input.scores.map(s => [`${s.judgeId}|${s.contestantId}|${s.componentId}`, toH(s.value)]))
  const recused = new Set(input.recusals.map(r => `${r.judgeId}|${r.contestantId}`))

  const rows: Row[] = input.contestants.filter(c => !c.withdrawn).map(({ id: cid }) => {
    // values[judge][component], with recusals backfilled by the others' mean (A1, A2)
    const values = judges.map(j => {
      const byComp = new Map<string, number>()
      for (const comp of components) {
        if (recused.has(`${j}|${cid}`)) {
          const others = judges
            .filter(o => !recused.has(`${o}|${cid}`))
            .map(o => score.get(`${o}|${cid}|${comp.id}`))
            .filter((v): v is number => v !== undefined)
          // ponytail: Math.round is half-up only for non-negative scores; fine while min >= 0
          if (others.length) byComp.set(comp.id, Math.round(sum(others) / others.length))
        } else {
          const v = score.get(`${j}|${cid}|${comp.id}`)
          if (v !== undefined) byComp.set(comp.id, v)
        }
      }
      return byComp
    })

    const expected = J * components.length
    const filled = sum(values.map(v => v.size))
    const complete = expected > 0 && filled === expected

    const catH: Record<string, number> = {}
    const breakdown: Standing['breakdown'] = {}
    for (const cat of input.categories) {
      const subtotals = values.map(v => sum(cat.components.map(c => v.get(c.id) ?? 0)))
      const dropped = new Set<number>()
      if (complete && aggregation === 'drop_high_low') {
        // Drop exactly one high and one low (A1); among equal values the first judge in order is the one marked.
        const order = subtotals.map((_, i) => i).sort((a, b) => subtotals[a]! - subtotals[b]! || a - b)
        dropped.add(order[0]!).add(order[order.length - 1]!)
      }
      catH[cat.id] = sum(subtotals.filter((_, i) => !dropped.has(i)))
      breakdown[cat.id] = judges.map((j, i) => ({
        judgeId: j,
        subtotal: cat.components.every(c => values[i]!.has(c.id)) ? fromH(subtotals[i]!) : null,
        dropped: dropped.has(i),
        backfilled: recused.has(`${j}|${cid}`),
      }))
    }
    const totalH = sum(Object.values(catH))

    // Incomplete contestants are compared by % of the points they could have earned so far.
    const denomH = complete ? maxPossibleH : sum(values.flatMap(v => [...v.keys()].map(k => maxH.get(k)!)))

    return {
      id: cid,
      totalH,
      pct: denomH ? totalH / denomH : 0,
      catH,
      breakdown,
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
    const value = (r: Row) => sum(step.map(catId => r.catH[catId] ?? 0))
    for (const r of group) r.path.push({ step: stepIdx + 1, value: fromH(value(r)) })
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
  } else if (thresholdPct != null && top[0]!.totalH * 100 < maxPossibleH * thresholdPct) {
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
    maxPossible: fromH(maxPossibleH),
    thresholdPoints: thresholdPct == null ? null : fromH(maxPossibleH) * thresholdPct / 100,
    standings: groups.flat().map(r => ({
      contestantId: r.id,
      rank: r.rank,
      total: fromH(r.totalH),
      pct: r.pct,
      categoryTotals: Object.fromEntries(Object.entries(r.catH).map(([k, v]) => [k, fromH(v)])),
      completeness: r.completeness,
      breakdown: r.breakdown,
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
