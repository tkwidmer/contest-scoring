-- P2: judges sign in and score their own sheets.
--  * Seats and invites are claimed by email on sign-in (claim_invites): judges.user_id, and org_invites for
--    producers/tabulators. Safe because Supabase verified the email with the OTP.
--  * Judges read and write only their own scores. A judge submits a sheet (one contestant x one category) and it
--    locks for everyone; only a producer can unlock it, with a reason. Both are logged in sheet_audit.
--  * Judges no longer read contests.final_result (it holds every judge's scores); org members get it by RPC.

-- ── claiming seats and invites ──────────────────────────────────────────────
create table public.org_invites (
  org_id uuid not null references public.orgs (id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null check (role in ('producer', 'tabulator')),
  invited_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (org_id, email)
);
create unique index org_invites_email_ci on public.org_invites (org_id, lower(email));
alter table public.org_invites enable row level security;
revoke insert, update on public.org_invites from anon, authenticated;
grant insert (org_id, email, role) on public.org_invites to authenticated;
create policy "org_invites: producers read" on public.org_invites for select to authenticated
  using (private.is_org_member(org_id, array['producer']));
create policy "org_invites: producers insert" on public.org_invites for insert to authenticated
  with check (private.is_org_member(org_id, array['producer']));
create policy "org_invites: producers delete" on public.org_invites for delete to authenticated
  using (private.is_org_member(org_id, array['producer']));

-- Returns how many seats and memberships were claimed.
create function public.claim_invites() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower((select auth.email()));
  v_judges int;
  v_members int;
begin
  if v_uid is null or v_email is null then return 0; end if;
  -- One seat per contest: if the same email is on two judges in a contest, the first in order is claimed.
  update public.judges set user_id = v_uid
   where id in (select distinct on (j.contest_id) j.id from public.judges j
                 where j.user_id is null and lower(j.email) = v_email
                   and not exists (select 1 from public.judges m where m.contest_id = j.contest_id and m.user_id = v_uid)
                 order by j.contest_id, j.sort, j.created_at);
  get diagnostics v_judges = row_count;
  insert into public.org_members (org_id, user_id, role)
    select org_id, v_uid, role from public.org_invites where lower(email) = v_email
    on conflict (org_id, user_id) do nothing;
  get diagnostics v_members = row_count;
  delete from public.org_invites where lower(email) = v_email;
  return v_judges + v_members;
end $$;

-- Judges see the event their contest belongs to (for its name).
create policy "events: judges read" on public.events for select to authenticated
  using (exists (select 1 from public.contests c where c.event_id = events.id and private.is_contest_judge(c.id)));

-- ── judges write their own scores ───────────────────────────────────────────
create function private.is_own_judge(p_judge uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.judges where id = p_judge and user_id = (select auth.uid()))
$$;
create policy "scores: judges insert their own" on public.scores for insert to authenticated
  with check (private.is_own_judge(judge_id));
create policy "scores: judges update their own" on public.scores for update to authenticated
  using (private.is_own_judge(judge_id)) with check (private.is_own_judge(judge_id));
create policy "scores: judges delete their own" on public.scores for delete to authenticated
  using (private.is_own_judge(judge_id));

-- ── submitted sheets ────────────────────────────────────────────────────────
create table public.sheet_submissions (
  judge_id uuid not null references public.judges (id) on delete cascade,
  contestant_id uuid not null references public.contestants (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  contest_id uuid not null references public.contests (id) on delete cascade,
  submitted_at timestamptz not null default now(),
  submitted_by uuid references public.profiles (id) on delete set null,
  unlocked_at timestamptz,
  unlocked_by uuid references public.profiles (id) on delete set null,
  unlock_reason text,
  primary key (judge_id, contestant_id, category_id)
);
create index sheet_submissions_contest_idx on public.sheet_submissions (contest_id);
alter table public.sheet_submissions enable row level security;
revoke insert, update, delete on public.sheet_submissions from anon, authenticated; -- RPCs only
create policy "sheet_submissions: members read, judges see their own" on public.sheet_submissions for select to authenticated
  using (private.is_org_member(private.contest_org(contest_id)) or private.is_own_judge(judge_id));

create table public.sheet_audit (
  id bigint generated always as identity primary key,
  contest_id uuid not null references public.contests (id) on delete cascade,
  judge_id uuid not null,
  contestant_id uuid not null,
  category_id uuid not null,
  action text not null check (action in ('submit', 'unlock')),
  reason text,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index sheet_audit_contest_idx on public.sheet_audit (contest_id, changed_at);
alter table public.sheet_audit enable row level security;
revoke insert, update, delete on public.sheet_audit from anon, authenticated;
create policy "sheet_audit: producers read" on public.sheet_audit for select to authenticated
  using (private.is_org_member(private.contest_org(contest_id), array['producer']));

create function private.sheet_locked(p_judge uuid, p_contestant uuid, p_component uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_judge is not null and exists (
    select 1 from public.sheet_submissions s join public.components k on k.category_id = s.category_id
     where s.judge_id = p_judge and s.contestant_id = p_contestant and k.id = p_component and s.unlocked_at is null)
$$;

-- The judge themself, or a producer/tabulator on their behalf. Every component must be scored (recused: nothing to submit).
create function public.submit_sheet(p_judge uuid, p_contestant uuid, p_category uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_contest uuid;
begin
  select j.contest_id into v_contest from public.judges j where j.id = p_judge;
  if v_contest is null or not (private.is_own_judge(p_judge) or private.is_org_member(private.contest_org(v_contest))) then
    raise exception 'You can only submit your own sheets' using errcode = '42501';
  end if;
  if private.contestant_contest(p_contestant) is distinct from v_contest or private.category_contest(p_category) is distinct from v_contest then
    raise exception 'The judge, contestant and category must be in the same contest' using errcode = 'P0001';
  end if;
  if (select status from public.contests where id = v_contest) <> 'scoring' then
    raise exception 'Sheets can only be submitted while the contest is being scored' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.components k where k.category_id = p_category and not exists (
      select 1 from public.scores s where s.judge_id = p_judge and s.contestant_id = p_contestant and s.component_id = k.id)) then
    raise exception 'Score every part of this sheet before submitting it' using errcode = 'P0001';
  end if;
  insert into public.sheet_submissions (judge_id, contestant_id, category_id, contest_id, submitted_by)
  values (p_judge, p_contestant, p_category, v_contest, (select auth.uid()))
  on conflict (judge_id, contestant_id, category_id) do update
    set submitted_at = now(), submitted_by = excluded.submitted_by, unlocked_at = null, unlocked_by = null, unlock_reason = null
    where public.sheet_submissions.unlocked_at is not null;
  if found then
    insert into public.sheet_audit (contest_id, judge_id, contestant_id, category_id, action, changed_by)
    values (v_contest, p_judge, p_contestant, p_category, 'submit', (select auth.uid()));
  end if;
end $$;

create function public.unlock_sheet(p_judge uuid, p_contestant uuid, p_category uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_contest uuid := private.judge_contest(p_judge);
begin
  if v_contest is null or not private.is_org_member(private.contest_org(v_contest), array['producer']) then
    raise exception 'Only producers can unlock a sheet' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Give a reason for unlocking the sheet' using errcode = 'P0001';
  end if;
  update public.sheet_submissions set unlocked_at = now(), unlocked_by = (select auth.uid()), unlock_reason = trim(p_reason)
   where judge_id = p_judge and contestant_id = p_contestant and category_id = p_category and unlocked_at is null;
  if not found then
    raise exception 'That sheet isn''t locked' using errcode = 'P0001';
  end if;
  insert into public.sheet_audit (contest_id, judge_id, contestant_id, category_id, action, reason, changed_by)
  values (v_contest, p_judge, p_contestant, p_category, 'unlock', trim(p_reason), (select auth.uid()));
end $$;

create or replace function private.validate_score() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  j record;
begin
  if tg_op = 'DELETE' then
    if (select status from public.contests where id = old.contest_id) is distinct from 'scoring' then
      raise exception 'Scores can only be changed while the contest is being scored' using errcode = 'P0001';
    end if;
    if private.sheet_locked(old.judge_id, old.contestant_id, old.component_id) then
      raise exception 'This sheet was submitted and is locked. A producer can unlock it.' using errcode = 'P0001';
    end if;
    return old;
  end if;

  select ct.contest_id as contestant_contest, cat.contest_id, cat.round, cat.scored_by, cat.guest_average,
         k.min_points, k.max_points, k.step, c.status, c.finalist_count, ct.finalist
    into r
    from public.contestants ct, public.components k
    join public.categories cat on cat.id = k.category_id
    join public.contests c on c.id = cat.contest_id
   where ct.id = new.contestant_id and k.id = new.component_id;
  if not found then
    raise exception 'Unknown contestant or component' using errcode = 'P0001';
  end if;
  if r.contestant_contest is distinct from r.contest_id then
    raise exception 'The judge, contestant and component must be in the same contest' using errcode = 'P0001';
  end if;

  if r.scored_by = 'producer' then
    if new.judge_id is not null then
      raise exception 'This category is entered once per contestant, not per judge' using errcode = 'P0001';
    end if;
  else
    select contest_id, guest into j from public.judges where id = new.judge_id;
    if new.judge_id is null or j.contest_id is distinct from r.contest_id then
      raise exception 'The judge, contestant and component must be in the same contest' using errcode = 'P0001';
    end if;
    if r.scored_by = 'cross_panel' and not j.guest then
      raise exception 'Only cross-panel judges score this category' using errcode = 'P0001';
    end if;
    if j.guest and r.scored_by = 'judges' and not r.guest_average then
      raise exception 'Cross-panel judges only score cross-panel categories' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.recusals where judge_id = new.judge_id and contestant_id = new.contestant_id) then
      raise exception 'This judge is recused from this contestant' using errcode = 'P0001';
    end if;
  end if;

  if r.status <> 'scoring' then
    raise exception 'Scores can only be changed while the contest is being scored' using errcode = 'P0001';
  end if;
  if r.finalist_count is not null and r.round = 'final' and not r.finalist then
    raise exception 'Only finalists are scored in the finals' using errcode = 'P0001';
  end if;
  if new.value < r.min_points or new.value > r.max_points or mod(new.value - r.min_points, r.step) <> 0 then
    raise exception 'Score must be between % and % in steps of %',
      trim_scale(r.min_points), trim_scale(r.max_points), trim_scale(r.step) using errcode = 'P0001';
  end if;

  if private.sheet_locked(new.judge_id, new.contestant_id, new.component_id)
     or (tg_op = 'UPDATE' and private.sheet_locked(old.judge_id, old.contestant_id, old.component_id)) then
    raise exception 'This sheet was submitted and is locked. A producer can unlock it.' using errcode = 'P0001';
  end if;

  new.contest_id := r.contest_id;
  new.entered_by := (select auth.uid());
  new.updated_at := now();
  return new;
end $$;


-- ── final_result holds every judge's scores: members only ──────────────────
revoke select on public.contests from authenticated;
grant select (id, event_id, org_id, name, status, aggregation, threshold_pct, anonymize_comments, manual_winner_reason,
  created_at, manual_winner_contestant_id, finalized_at, finalist_count, prelim_aggregation, prelim_carries,
  finalists_confirmed_at, report_as, threshold_single_only) on public.contests to authenticated;
create function public.contest_final_result(p_contest uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select final_result from public.contests where id = p_contest and private.is_org_member(org_id)
$$;

revoke execute on function public.claim_invites(), public.submit_sheet(uuid, uuid, uuid), public.unlock_sheet(uuid, uuid, uuid, text),
  public.contest_final_result(uuid) from public, anon;
grant execute on function public.claim_invites(), public.submit_sheet(uuid, uuid, uuid), public.unlock_sheet(uuid, uuid, uuid, text),
  public.contest_final_result(uuid) to authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_org_member(uuid, text[]), private.is_platform_admin(), private.shares_org(uuid),
  private.contest_org(uuid), private.category_contest(uuid), private.is_contest_judge(uuid),
  private.contestant_contest(uuid), private.judge_contest(uuid), private.is_own_judge(uuid) to authenticated;
