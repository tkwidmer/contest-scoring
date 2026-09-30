# 06 — Roadmap

Task-level status lives in [`../build-status.json`](../build-status.json), which is the single source of truth. [`../build-dashboard.html`](../build-dashboard.html) renders it. This doc covers the intent of each phase and its exit criteria.

| Phase | Goal | Exit criteria |
|---|---|---|
| **D: Design** | Settle decisions | Docs 00–05 exist. Defaults A1–A6 are confirmed. |
| **P0: Foundations** | An empty app is deployed, CI is green, and you can sign in | Sign in with OTP on the prod URL, create an org, and CI runs pgTAP. |
| **P1: Producer MVP** | Run a real contest from paper sheets | The seed data from the 02 worked example, entered through the UI, produces "Winner: B" by tiebreak step 2. Printable tally. Clone works. |
| **P2: Judges** | Judges score on their phones | A judge invited by email signs in, sees only their own sheets, submits, and the sheet locks. Producer unlock is audited. |
| **P3: Results & feedback** | Close the loop | Per-contestant feedback PDFs. The public results page shows only the snapshot. Templates can be shared across orgs. |
| **P4: Polish & growth** | From the audit | Audit fixes (resilient judge sheet, role-aware tabs, delete/archive, History view, live standings), then features for the weekend, judges, results and the business. Tracked in build-status.json. |
| **Later** | — | Email delivery of comments, prelims/finals rounds, % weighting, Average aggregation, realtime updates. |

## Risks to pressure-test during P1
1. **Venue reality.** Rehearse with the seed contest on a phone hotspot with the connection throttled, then kill the connection mid-entry and check that nothing is lost.
2. **Rubric changes mid-contest.** The rubric is locked after `draft`. If producers push back, add a "reopen rubric (clears no scores, audited)" escape hatch rather than allowing silent edits.
3. **Tabulator trust.** Every score change is audited. Show the audit log in the UI before the first real event.
4. **Real rubric variety.** Before P1 ships, collect 3–5 real scoresheets (IML-style, regional, bootblack) and model each one as a fixture.
