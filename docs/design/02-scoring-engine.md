# 02 — Scoring Engine

A pure TypeScript module at `src/lib/scoring/` with no I/O and no Supabase import. The browser runs it for live standings. **Publish** runs the same code and freezes its output into `published_results.snapshot`. It's the most important code in the app, so every rule below is backed by a Vitest fixture.

## Rounds
`computeContest(input, rounds)` wraps `computeResults`. Without rounds it is one call. With rounds:
- **Prelims** run on prelim categories only, with the prelim aggregation, no threshold and no manual winner.
- **Cut**: contestants ranked within the top N (after tiebreak steps) are certain; a tied group straddling the line needs the producer's pick for the remaining slots. The proposal is only made once every prelim score is in; the database stores the confirmed finalists.
- **Finals** run on final categories only (IML) or all categories (IMBB, `carryPrelim`), with only the confirmed finalists, the contest's threshold and manual winner.
- Tiebreak steps may name categories from both rounds; categories absent from a round contribute nothing.

## Interface

```ts
type Input = {
  aggregation: 'sum' | 'drop_high_low' | 'drop_high_low_total'
  thresholdPct: number | null
  categories: { id; name; components: { id; min; max; step }[] }[]
  tiebreakSteps: { categoryIds: string[]; allJudges: boolean }[]  // allJudges adds the dropped high and low back
  judges: { id }[]
  contestants: { id; withdrawn: boolean }[]
  recusals: { judgeId; contestantId }[]
  scores: { judgeId; contestantId; componentId; value }[]
  manualWinnerId?: string | null
}

type Result = {
  maxPossible: number
  thresholdPoints: number | null
  standings: {
    contestantId; rank; total; pct
    categoryTotals: Record<categoryId, number>
    completeness: number              // 0..1 of expected sheets
    tiebreakPath?: { step: number; value: number }[]
    breakdown: Record<categoryId, { judgeId; subtotal: number | null; dropped: boolean; backfilled: boolean }[]>
  }[]
  winner:
    | { kind: 'decided'; contestantId }
    | { kind: 'no_title'; reason: 'below_threshold' }
    | { kind: 'tie_unresolved'; contestantIds }
    | { kind: 'incomplete'; projectedId }
  warnings: string[]                  // e.g. "drop_high_low needs ≥5 judges"
}

export function computeResults(input: Input): Result
```

## Algorithm

All arithmetic is done in **integer hundredths** (A2), so 16.5 is stored as 1650.

1. **Validate.** In `drop_high_low` mode, fewer than 5 judges produces a warning and the engine falls back to `sum`.
2. **Backfill recusals (A1).** For each recused `(judge, contestant)` and each component, take the mean of the other judges' values for that contestant and component, rounded half-up to 0.01. If no other judge has scored that component yet, the slot stays missing.
3. **Category subtotal per judge** = Σ component values for that judge, contestant and category.
4. **Aggregate per category:**
   - `sum`: add every judge's subtotal.
   - `drop_high_low`: sort the subtotals, remove one highest and one lowest (just one, even if several share the value), then add the rest.
