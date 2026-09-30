# 00 — Overview

## Problem
Leather and LGBT title contests (Mr/Ms/Mx Leather, Bootblack, Puppy and so on) are tabulated on paper scoresheets and spreadsheets. Every event producer defines their own categories and point scales. Tabulation is slow and easy to get wrong. The "no title if nobody scores high enough" rule is applied by hand. Tiebreaks follow producer-specific rules that nobody writes down.

## Goal
A web platform where producers:
1. build an **event** with one or more **contests** (titles),
2. define each contest's **rubric** (categories → components, point scales),
3. add **contestants** and **judges**,
4. enter scores **by judge sheet, by category, or by contestant**,
5. see **standings and a projected winner** at any time,
6. apply a configurable **minimum threshold** (no title below it) and **multi-step tiebreaks**,
7. later let **judges log in** and score, submit and comment themselves,
8. gather **judge comments** into feedback packets for contestants.

## Glossary
| Term | Meaning |
|---|---|
| **Org** | A producing group. Owns events, templates and members. |
| **Event** | A weekend or show, e.g. "Great Lakes Leather 2027". Holds 1+ contests. |
| **Contest** | One title being awarded, e.g. "Mr Great Lakes Leather". Has its own rubric, contestants, judges and settings. |
| **Category** | A scored segment (Speech, Interview, Fantasy, Pageant Presentation…). Worth the sum of its components' max points. |
| **Component** | A single scored line item inside a category (Content 0–10, step 0.5). |
| **Sheet** | One judge's scores for one contestant in one category. The unit that gets submitted and locked. |
| **Recusal** | A judge excused from scoring a particular contestant. Their slot is backfilled. |
| **Threshold** | Minimum % of max possible points needed for the title to be awarded. |
| **Tiebreak step** | A subset of categories compared when totals tie. Steps are tried in order. |
| **Producer** | Org admin/owner. Full control. |
| **Tabulator** | Can enter and view scores. Cannot change contest structure. |
| **Judge** | Assigned per contest. Sees and enters only their own sheets. |
| **Platform admin** | Global flag (you). Curates official rubric templates. |

## Decision log
| # | Area | Decision | Doc |
|---|---|---|---|
| D1 | Tenancy | Multi-producer. All data scoped to `org`. | 01, 03 |
| D2 | Shape | Org → Event → Contest(s). Judges and producers are shared at the event/org level. | 01 |
| D3 | Rubric | Category → Components. Each component has min/max/step (numeric, DB-checked). | 01 |
| D4 | Weighting | Raw points. A category is worth Σ of its component maxes. No % weights. | 02 |
| D5 | Scores | Always stored per judge, even when the producer transcribes paper sheets. | 01 |
| D6 | Aggregation | Per contest (and per round): **Sum**, **Drop high & low per category**, or **Drop the judges with the highest and lowest totals** (IML finals). Drop modes need ≥5 judges. | 02 |
| D7 | Recusal | Explicit recusal. The slot is backfilled with the average of the other judges, per component. Blank scores that aren't recusals block finalizing. | 02 |
| D8 | Threshold | % of max possible, checked against the final aggregated total. Below it, no title. | 02 |
| D9 | Tiebreak | The producer ranks categories in drop order. Steps are auto-generated (N-1 → … → 1 categories) and each step can be edited, including **counting every judge** (adding the dropped high and low back). When steps run out, the tie is flagged for a manual decision. | 02 |
| D24 | Scoring options | Per contest: report totals as the **sum** or the **per-judge average** of counted judges; the minimum can apply **only to a lone contestant**. Per category: **producer-entered** (one score per contestant, e.g. community vote), **cross-panel** (another panel's judges either add their average as one more judge, or score a category of their own with their own high/low drop), and **deductions** the tally master applies (points off the reported score, or a %). | 01, 02 |
| D25 | Event fee and approval | $100 per event (every contest at it), collected by hand. Producers set up for free and press **Request approval**; a platform admin approves the event on `/admin` once paid. A contest can't go from draft to scoring until its event is approved, and only from 14 days before the event date to 14 days after it, so an approved event can't be reused. Approval needs a date, and the date is locked while approved. Revoking only stops new contests starting. After running costs, fees go to Desire Unchained Events as a fundraiser. Existing events were approved when this shipped. | 03 |
| D23 | Rounds | Optional **prelims → finals** in one contest: categories are marked prelim or final, the top N advance (ties at the line go through the tiebreak steps, then the producer's pick), and prelim scores either carry into the finals (IMBB) or not (IML). The producer confirms the cut. | 01, 02 |
| D10 | Locking | A judge submits a sheet and it locks. A producer can unlock it, giving a reason. Every change goes to an append-only audit log. | 01, 03 |
| D11 | Lifecycle | Contest: `draft → scoring → finalized → published`. | 01 |
| D12 | Visibility | Standings are visible to producers and tabulators only. The public sees only a published snapshot. | 03 |
| D13 | Roles | Producer, Tabulator, Judge, plus a global platform-admin flag. | 03 |
| D14 | Auth | Supabase email magic link / OTP. Google OAuth is optional for producers. | 03 |
| D15 | PII | Contestants store a display/scene name, a number, what they represent, and an optional email (kept in a separate table only producers can read). | 01, 03 |
| D16 | Comments | Judges write, producers review and edit, output is a per-contestant print/PDF. Anonymous by default (per-contest toggle). | 04 |
| D17 | Templates | Clone a contest, plus a template library: org-private, opt-in public, and curated by the platform admin. A clone is always a copy. | 01, 04 |
| D18 | Entry views | By judge sheet, by category, by contestant. Every cell autosaves. | 04 |
| D19 | Connectivity | Resilient saving (local queue, retry, visible sync state). Not offline-first. | 05 |
| D20 | Realtime | None. Standings and judge progress refresh manually. | 04 |
| D21 | Engine | A pure TypeScript `scoring` module computes results in the browser. Publishing freezes a JSON snapshot. | 02, 05 |
| D22 | Stack | Vite + React 19 + React Router 7 + Tailwind 4 + supabase-js + **TypeScript**, deployed to Vercel, with GitHub Actions and Vitest. Security is enforced RLS-first. | 05 |

### Confirmed defaults (reviewed and confirmed by the owner, 2026-09-29)
- **A1** Order of operations: backfill recusals (per component) → sum into category subtotal per judge → trim high/low per category → sum.
- **A2** Backfilled values are rounded to 2 decimals, half-up. All other math is exact at 2-decimal scale (integer hundredths), so ties are deterministic.
- **A3** Tiebreak steps use the same aggregation as the main total (trimmed subtotals when drop mode is on).
- **A4** Max possible = counted judges × Σ category max, where counted judges = judges − 2 in drop mode.
- **A5** The judge UI is designed for phones first. The producer UI is designed for desktop/tablet first.
- **A6** Migrations use Supabase CLI timestamped files and the local stack, not Inkborn's hand-numbered SQL, because type generation and RLS tests need them.

## Non-goals (for now)
- % weighted categories (use points equal to the weight), excluding one randomly drawn judge per category (WSLO; approximated by dropping high and low)
- Emailing comments from the app, a contestant login portal
- Realtime updates, offline-first PWA
- Billing / paid plans
- Audience voting, ticketing, contestant applications
