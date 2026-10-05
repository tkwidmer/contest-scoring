# Tallymaster.top

Scoring and tabulation for leather, bear and bootblack title contests. Producers set up events and contests
(straight or Olympic scoring, prelims and finals, deductions, community votes, cross-panel judges, tiebreaks, a
minimum to award the title); judges score on their phones; standings update live; results are finalized,
audited, printed and published.

Live at [tallymaster.top](https://tallymaster.top) (also [contest-scoring.vercel.app](https://contest-scoring.vercel.app)).
Design docs are in [`docs/design/`](docs/design/00-overview.md); build progress is tracked in
[`docs/build-status.json`](docs/build-status.json) and rendered by [`docs/build-dashboard.html`](docs/build-dashboard.html).

## Architecture

```
Browser (React SPA on Vercel) ──supabase-js──▶ Supabase (Postgres + Auth + Realtime)
   pages, scoring engine                        RLS policies, security-definer RPCs, triggers
```

There is **no application server**. The browser talks straight to Supabase, and the database enforces every rule.
(One small Vercel function, `api/page.js`, only adds link-preview tags to shared pages.)

- **Frontend**: Vite, React 19, React Router 7, TypeScript (strict), Tailwind 4. Static files on Vercel
  (`vercel.json` rewrites every path to `index.html`).
- **Authorization is Row Level Security.** Every table has RLS. Roles: *producer* and *tabulator* (per
  organization, `org_members`), *judge* (per contest, `judges.user_id`), *platform admin* (`profiles.is_platform_admin`),
  and anonymous visitors (who can read only `published_results`). Clients write only the columns they're granted.
  See [`03-auth-rls.md`](docs/design/03-auth-rls.md).
- **Writes that span tables or change state go through RPCs** (`security definer`, `set search_path = ''`, each
  checks the caller): `create_org`, `set_contest_status`, `finalize_contest`, `confirm_finalists`, `submit_sheet`,
  `unlock_sheet`, `claim_invites`, `review_comment`, `publish_contest`, event approval, templates and more.
- **Triggers** validate every score (range, step, recusal, round, locked sheet, contest status), keep
  `score_audit` and lock rules once scoring starts. Nothing can edit the audit trail.
- **The scoring engine is pure TypeScript** in [`src/lib/scoring/`](src/lib/scoring/index.ts) with no I/O. The
  browser computes standings from raw scores; `finalize_contest` freezes the engine's output on the contest, and
  `publish_contest` builds the public snapshot from that frozen result in SQL. Spec and worked example:
  [`02-scoring-engine.md`](docs/design/02-scoring-engine.md).
- **Resilient score entry**: [`src/lib/saveQueue.ts`](src/lib/saveQueue.ts) queues edits per cell, mirrors them to
  `localStorage`, debounces, and retries while the venue Wi-Fi is down. Used by producer entry and the judge sheet.
- **Sign-in** is an email code or magic link (Supabase Auth). Judge seats and org invites are stored against an
  email and claimed by `claim_invites()` on sign-in, so there's no service-role key anywhere.
- **Live standings** use Supabase Realtime on `scores`, `sheet_submissions` and `penalties`.

### Repository layout

| Path | What's there |
|---|---|
| `src/pages/` | One file per route: `Landing`, `Pricing`, `Results`, `OrgResults` (public); `Home` (dashboard), `OrgHome`, `EventHome`, `Contest*` tabs (Setup, People, Scores, Standings, Comments, History), `Announce` (stage reveal), `JudgeSheet`, `Admin` |
| `api/page.js` | The only server code: fills link-preview tags into `index.html` for `/pricing` and `/r/:id` |
| `src/lib/scoring/` | Scoring engine and its Vitest fixtures |
| `src/lib/` | Supabase client, generated `database.types.ts`, save queue, invites, error messages, hooks |
| `src/components/` | Header, brand, shared Tailwind class strings (`ui.ts`) |
| `src/index.css` | Color tokens (light/dark and print). Use the `bg`/`fg`/`muted`/`rule`/`accent` tokens, not literal colors or `dark:` |
| `supabase/migrations/` | Timestamped SQL migrations, the source of truth for the schema, RLS and RPCs |
| `supabase/tests/` | pgTAP tests for RLS and RPCs |
| `supabase/seed.sql` | The worked example from design doc 02 (loaded on reset) |
| `e2e/` | Playwright tests against the local stack |
| `docs/` | Design docs, build status and dashboard |

## Develop

Needs Node 22+, Docker, and the Supabase CLI (installed as a dev dependency; `npx supabase`).

```bash
npm install
npm run db:start          # local Supabase in Docker; prints the API URL and keys
cp .env.example .env.local # set VITE_SUPABASE_ANON_KEY to the printed publishable key
npm run dev               # http://localhost:5173
```

- Sign in as **`producer@test.dev`** (producer of the sample contest) or **`judge1@test.dev`** (judge J1).
  Sign-in emails land in Mailpit at http://127.0.0.1:54324. Supabase Studio is at http://127.0.0.1:54323.
- `npm run db:reset` re-applies every migration and the seed. It wipes local data.
- Make yourself a platform admin locally (for `/admin`):
  `update public.profiles set is_platform_admin = true where id = (select id from auth.users where email = 'you@example.com');`

### Changing the database

1. Add a migration: `npx supabase migration new <name>`, write SQL, then `npx supabase migration up --local`.
2. Every new table gets RLS, and every policy gets a pgTAP test for both what is allowed and what is denied.
   Cross-table writes go through a `security definer` RPC with `set search_path = ''`.
3. Regenerate types: `npm run db:types` (CI fails if they're stale).
4. Never edit a migration that has been applied to production; add a new one.

## Test

| Command | What it runs |
|---|---|
| `npm run lint` | ESLint |
| `npm test` | Vitest: scoring engine fixtures and the save queue |
| `npm run build` | Type check and production build |
| `npm run db:test` | pgTAP: RLS and RPC tests in `supabase/tests/` |
| `npm run test:e2e` | Playwright against the local stack and seed: the worked example (tiebreak, entry, finalize), a judge submitting and a producer unlocking, and comment → approve → publish → public page. Run on a freshly reset database; it restores what it changes |

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs three jobs on every push and PR:
**app** (lint, unit tests, build, and a check that no secret key or JWT is in the bundle), **db** (pgTAP and a
generated-types check), and **e2e** (Playwright against a fresh local stack).

## Deploy

- **Frontend**: Vercel builds and deploys every push to `main`. The project needs `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY` (the publishable key only) and `VITE_GOOGLE_CLIENT_ID` (the OAuth client ID set on Supabase's
  Google provider; the site must be an authorized JavaScript origin on that client).
- **Database**: apply new migrations to the hosted project *before* pushing code that depends on them:
  `npx supabase link --project-ref assvtegfewidtrzukhbr` then `npx supabase db push`. Afterwards, check the
  Supabase security advisors.
- **Auth email**: production sends sign-in email through Resend (custom SMTP) from `noreply@tallymaster.top`.
  The Site URL and redirect URLs are set in Supabase → Authentication → URL Configuration.
