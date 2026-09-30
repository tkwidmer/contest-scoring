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
| `comments` | P; J: own | J: own body. P: `edited_body`, `approved`. |
| `published_results` | **everyone, including anon** | Written only by the `publish_contest` RPC (P) |
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

## Judge onboarding (P2)
1. The producer adds a judge with a name and email (`user_id` null).
2. The producer clicks **Invite**. That calls the Vercel function `api/invite-judge.ts`, which:
   - verifies the caller's JWT with `auth.getUser()`,
   - checks that the caller is a producer of the contest's org,
   - then calls `auth.admin.inviteUserByEmail`.

   As a fallback, the producer can copy an invite message with a link to the app.
3. The judge signs in with an OTP sent to that email. On login the app calls the RPC `claim_judge_seats()`. That function sets `judges.user_id = auth.uid()` wherever `lower(judges.email) = lower(auth.email())` and `user_id is null`. This is safe because the email was just verified by the OTP.
4. The judge dashboard lists the contests where `judges.user_id = auth.uid()`.

## Audit & integrity
- The `score_audit` trigger fires on insert, update and delete of `scores`. It records `auth.uid()` together with the old and new values.
- Unlocking a sheet requires a reason, stored on `sheet_submissions`.
- Status changes go through RPCs that check the role. Moving `finalized → scoring` writes an audit note.

## Testing
- **pgTAP tests** in `supabase/tests/` (run by `supabase test db` in CI) cover each row of the policy matrix: one test per role per table, asserting both what is allowed and what is denied.
- Run `get_advisors` (the security advisor) before each deploy that includes a migration.
