-- Platform admins can open any organization's event and contest to help troubleshoot its setup (read-only).
-- Select only: no write policy changes. Contestant contacts, scores, comments and audit trails stay out of reach.
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
