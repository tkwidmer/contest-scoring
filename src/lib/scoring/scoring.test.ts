// Edge-case fixtures from docs/design/02-scoring-engine.md, numbered to match that list.
import { describe, expect, it } from 'vitest'
import { computeResults, generateTiebreakSteps, type Aggregation, type ScoringInput } from './index'

type Spec = {
  judges: number
  aggregation?: Aggregation
  thresholdPct?: number | null
  // category -> component -> max (min 0, step 0.5)
  categories: Record<string, Record<string, number>>
  // contestant -> component -> one value per judge (null = not entered)
  scores: Record<string, Record<string, (number | null)[]>>
  recusals?: [judgeNo: number, contestant: string][]
  steps?: string[][]
  withdrawn?: string[]
  manualWinnerId?: string
}

function build(s: Spec): ScoringInput {
  const judges = Array.from({ length: s.judges }, (_, i) => ({ id: `J${i + 1}` }))
  return {
    aggregation: s.aggregation ?? 'sum',
    thresholdPct: s.thresholdPct ?? null,
    categories: Object.entries(s.categories).map(([cat, comps]) => ({
      id: cat,
      name: cat,
      components: Object.entries(comps).map(([id, max]) => ({ id, min: 0, max, step: 0.5 })),
    })),
    tiebreakSteps: s.steps ?? [],
    judges,
    contestants: Object.keys(s.scores).map(id => ({ id, withdrawn: s.withdrawn?.includes(id) ?? false })),
    recusals: (s.recusals ?? []).map(([n, c]) => ({ judgeId: `J${n}`, contestantId: c })),
    scores: Object.entries(s.scores).flatMap(([cid, comps]) =>
      Object.entries(comps).flatMap(([componentId, vals]) =>
        vals.flatMap((value, i) => (value == null ? [] : [{ judgeId: `J${i + 1}`, contestantId: cid, componentId, value }])),
      ),
    ),
    manualWinnerId: s.manualWinnerId,
  }
}

const rankOf = (r: ReturnType<typeof computeResults>) => Object.fromEntries(r.standings.map(s => [s.contestantId, s.rank]))
const totalOf = (r: ReturnType<typeof computeResults>) => Object.fromEntries(r.standings.map(s => [s.contestantId, s.total]))

// Worked example from the design doc: 5 judges, drop high/low, J5 recused from B, 70% threshold.
const worked: Spec = {
  judges: 5,
  aggregation: 'drop_high_low',
  thresholdPct: 70,
  categories: { Speech: { Content: 10, Delivery: 10 }, Interview: { Overall: 20 }, Fantasy: { Presentation: 10 } },
  scores: {
    A: { Content: [8, 9, 8, 8, 6], Delivery: [8, 9, 7, 9, 6], Overall: [15, 16, 14, 18, 13], Presentation: [8, 8, 9, 6, 8] },
    B: { Content: [8, 9, 8, 7, null], Delivery: [9, 8, 8, 9, null], Overall: [14, 15, 13, 16, null], Presentation: [8, 8, 7, 9, null] },
    C: { Content: [7, 7, 7, 7, 7], Delivery: [7, 6, 6, 6, 7], Overall: [13, 12, 13, 12, 13], Presentation: [7, 8, 7, 8, 7] },
  },
  recusals: [[5, 'B']],
  steps: [['Speech', 'Interview'], ['Speech']],
}

