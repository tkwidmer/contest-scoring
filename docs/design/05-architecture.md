# 05 — Architecture

## Stack
The stack mirrors Inkborn Forge (`~/workspace/lorcana-pro-tools`), with one deliberate change: it uses TypeScript.

| Layer | Choice |
|---|---|
| App | Vite + React 19 + React Router 7, **TypeScript** (strict) |
| Styling | Tailwind CSS 4 (`@tailwindcss/vite`). Hand-built components, same as Inkborn. Dark mode by remapping CSS variables, no `dark:` variants. |
| Data/Auth | Supabase (Postgres, Auth, RLS) via `@supabase/supabase-js` from the browser |
| Types | `supabase gen types typescript --local > src/lib/database.types.ts` |
| Server | Almost none. `api/invite-judge.ts` (P2) is the only Vercel function planned. Everything else is RLS plus RPCs. |
| Hosting | Vercel (SPA rewrite to `/index.html`) |
| CI | GitHub Actions |
| Tests | Vitest for pure logic, `supabase test db` (pgTAP) for RLS, Playwright smoke test (P1 end) |
| Package manager | npm |

## Repo layout
```
contest-scoring/
  CLAUDE.md                 conventions, commands, architecture pointer to docs/design
  docs/design/*.md          these docs
  docs/build-status.json    build tracker data
  docs/build-dashboard.html build tracker UI
  src/
    main.tsx, App.tsx       router
    lib/
      supabase.ts           client
      database.types.ts     generated
      scoring/              computeResults + tests + fixtures   (02)
      tiebreak.ts           step generation                      (02)
      saveQueue.ts          resilient save + tests               (below)
    context/AuthProvider.tsx
    pages/                  one file per route in 04
    components/             ScoreGrid, SyncPill, RubricEditor, ...
  supabase/
    migrations/             timestamped (Supabase CLI)
    tests/                  pgTAP RLS tests
    seed.sql                demo org, event, the worked example from 02
  api/invite-judge.ts       (P2)
  .github/workflows/ci.yml
```

## Environments
| Env | Supabase | Vercel |
|---|---|---|
| Local | `supabase start` (Docker) | `npm run dev` |
| Preview | Shared staging project | PR preview deploys |
| Prod | Prod project | `main` |

Env vars:
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`: browser.
- `SUPABASE_SERVICE_ROLE_KEY`: Vercel function only, P2.

Migrations reach staging and prod through `supabase db push` in a manual GitHub workflow, run after CI passes.

## CI (`ci.yml`)
1. `npm ci`
2. `npm run lint`
3. `tsc --noEmit`
4. `npm test` (Vitest)
5. `supabase start` → `supabase db reset` → `supabase test db` (RLS)
6. `npm run build`

## Resilient save
`saveQueue.ts` is a small module with no dependencies:
- Keys are `judgeId:contestantId:componentId`. If the same cell changes twice before a flush, the latest value wins.
- The queue is mirrored to `localStorage` (inside try/catch), so a reload or crash doesn't lose entries.
- It flushes 400 ms after the last edit, when the browser comes back online, and on a 10 s timer. Each flush is a batch `upsert` on the unique key.
- Retries back off exponentially. A 4xx rejection (locked sheet, out-of-range value) is **not** retried. The cell is marked as an error with the message.
- A `beforeunload` warning appears while the queue isn't empty.
- It exposes `{pending, failing, online}` to `SyncPill`.
- Conflicts resolve as last write wins, and every write is audited, so disputes can be reconstructed.

## Standings data path
- Fetch the whole contest in parallel: rubric, contestants, judges, recusals and scores. That's at most about 20 contestants × 7 judges × 15 components ≈ 2k rows.
- Pass it to `computeResults`, then render.
- Refresh re-fetches. There's no caching layer and no realtime (D20).

## Security notes
- RLS is the authorization layer. The client is trusted only for UX.
- Every RPC is `security definer`, sets `search_path = ''`, and checks the role explicitly.
- The service-role key never ships in the client bundle. CI greps `dist/` for it.
- Contestant emails live in a separate table only producers can read (D15).

## Observability
- Vercel logs, plus Supabase logs and advisors.
- No extra tooling until real events are running.
