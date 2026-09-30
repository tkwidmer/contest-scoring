# 03 — Auth, Roles & RLS

## Authentication
- **Supabase Auth, email OTP / magic link** (`signInWithOtp`) for everyone. Google OAuth is an optional extra for producers, using the same pattern as Inkborn Forge (`signInWithOAuth` → `/auth/callback`).
- Before the first real event, set up **custom SMTP** (Resend or Postmark). Supabase's built-in email sender is rate-limited and not meant for production.
- The browser only ever holds the **anon key**. A service-role key exists only in Vercel functions, and only the P2 invite function needs one.

## Roles
| Role | Scope | Stored in |
|---|---|---|
| Platform admin | Global | `profiles.is_platform_admin` (set by hand in SQL) |
| Producer | Org | `org_members.role = 'producer'` |
| Tabulator | Org | `org_members.role = 'tabulator'` |
| Judge | Contest | `judges.user_id = auth.uid()` |
| Public | — | anon |

## Helper functions
All live in the `private` schema, which the REST API doesn't expose. All are `security definer`, `stable`, and `set search_path = ''`.
- `is_org_member(org uuid, roles text[])` → bool
- `contest_org(contest uuid)` → uuid (in practice we read the denormalized `contests.org_id`)
- `my_judge_ids(contest uuid)` → setof uuid
- `is_platform_admin()` → bool

## Policy matrix
P = producer of the owning org, T = tabulator of that org, J = judge (only their own rows), A = anon.

| Table | select | insert / update / delete |
|---|---|---|
| `orgs` | members | P (update). Created via the `create_org` RPC. |
| `org_members` | members of that org | P |
| `events`, `contests`, `categories`, `components`, `tiebreak_steps` | P, T; J: only the contests they're assigned to | P (trigger blocks rubric edits after draft) |
| `contestants` | P, T, J (assigned contest) | P |
| `contestant_contacts` | **P only** | P |
| `judges` | P, T; J: own row | P |
| `recusals` | P, T; J: own | P, T; J: own (P2) |
| `scores` | P, T; **J: own `judge_id` only** | P, T; J: own, only while the sheet is unlocked and status = scoring (trigger) |
| `sheet_submissions` | P, T; J: own | J submits own. P, T submit on a judge's behalf. **Only P unlocks** (RPC). |
| `score_audit` | P | **Nobody.** Trigger only. |
| `comments` | P; J: own | J: own body (while scoring; a category comment locks with its submitted sheet). P: body only for judges without an account (paper), and `edited_body`/`approved` through `review_comment`. Frozen once published. |
| `published_results` | **everyone, including anon** | Written only by `publish_contest` / `unpublish_contest` (P). The snapshot is built in SQL from the finalized result: names, ranks, winner, and optionally totals by category. Never judges, per-judge scores, emails or comments. |
| `templates` | org members for `private`; everyone signed in for `public` and `curated` | P for org rows. Platform admin for `curated`. |

Invariants the policies must keep:
- Judges never see other judges' scores, standings, or contestant emails.
- Tabulators can't change contest structure, can't unlock sheets, and can't publish.
- Anonymous users can read only `published_results`, plus the contest and event names inside the snapshot. They read no live tables.
- The public snapshot never includes contestant emails. It includes judge names only if `anonymize_comments` is false, and comments are never published.

## Event approval (D25)
- `events.approved_at/by` and `approval_requested_at/by` are not client-writable (column-level insert and update grants).
- `request_event_approval(event)`: producers of the event's org. `set_event_approval(event, bool)` and `event_approvals()` (the queue, with the requester's email): platform admins only.
- `set_contest_status` refuses draft → scoring while the event is unapproved, or outside 14 days either side of its date (the approval date for events approved before dates were required). `request_event_approval` needs a date; a trigger locks `starts_on` while approved. Tests: `supabase/tests/event_approval.test.sql`.

## Judge and member onboarding (P2, D26)
No server function: invites are stored against an email and claimed when that person signs in.
1. The producer gives a judge an email on the People tab (`judges.email`, `user_id` null), or invites a producer or tabulator on the organization page (`org_invites`: org, email, role; producers only).
2. The producer clicks **Email a sign-in link** (an ordinary `signInWithOtp`, which also creates the account) or **Copy invite** to text it.
3. The person signs in with an OTP to that email. The dashboard calls `claim_invites()`, which sets `judges.user_id = auth.uid()` where `lower(email) = lower(auth.email())` (one seat per contest) and turns matching `org_invites` into `org_members`. Safe because the OTP just verified the email.
4. The dashboard lists **Judging** (seats) above **Your organizations**. `/judge/:contest` is the judge's own sheet.

## Sheets (P2)
- A sheet is one judge × contestant × category. `submit_sheet` (the judge, or a producer/tabulator on their behalf) needs every component scored, then locks it; `validate_score` rejects any write to a locked sheet, from anyone. `unlock_sheet` is producers only and needs a reason. Both are logged in `sheet_audit` (producers read it).
- Judges read and write only their own scores (`private.is_own_judge`). They can't read `contests.final_result` (it holds every judge's scores); org members read it with `contest_final_result()`.
- Tests: `supabase/tests/judges_score.test.sql`.

## Audit & integrity
- The `score_audit` trigger fires on insert, update and delete of `scores`. It records `auth.uid()` together with the old and new values.
- Unlocking a sheet requires a reason, stored on `sheet_submissions`.
- Status changes go through RPCs that check the role. Moving `finalized → scoring` writes an audit note.

## Testing
- **pgTAP tests** in `supabase/tests/` (run by `supabase test db` in CI) cover each row of the policy matrix: one test per role per table, asserting both what is allowed and what is denied.
- Run `get_advisors` (the security advisor) before each deploy that includes a migration.
