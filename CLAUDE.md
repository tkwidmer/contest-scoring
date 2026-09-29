# Tallymaster.top

Personal project (repo and Supabase/Vercel projects are still named `contest-scoring`): scoring platform for leather/LGBT title contests. The design lives in `docs/design/` (start with `00-overview.md`). Build status is tracked in `docs/build-status.json`, rendered by `docs/build-dashboard.html`. **Update the task statuses in build-status.json as work lands.**

- **ARCC governance does not apply to this project.** It is work-only. Don't query ARCC or report on an ARCC setup gap here. Apply standard security practices instead.

## Commands
| | |
|---|---|
| `npm run db:start` | Local Supabase (needs Docker). Prints URL and keys. Mailpit inbox for sign-in codes: http://127.0.0.1:54324 |
| `npm run dev` | Vite on :5173. Needs `.env.local` (copy `.env.example`) |
| `npm run db:reset` | Re-apply migrations and `supabase/seed.sql` (the worked example from design doc 02; sign in as `producer@test.dev`) |
| `npm run db:test` | pgTAP RLS tests in `supabase/tests/` |
| `npm run db:types` | Regenerate `src/lib/database.types.ts`. CI fails if it's stale |
| `npm run lint` / `npm test` / `npm run build` | ESLint / Vitest / tsc + vite build |
| `npm run test:e2e` | Playwright against the local stack + seed (worked example). Restores what it changes |

## Conventions
- Stack: Vite + React 19 + React Router 7 + Tailwind 4 + supabase-js, TypeScript strict.
- **Authorization is RLS.** Every table has RLS enabled. Writes that span tables go through `security definer` RPCs with `set search_path = ''`. Every new policy needs a pgTAP test covering both what is allowed and what is denied.
- Migrations are Supabase CLI timestamped files in `supabase/migrations/`. Never edit one that has already been applied to a hosted project.
- Colors are CSS variables in `src/index.css`, remapped for dark mode. Use the `bg`/`fg`/`muted`/`rule`/`accent` Tailwind tokens. Don't use `dark:` variants or literal colors.
- Scoring math lives only in `src/lib/scoring/` as pure functions with Vitest fixtures (see design doc 02).
- Verify UI changes on the local dev server.
