// Made-up scores for the draft-contest sandbox: one valid score for every cell the contest expects.
// Deterministic per seed, so the same sample survives a reload or a change to the scoring rules.
import type { ScoringInput } from './index'

// mulberry32: a small seeded PRNG, plenty for sample data.
function prng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function sampleScores(input: ScoringInput, seed: number): ScoringInput['scores'] {
  const rand = prng(seed)
  const recused = new Set(input.recusals.map(r => `${r.judgeId}|${r.contestantId}`))
  const scores: ScoringInput['scores'] = []
  for (const cat of input.categories) {
    const by = cat.scoredBy ?? 'judges'
    const judgeIds: (string | null)[] = by === 'producer' ? [null]
      : input.judges.filter(j => by === 'cross_panel' ? j.guest : !j.guest || cat.guestAverage).map(j => j.id)
    for (const c of input.contestants) {
      if (c.withdrawn) continue
      for (const judgeId of judgeIds) {
        if (recused.has(`${judgeId}|${c.id}`)) continue
        for (const k of cat.components) {
          // Integer hundredths, like the engine. Scores land in the top 40% of the range, as real ones tend to.
          const min = Math.round(k.min * 100), step = Math.round(k.step * 100)
          const steps = Math.floor((Math.round(k.max * 100) - min) / step)
          scores.push({ judgeId, contestantId: c.id, componentId: k.id, value: (min + step * Math.round(steps * (0.6 + 0.4 * rand()))) / 100 })
        }
      }
    }
  }
  return scores
}