5. **Total** = Σ category aggregates.
6. **Max possible (A4)** = countedJudges × Σ over categories of Σ component max. countedJudges = J in `sum` mode and J − 2 in drop mode. **pct** = total / maxPossible.
7. **Rank** by total, descending. Withdrawn contestants are excluded.
8. **Tiebreak.** For each group tied on total whose members are all fully scored, walk `tiebreakSteps` in order. At each step, re-sum the category aggregates for that step's categories only, and split the group by that value. A tie that survives the last step becomes `tie_unresolved`, unless `manualWinnerId` names one of the tied contestants.
9. **Winner.**
   - If any expected sheet is missing, the result is `incomplete` with a projected leader (the rank-1 contestant on the scores entered so far, ranked by pct of max possible *for the sheets entered*, so an early leader isn't just whoever has the most sheets done).
   - Otherwise, if rank 1 is below `thresholdPoints` = maxPossible × thresholdPct / 100, the result is `no_title`.
   - Otherwise a tie at rank 1 is `tie_unresolved`, and anything else is `decided`.

## Tiebreak step generation (for the UI)
Given categories with `drop_rank` (1 = dropped first), auto-generate these steps:
- step 1 = all categories minus the rank-1 category
- step 2 = minus ranks 1 and 2
- … and so on, down to a single category.

The producer can then edit any step's category set, reorder the steps, or delete them. Only the stored `tiebreak_steps` are used by the engine.

## Worked example (hand-verified)

Rubric (one judge max = 50):

| Category | Components | Max | Drop rank |
|---|---|---|---|
| Speech | Content 0–10, Delivery 0–10 (step 0.5) | 20 | 3 |
| Interview | Overall 0–20 | 20 | 2 |
| Fantasy | Presentation 0–10 | 10 | 1 |

Settings: `drop_high_low`, 5 judges (J1–J5), threshold **70 %**. Generated tiebreak steps: step 1 = {Speech, Interview}, step 2 = {Speech}.

- **Max possible** = 3 counted judges × 50 = **150**.
- **Threshold** = 105.

**Contestant A**, category subtotals J1…J5:

| Category | J1 | J2 | J3 | J4 | J5 | Drop | Aggregate |
|---|---|---|---|---|---|---|---|
| Speech | 16 | 18 | 15 | 17 | 12 | 18, 12 | 48 |
| Interview | 15 | 16 | 14 | 18 | 13 | 18, 13 | 45 |
| Fantasy | 8 | 8 | 9 | 6 | 8 | 9, 6 | 24 |
| **Total** | | | | | | | **117** (78 %) |

**Contestant B**. J5 is **recused** and is backfilled per component from J1–J4:

| Component | J1 | J2 | J3 | J4 | J5 (backfill) |
|---|---|---|---|---|---|
| Content | 8 | 9 | 8 | 7 | 8.00 |
| Delivery | 9 | 8 | 8 | 9 | 8.50 |
| Interview | 14 | 15 | 13 | 16 | 14.50 |
| Fantasy | 8 | 8 | 7 | 9 | 8.00 |

| Category | Subtotals J1…J5 | Drop | Aggregate |
|---|---|---|---|
| Speech | 17, 17, 16, 16, 16.5 | 17, 16 | 49.5 |
| Interview | 14, 15, 13, 16, 14.5 | 16, 13 | 43.5 |
| Fantasy | 8, 8, 7, 9, 8 | 9, 7 | 24 |
| **Total** | | | **117** (78 %) |

**Contestant C**: aggregates Speech 40, Interview 38, Fantasy 22, so the total is **100** (66.7 %).

**Resolution:**
- A and B tie at 117.
- Step 1 {Speech, Interview}: A = 93, B = 93, still tied.
- Step 2 {Speech}: A = 48, B = 49.5, so **B wins**.
- B's 117 ≥ 105, so the title is awarded. The result is `decided: B`, and B's `tiebreakPath` is `[{step:1,value:93},{step:2,value:49.5}]`.
- If the threshold were 80 % (120), the result would be `no_title` even though B ranks first.

## Edge cases = test fixture list
1. Sum mode, no ties, above threshold → decided.
2. The worked example above (drop mode, recusal, 2-step tiebreak).
3. Leader below threshold → no_title.
4. `threshold_pct` null → never no_title.
5. Tie that survives every step → tie_unresolved. With `manualWinnerId` → decided.
6. Tie for 2nd place only → ranks shared, winner decided.
7. Drop mode with 4 judges → warning, falls back to sum.
8. Duplicate high values → only one is dropped.
9. Recused judge where no other judge has scored the component yet → stays missing, incomplete.
10. Missing unrecused score → incomplete, projected leader chosen by pct of entered sheets.
11. Backfill mean that needs rounding (e.g. 24.5/3 = 8.1666…) → rounded half-up to 8.17.
12. Withdrawn contestant → excluded from ranks.
13. Three-way tie where step 1 splits off one contestant and step 2 splits the other two.
14. Zero contestants or zero judges → empty standings, no crash.