describe('computeResults', () => {
  it('1. sum mode, no ties, above threshold → decided', () => {
    const r = computeResults(build({
      judges: 3, thresholdPct: 50, categories: { Speech: { Speech: 10 } },
      scores: { A: { Speech: [9, 8, 9] }, B: { Speech: [7, 7, 7] } },
    }))
    expect(r.maxPossible).toBe(30)
    expect(totalOf(r)).toEqual({ A: 26, B: 21 })
    expect(r.winner).toEqual({ kind: 'decided', contestantId: 'A' })
  })

  it('2. worked example: backfill, drop high/low, B wins at tiebreak step 2', () => {
    const r = computeResults(build(worked))
    expect(r.maxPossible).toBe(150)
    expect(r.thresholdPoints).toBe(105)
    const byId = Object.fromEntries(r.standings.map(s => [s.contestantId, s]))
    expect(byId.A!.categoryTotals).toEqual({ Speech: 48, Interview: 45, Fantasy: 24 })
    expect(byId.B!.categoryTotals).toEqual({ Speech: 49.5, Interview: 43.5, Fantasy: 24 })
    expect(byId.C!.total).toBe(100)
    expect(byId.B!.pct).toBeCloseTo(0.78)
    expect(r.standings.map(s => s.contestantId)).toEqual(['B', 'A', 'C'])
    expect(rankOf(r)).toEqual({ B: 1, A: 2, C: 3 })
    expect(byId.B!.tiebreakPath).toEqual([{ step: 1, value: 93 }, { step: 2, value: 49.5 }])
    expect(byId.C!.tiebreakPath).toBeUndefined()
    expect(r.winner).toEqual({ kind: 'decided', contestantId: 'B' })
    // B's Speech subtotals are J1 17, J2 17, J3 16, J4 16, J5 16.5 (backfilled): one 16 and one 17 are dropped.
    expect(byId.B!.breakdown.Speech).toEqual([
      { judgeId: 'J1', subtotal: 17, dropped: false, backfilled: false },
      { judgeId: 'J2', subtotal: 17, dropped: true, backfilled: false },
      { judgeId: 'J3', subtotal: 16, dropped: true, backfilled: false },
      { judgeId: 'J4', subtotal: 16, dropped: false, backfilled: false },
      { judgeId: 'J5', subtotal: 16.5, dropped: false, backfilled: true },
    ])
  })

  it('3. leader below threshold → no_title', () => {
    const r = computeResults(build({ ...worked, thresholdPct: 80 }))
    expect(r.thresholdPoints).toBe(120)
    expect(r.winner).toEqual({ kind: 'no_title', reason: 'below_threshold' })
    expect(rankOf(r).B).toBe(1)
  })

  it('4. null threshold never yields no_title', () => {
    const r = computeResults(build({
      judges: 1, categories: { S: { S: 10 } }, scores: { A: { S: [1] } },
    }))
    expect(r.thresholdPoints).toBeNull()
    expect(r.winner).toEqual({ kind: 'decided', contestantId: 'A' })
  })

  it('5. tie surviving every step → tie_unresolved; manual winner decides it', () => {
    const spec: Spec = {
      judges: 1, categories: { X: { X: 10 }, Y: { Y: 10 } }, steps: [['X']],
      scores: { A: { X: [5], Y: [5] }, B: { X: [5], Y: [5] } },
    }
    expect(computeResults(build(spec)).winner).toEqual({ kind: 'tie_unresolved', contestantIds: ['A', 'B'] })
    expect(computeResults(build({ ...spec, manualWinnerId: 'B' })).winner)
      .toEqual({ kind: 'decided', contestantId: 'B', manual: true })
    // A manual pick outside the tied group is ignored.
    const other = computeResults(build({ ...spec, scores: { ...spec.scores, C: { X: [1], Y: [1] } }, manualWinnerId: 'C' }))
    expect(other.winner.kind).toBe('tie_unresolved')
  })

  it('6. tie for 2nd only → shared rank, winner decided', () => {
    const r = computeResults(build({
      judges: 1, categories: { S: { S: 10 } },
      scores: { A: { S: [9] }, B: { S: [7] }, C: { S: [7] }, D: { S: [5] } },
    }))
    expect(rankOf(r)).toEqual({ A: 1, B: 2, C: 2, D: 4 })
    expect(r.winner).toEqual({ kind: 'decided', contestantId: 'A' })
  })

  it('7. drop mode with 4 judges → warning, falls back to sum', () => {
    const r = computeResults(build({
      judges: 4, aggregation: 'drop_high_low', categories: { S: { S: 10 } },
      scores: { A: { S: [1, 2, 3, 10] } },
    }))
    expect(r.warnings).toHaveLength(1)
    expect(r.maxPossible).toBe(40)
    expect(totalOf(r).A).toBe(16)
  })

  it('8. duplicate high values → only one is dropped', () => {
    const r = computeResults(build({
      judges: 5, aggregation: 'drop_high_low', categories: { S: { S: 10 } },
      scores: { A: { S: [9, 9, 9, 5, 4] } },
    }))
    expect(totalOf(r).A).toBe(23) // drop one 9 and the 4 → 9 + 9 + 5
  })

  it('9. recused judge with no other scores yet → stays missing, incomplete', () => {
    const r = computeResults(build({
      judges: 2, categories: { S: { S: 10 } }, recusals: [[2, 'A']],
      scores: { A: { S: [null, null] } },
    }))
    expect(r.standings[0]!.completeness).toBe(0)
    expect(r.standings[0]!.breakdown.S!.map(b => b.subtotal)).toEqual([null, null])
    expect(r.winner).toEqual({ kind: 'incomplete', projectedId: 'A' })
  })

  it('10. missing unrecused score → incomplete; projection uses % of entered points', () => {
    const r = computeResults(build({
      judges: 3, categories: { S: { S: 10 } },
      scores: { A: { S: [10, 10, null] }, B: { S: [9, 9, 9] } },
    }))
    // A has 20 of 20 possible so far (100%), B has 27 of 30 (90%).
    expect(r.winner).toEqual({ kind: 'incomplete', projectedId: 'A' })
    const a = r.standings.find(s => s.contestantId === 'A')!
    expect(a.completeness).toBeCloseTo(2 / 3)
    expect(a.pct).toBe(1)
  })

  it('10b. while others are incomplete, fully scored contestants still use tiebreaks for the projection', () => {
    const spec = { ...worked, scores: { ...worked.scores, C: { ...worked.scores.C, Overall: [13, 12, null, 12, 13] } } }
    const r = computeResults(build(spec))
    expect(r.winner).toEqual({ kind: 'incomplete', projectedId: 'B' })
    expect(r.standings.slice(0, 2).map(s => [s.contestantId, s.rank])).toEqual([['B', 1], ['A', 2]])
  })

  it('11. repeating backfill mean is rounded half-up to 0.01', () => {
    // Others score 8, 8, 8.5 → 24.5/3 = 8.1666… → 8.17 (rounds up, not truncated)
    const r = computeResults(build({
      judges: 4, categories: { S: { S: 10 } }, recusals: [[4, 'A']],
      scores: { A: { S: [8, 8, 8.5, null] } },
    }))
    expect(totalOf(r).A).toBe(32.67)
    // 0.5 steps averaged over 2 → exactly x.25 / x.75, and x.xx5 rounds up
    const half = computeResults(build({
      judges: 3, categories: { S: { S: 10 } }, recusals: [[3, 'A']],
      scores: { A: { S: [8, 8.5, null] } },
    }))
    expect(totalOf(half).A).toBe(24.75)
  })

  it('12. withdrawn contestant is excluded', () => {
    const r = computeResults(build({
      judges: 1, categories: { S: { S: 10 } }, withdrawn: ['A'],
      scores: { A: { S: [10] }, B: { S: [5] } },
    }))
    expect(r.standings.map(s => s.contestantId)).toEqual(['B'])
    expect(r.winner).toEqual({ kind: 'decided', contestantId: 'B' })
  })

  it('13. three-way tie split across two steps', () => {
    const r = computeResults(build({
      judges: 1, categories: { X: { X: 10 }, Y: { Y: 10 }, Z: { Z: 10 } },
      steps: [['X', 'Y'], ['X']],
      scores: {
        A: { X: [4], Y: [4], Z: [7] }, // step 1: 8 → last
        B: { X: [6], Y: [3], Z: [6] }, // step 1: 9, step 2: 6 → first
        C: { X: [5], Y: [4], Z: [6] }, // step 1: 9, step 2: 5 → second
      },
    }))
    expect(r.standings.map(s => [s.contestantId, s.rank])).toEqual([['B', 1], ['C', 2], ['A', 3]])
    expect(r.standings.find(s => s.contestantId === 'A')!.tiebreakPath).toEqual([{ step: 1, value: 8 }])
    expect(r.winner).toEqual({ kind: 'decided', contestantId: 'B' })
  })

  it('14. zero contestants or zero judges → empty/incomplete, no crash', () => {
    const none = computeResults(build({ judges: 3, categories: { S: { S: 10 } }, scores: {} }))
    expect(none.standings).toEqual([])
    expect(none.winner).toEqual({ kind: 'incomplete', projectedId: null })
    const noJudges = computeResults(build({ judges: 0, categories: { S: { S: 10 } }, scores: { A: { S: [] } } }))
    expect(noJudges.maxPossible).toBe(0)
    expect(noJudges.winner.kind).toBe('incomplete')
  })
})

describe('generateTiebreakSteps', () => {
  it('drops categories in rank order down to one', () => {
    expect(generateTiebreakSteps([
      { id: 'Speech', dropRank: 3 }, { id: 'Interview', dropRank: 2 }, { id: 'Fantasy', dropRank: 1 },
    ])).toEqual([['Speech', 'Interview'], ['Speech']])
  })

  it('never drops unranked categories', () => {
    expect(generateTiebreakSteps([
      { id: 'A', dropRank: null }, { id: 'B', dropRank: 1 }, { id: 'C', dropRank: 2 },
    ])).toEqual([['A', 'C'], ['A']])
    expect(generateTiebreakSteps([{ id: 'A', dropRank: 1 }])).toEqual([])
  })
})
