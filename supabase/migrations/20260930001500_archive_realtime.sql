-- Archive finished events (hidden from the org's list, nothing deleted), and live updates: Supabase Realtime
-- streams score, sheet and deduction changes to the Standings page. Realtime applies the same RLS as reads.

alter table public.events add column archived_at timestamptz;
grant update (archived_at) on public.events to authenticated; -- producers only, by the existing update policy

alter publication supabase_realtime add table public.scores, public.sheet_submissions, public.penalties;
