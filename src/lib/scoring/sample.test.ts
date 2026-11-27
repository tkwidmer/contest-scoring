import { expect, it } from 'vitest'
import { computeResults, type ScoringInput } from './index'
import { sampleScores } from './sample'

const input: ScoringInput = {
  aggregation: 'drop_high_low', thresholdPct: null, tiebreakSteps: [], recusals: [{ judgeId: 'J1', contestantId: 'A' }], scores: [],
  judges: [...['J1', 'J2', 'J3', 'J4', 'J5'].map(id => ({ id })), { id: 'G1', guest: true }],
  contestants: [{ id: 'A', withdrawn: false }, { id: 'B', withdrawn: false }, { id: 'W', withdrawn: true }],
  categories: [
    { id: 'speech', name: 'Speech', components: [{ id: 'content', min: 0, max: 10, step: 0.5 }, { id: 'delivery', min: 1, max: 7.5, step: 0.25 }] },
    { id: 'vote', name: 'Vote', scoredBy: 'producer', components: [{ id: 'votes', min: 0, max: 5, step: 1 }] },
    { id: 'guest', name: 'Guest', scoredBy: 'cross_panel', components: [{ id: 'shine', min: 0, max: 20, step: 0.5 }] },
  ],
}

it('fills every expected cell with a valid score, repeatably', () => {
  const scores = sampleScores(input, 42)
  expect(sampleScores(input, 42)).toEqual(scores)
  expect(sampleScores(input, 43)).not.toEqual(scores)
  const comps = new Map(input.categories.flatMap(c => c.components).map(k => [k.id, k]))
  for (const s of scores) {
    const k = comps.get(s.componentId)!
    expect(s.value).toBeGreaterThanOrEqual(k.min)
    expect(s.value).toBeLessThanOrEqual(k.max)
    expect(Math.round((s.value - k.min) * 100) % Math.round(k.step * 100)).toBe(0)
  }
  expect(scores.some(s => s.contestantId === 'W' || (s.judgeId === 'J1' && s.contestantId === 'A'))).toBe(false)
  // speech: 2 components x (5 + 4 judges, one recusal); vote: 2; guest: 2
  expect(scores).toHaveLength(2 * 9 + 2 + 2)
  expect(computeResults({ ...input, scores }).winner.kind).not.toBe('incomplete')
})
