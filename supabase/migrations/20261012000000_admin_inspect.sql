-- Platform admins can open any organization's event and contest to inspect its setup and watch scoring (read-only).
-- Select only: no write policy changes. Contestant contacts, comments and audit trails stay out of reach.
-- (Judges' emails sit on the judges row, so RLS can't hide them; the admin pages simply don't show them.)
create policy "orgs: platform admin read" on public.orgs for select to authenticated
  using (private.is_platform_admin());
create policy "events: platform admin read" on public.events for select to authenticated
  using (private.is_platform_admin());
create policy "contests: platform admin read" on public.contests for select to authenticated
  using (private.is_platform_admin());
create policy "categories: platform admin read" on public.categories for select to authenticated
  using (private.is_platform_admin());
create policy "components: platform admin read" on public.components for select to authenticated
  using (private.is_platform_admin());
create policy "tiebreak_steps: platform admin read" on public.tiebreak_steps for select to authenticated
  using (private.is_platform_admin());
create policy "contestants: platform admin read" on public.contestants for select to authenticated
  using (private.is_platform_admin());
create policy "judges: platform admin read" on public.judges for select to authenticated
  using (private.is_platform_admin());
create policy "recusals: platform admin read" on public.recusals for select to authenticated
  using (private.is_platform_admin());

-- Scoring: scores, deductions and which sheets are submitted, plus the frozen result of a finalized contest.
create policy "scores: platform admin read" on public.scores for select to authenticated
  using (private.is_platform_admin());
create policy "penalties: platform admin read" on public.penalties for select to authenticated
  using (private.is_platform_admin());
create policy "sheet_submissions: platform admin read" on public.sheet_submissions for select to authenticated
  using (private.is_platform_admin());
create or replace function public.contest_final_result(p_contest uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select final_result from public.contests where id = p_contest and (private.is_org_member(org_id) or private.is_platform_admin())
$$;
