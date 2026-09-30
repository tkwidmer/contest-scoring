# 04 — UX Flows & Screens

The producer UI is built for desktop and tablet first, because it's often used on a laptop at the tabulation table. The judge UI is built for phones first (A5).

## Route map
| Route | Who | Purpose |
|---|---|---|
| `/login` | all | Email OTP (plus Google) |
| `/orgs/new`, `/o/:org` | P | Create an org, see its dashboard (events list, members) |
| `/o/:org/members` | P | Invite and manage producers and tabulators |
| `/o/:org/templates` | P | Template library: org, public and curated tabs |
| `/o/:org/e/:event` | P, T | Event home: its contests and each one's status |
| `/c/:contest/setup` | P | Rubric builder, settings, tiebreak builder |
| `/c/:contest/people` | P | Contestants, judges, recusals |
| `/c/:contest/enter` | P, T | Score entry (3 views) |
| `/c/:contest/standings` | P, T | Standings, projected winner, judge progress |
| `/c/:contest/comments` | P | Review, edit and approve comments, then export |
| `/dashboard` | all | Judging (my seats), then my organizations |
| `/judge/:contest` | J | My sheets for that contest |
| `/r/:contest` | public | Published results |

## Flows

### 1. Contest setup
Create event → **Add contest** (blank, **Clone past contest**, or **From template**) → Rubric builder:
- add categories and components with min/max/step
- see a live "max per judge" total
- drag categories into drop order
- tiebreak steps auto-generate and can each be edited

Then the settings:
- aggregation (drop high/low is disabled with an explanation if there are fewer than 5 judges)
- threshold % (shows the equivalent points)
- anonymize comments

Finally **Start scoring**, which locks the rubric.

### 2. People
Contestants: display name, number, what they represent, optional email. Reorder them to match the stage order.

Judges: name and email. Mark recusals in a contestants × judges checkbox grid.

### 3. Score entry (P, T)
There are three views over the same `scores` rows, switched by a tab:
- **By judge sheet**: pick a judge and a contestant, then fill every component, grouped by category. This mirrors one paper sheet and is the fastest way to transcribe. The Next arrow moves through contestants in stage order.
- **By category**: pick a category (e.g. Speech) to get a grid with contestants as rows and judges × components as columns. Use it right after a segment ends.
- **By contestant**: pick a contestant to get a grid with components as rows and judges as columns.

Common behavior:
- Numeric inputs snap to the component's step and turn red when out of range.
- Tab and Enter move through the grid.
- Recused cells show "R" with the backfilled value greyed out.
- Every cell autosaves (see [05](05-architecture.md#resilient-save)).
- A sync pill shows "All saved", "3 unsynced…", or "Offline, 3 queued".
- Locked sheets are read-only and show a 🔒. A producer can use **Unlock (reason)**.

### 4. Standings (P, T)
- The table shows rank, contestant, category totals, total, % of max, and completeness.
- A threshold line is drawn on the table.
- A banner shows the state: **Projected winner: B (incomplete, 14/15 sheets)**, **Winner: B**, **No title: leader 66.7% < 70%**, or **Tie: choose winner**.
- Expanding a row shows the tiebreak path and the per-judge breakdown, with dropped values struck through.
- The **Judge progress** panel shows sheets submitted per judge × category.
- A **Refresh** button is the only update mechanism (D20).
- **Finalize** is enabled only when the contest is complete and the winner is decided or chosen by hand.
- A printable tally sheet (browser print CSS) serves as the paper backup.

### 5. Judge (P2)
- The dashboard lists assigned contests under **Judging**.
- `/judge/:contest` has a row of contestant buttons (✓ when all their sheets are submitted), then one card per category with a status (not finished, ready to submit, submitted, reopened with the producer's reason). Comments arrive in P3.
- Opening a sheet shows the components, with large tap-friendly steppers or number inputs, and a comment box (per category or overall).
- **Submit** first confirms the entries, then locks the sheet.
- Judges never see totals from other judges.

### 6. Comments & feedback (P3)
- The **Comments** tab lists every comment per contestant: the original text and an editable shared version. Comments from paper sheets are added there.
- Each comment has an **Approve** toggle.
- **Export** produces one printable page per contestant (browser print → PDF). Judge names appear only if `anonymize_comments` is false.
- A CSV export is also available.

### 7. Publish (P3)
- **Publish results** (Standings, once finalized) asks for confirmation; there's no separate preview, and **Unpublish** takes it down again.
- Options: show the winner and placings only, or the full standings with totals by category.
- `/r/:contest` is shareable and needs no login.
- **Unpublish** deletes the snapshot.

### 8. Templates (P3)
- **Save as template** from any contest, with visibility private or public. The platform admin can also mark it curated.
- The library has three tabs: Org, Public and Curated, each with a preview and a **Use template** button.

## Accessibility basics
- Every input has a label.
- The grids are real `<table>` elements with proper headers.
- Focus is always visible.
- Colour is never the only signal (the lock icon and "R" are text).
- Tap targets in the judge UI are at least 44px.
