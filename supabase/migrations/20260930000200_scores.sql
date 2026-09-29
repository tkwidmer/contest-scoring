-- P1.4.1: scores + append-only audit, validated by trigger; set_contest_status for draft <-> scoring.
-- Sheet submission/locking arrives with judge logins (P2). See docs/design/01-domain-model.md.

create index contests_manual_winner_idx on public.contests (manual_winner_contestant_id); -- advisor: unindexed FK

-- ── tables ──────────────────────────────────────────────────────────────────
create table public.scores (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests (id) on delete cascade, -- set by trigger from the judge
  judge_id uuid not null references public.judges (id) on delete cascade,
  contestant_id uuid not null references public.contestants (id) on delete cascade,
  component_id uuid not null references public.components (id) on delete cascade,
  value numeric(6, 2) not null,
  entered_by uuid references public.profiles (id) on delete set null, -- set by trigger
  updated_at timestamptz not null default now(),
  unique (judge_id, contestant_id, component_id)
);
create index scores_contest_idx on public.scores (contest_id);
create index scores_contestant_idx on public.scores (contestant_id);
create index scores_component_idx on public.scores (component_id);

create table public.score_audit (
  id bigint generated always as identity primary key,
  score_id uuid not null, -- no FK: the audit outlives deleted scores
  contest_id uuid not null references public.contests (id) on delete cascade,
  judge_id uuid not null,
  contestant_id uuid not null,
  component_id uuid not null,
  op text not null check (op in ('insert', 'update', 'delete')),
  old_value numeric(6, 2),
  new_value numeric(6, 2),
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index score_audit_contest_idx on public.score_audit (contest_id, changed_at);

alter table public.scores enable row level security;
alter table public.score_audit enable row level security;
revoke insert, update, delete on public.score_audit from anon, authenticated;

-- ── validation ──────────────────────────────────────────────────────────────
create function private.validate_score() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  if tg_op = 'DELETE' then
    if (select status from public.contests where id = old.contest_id) is distinct from 'scoring' then
      raise exception 'Scores can only be changed while the contest is being scored' using errcode = 'P0001';
    end if;
    return old;
  end if;

  select j.contest_id as judge_contest, ct.contest_id as contestant_contest, cat.contest_id as component_contest,
         k.min_points, k.max_points, k.step, c.status
    into r
    from public.judges j, public.contestants ct, public.components k
    join public.categories cat on cat.id = k.category_id
    join public.contests c on c.id = cat.contest_id
   where j.id = new.judge_id and ct.id = new.contestant_id and k.id = new.component_id;
  if not found then
    raise exception 'Unknown judge, contestant or component' using errcode = 'P0001';
  end if;

  if r.judge_contest is distinct from r.contestant_contest or r.judge_contest is distinct from r.component_contest then
    raise exception 'The judge, contestant and component must be in the same contest' using errcode = 'P0001';
  end if;
  if r.status <> 'scoring' then
    raise exception 'Scores can only be changed while the contest is being scored' using errcode = 'P0001';
  end if;
  if new.value < r.min_points or new.value > r.max_points or mod(new.value - r.min_points, r.step) <> 0 then
    raise exception 'Score must be between % and % in steps of %',
      trim_scale(r.min_points), trim_scale(r.max_points), trim_scale(r.step) using errcode = 'P0001';
  end if;
  if exists (select 1 from public.recusals where judge_id = new.judge_id and contestant_id = new.contestant_id) then
    raise exception 'This judge is recused from this contestant' using errcode = 'P0001';
  end if;

  new.contest_id := r.judge_contest;
  new.entered_by := (select auth.uid());
  new.updated_at := now();
  return new;
end $$;
create trigger scores_validate before insert or update or delete on public.scores
  for each row execute function private.validate_score();

create function private.audit_score() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.value = old.value then return null; end if;
  insert into public.score_audit (score_id, contest_id, judge_id, contestant_id, component_id, op, old_value, new_value, changed_by)
  values (coalesce(new.id, old.id), coalesce(new.contest_id, old.contest_id), coalesce(new.judge_id, old.judge_id),
          coalesce(new.contestant_id, old.contestant_id), coalesce(new.component_id, old.component_id),
          lower(tg_op), case when tg_op = 'INSERT' then null else old.value end,
          case when tg_op = 'DELETE' then null else new.value end, (select auth.uid()));
  return null;
end $$;
create trigger scores_audit after insert or update or delete on public.scores
  for each row execute function private.audit_score();

-- ── status transitions (finalize/publish arrive in P1.5) ────────────────────
create function public.set_contest_status(p_contest uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
  v_org uuid;
begin
  select status, org_id into v_status, v_org from public.contests where id = p_contest for update;
  if v_org is null or not private.is_org_member(v_org, array['producer']) then
    raise exception 'Only producers can change a contest''s status' using errcode = '42501';
  end if;

  if v_status = 'draft' and p_status = 'scoring' then
    if not exists (select 1 from public.components k join public.categories c on c.id = k.category_id where c.contest_id = p_contest) then
      raise exception 'Add at least one scored component before scoring starts' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.contestants where contest_id = p_contest and not withdrawn) then
      raise exception 'Add at least one contestant before scoring starts' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.judges where contest_id = p_contest) then
      raise exception 'Add at least one judge before scoring starts' using errcode = 'P0001';
    end if;
  elsif v_status = 'scoring' and p_status = 'draft' then
    if exists (select 1 from public.scores where contest_id = p_contest) then
      raise exception 'Scores have been entered, so the contest can''t go back to draft' using errcode = 'P0001';
    end if;
  else
    raise exception 'A contest can''t move from % to %', v_status, p_status using errcode = 'P0001';
  end if;

  update public.contests set status = p_status where id = p_contest;
end $$;
revoke execute on function public.set_contest_status(uuid, text) from public, anon;
grant execute on function public.set_contest_status(uuid, text) to authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_org_member(uuid, text[]), private.is_platform_admin(), private.shares_org(uuid),
  private.contest_org(uuid), private.category_contest(uuid), private.is_contest_judge(uuid),
  private.contestant_contest(uuid), private.judge_contest(uuid) to authenticated;

-- ── policies ────────────────────────────────────────────────────────────────
create policy "scores: members read, judges see their own" on public.scores for select to authenticated
  using (private.is_org_member(private.contest_org(contest_id))
         or exists (select 1 from public.judges j where j.id = judge_id and j.user_id = (select auth.uid())));
create policy "scores: producers and tabulators insert" on public.scores for insert to authenticated
  with check (private.is_org_member(private.contest_org(private.judge_contest(judge_id))));
create policy "scores: producers and tabulators update" on public.scores for update to authenticated
  using (private.is_org_member(private.contest_org(contest_id)))
  with check (private.is_org_member(private.contest_org(private.judge_contest(judge_id))));
create policy "scores: producers and tabulators delete" on public.scores for delete to authenticated
  using (private.is_org_member(private.contest_org(contest_id)));

create policy "score_audit: producers read" on public.score_audit for select to authenticated
  using (private.is_org_member(private.contest_org(contest_id), array['producer']));
