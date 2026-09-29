-- Reporting as the per-judge average, a minimum that applies only to a lone contestant, producer-entered
-- categories (community votes), cross-panel judges averaged into one extra judge, and tally-master deductions.

alter table public.contests
  add column report_as text not null default 'total' check (report_as in ('total', 'average')),
  add column threshold_single_only boolean not null default false;
grant insert (report_as, threshold_single_only) on public.contests to authenticated;
grant update (report_as, threshold_single_only) on public.contests to authenticated;

alter table public.categories
  add column scored_by text not null default 'judges' check (scored_by in ('judges', 'producer')),
  add column guest_average boolean not null default false,
  -- [{ "label": "16–60 s over", "points": 5 } | { "label": "Over time", "percent": 10 }, ...]
  add column deductions jsonb not null default '[]' check (jsonb_typeof(deductions) = 'array');

alter table public.judges add column guest boolean not null default false; -- cross-panel judge
grant insert (guest) on public.judges to authenticated;
grant update (guest) on public.judges to authenticated;

create or replace function private.lock_contest_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status <> 'draft' and (
       new.aggregation is distinct from old.aggregation or new.threshold_pct is distinct from old.threshold_pct
    or new.finalist_count is distinct from old.finalist_count or new.prelim_aggregation is distinct from old.prelim_aggregation
    or new.prelim_carries is distinct from old.prelim_carries or new.report_as is distinct from old.report_as
    or new.threshold_single_only is distinct from old.threshold_single_only) then
    raise exception 'Scoring rules are locked once scoring starts' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ── producer-entered scores have no judge ───────────────────────────────────
alter table public.scores alter column judge_id drop not null;
alter table public.scores drop constraint scores_judge_id_contestant_id_component_id_key;
alter table public.scores add constraint scores_cell_key unique nulls not distinct (judge_id, contestant_id, component_id);
alter table public.score_audit alter column judge_id drop not null;

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
    if j.guest and not r.guest_average then
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

  new.contest_id := r.contest_id;
  new.entered_by := (select auth.uid());
  new.updated_at := now();
  return new;
end $$;

-- Policies keyed on contest_id (set by the trigger above, before the policy check) since judge_id may be null.
drop policy "scores: producers and tabulators insert" on public.scores;
drop policy "scores: producers and tabulators update" on public.scores;
drop policy "scores: producers and tabulators delete" on public.scores;
create policy "scores: producers and tabulators insert" on public.scores for insert to authenticated
  with check (private.is_org_member(private.contest_org(contest_id)));
create policy "scores: producers and tabulators update" on public.scores for update to authenticated
  using (private.is_org_member(private.contest_org(contest_id))) with check (private.is_org_member(private.contest_org(contest_id)));
create policy "scores: producers and tabulators delete" on public.scores for delete to authenticated
  using (private.is_org_member(private.contest_org(contest_id)));

-- ── deductions applied by the tally master ──────────────────────────────────
create table public.penalties (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests (id) on delete cascade, -- set by trigger
  contestant_id uuid not null references public.contestants (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  tier int not null check (tier >= 0), -- index into categories.deductions
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index penalties_contest_idx on public.penalties (contest_id);
create index penalties_contestant_idx on public.penalties (contestant_id);
create index penalties_category_idx on public.penalties (category_id);
alter table public.penalties enable row level security;
revoke update on public.penalties from anon, authenticated;

create function private.validate_penalty() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_contest uuid := coalesce(new.contest_id, old.contest_id);
begin
  if tg_op = 'INSERT' then
    select cat.contest_id into v_contest from public.categories cat where cat.id = new.category_id;
    if v_contest is distinct from private.contestant_contest(new.contestant_id) then
      raise exception 'The contestant and category must be in the same contest' using errcode = 'P0001';
    end if;
    if new.tier >= (select jsonb_array_length(deductions) from public.categories where id = new.category_id) then
      raise exception 'That deduction is not defined for this category' using errcode = 'P0001';
    end if;
    new.contest_id := v_contest;
    new.created_by := (select auth.uid());
  end if;
  if (select status from public.contests where id = v_contest) is distinct from 'scoring' then
    raise exception 'Deductions can only be changed while the contest is being scored' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger penalties_validate before insert or delete on public.penalties
  for each row execute function private.validate_penalty();

create policy "penalties: members read" on public.penalties for select to authenticated
  using (private.is_org_member(private.contest_org(contest_id)));
create policy "penalties: producers and tabulators insert" on public.penalties for insert to authenticated
  with check (private.is_org_member(private.contest_org(contest_id)));
create policy "penalties: producers and tabulators delete" on public.penalties for delete to authenticated
  using (private.is_org_member(private.contest_org(contest_id)));

-- ── completeness: panel judges, cross-panel judges, producer-entered cells ──
create or replace function private.missing_scores(p_contest uuid, p_round text) returns int
language sql stable security definer set search_path = '' as $$
  with cells as (
    select ct.id as contestant_id, k.id as component_id, j.id as judge_id, cat.round, ct.finalist, c.finalist_count
      from public.contestants ct
      join public.contests c on c.id = ct.contest_id
      join public.categories cat on cat.contest_id = ct.contest_id and cat.scored_by = 'judges'
      join public.components k on k.category_id = cat.id
      join public.judges j on j.contest_id = ct.contest_id and (not j.guest or cat.guest_average)
     where ct.contest_id = p_contest and not ct.withdrawn
       and (j.guest or not exists (select 1 from public.recusals r where r.judge_id = j.id and r.contestant_id = ct.id))
    union all
    select ct.id, k.id, null, cat.round, ct.finalist, c.finalist_count
      from public.contestants ct
      join public.contests c on c.id = ct.contest_id
      join public.categories cat on cat.contest_id = ct.contest_id and cat.scored_by = 'producer'
      join public.components k on k.category_id = cat.id
     where ct.contest_id = p_contest and not ct.withdrawn
  )
  select count(*)::int from cells x
   where (p_round is null or x.finalist_count is null or x.round = p_round)
     and (x.finalist_count is null or x.round = 'prelim' or x.finalist)
     and not exists (select 1 from public.scores s where s.judge_id is not distinct from x.judge_id
                       and s.contestant_id = x.contestant_id and s.component_id = x.component_id)
$$;

-- ── rubric JSON carries the new settings ────────────────────────────────────
create or replace function private.contest_rubric(p_contest uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with cats as (
    select c.id, c.name, c.drop_rank, c.round, c.scored_by, c.guest_average, c.deductions,
           row_number() over (order by c.sort, c.created_at) - 1 as idx
      from public.categories c where c.contest_id = p_contest
  )
  select jsonb_build_object(
    'aggregation', ct.aggregation,
    'threshold_pct', ct.threshold_pct,
    'threshold_single_only', ct.threshold_single_only,
    'report_as', ct.report_as,
    'anonymize_comments', ct.anonymize_comments,
    'finalist_count', ct.finalist_count,
    'prelim_aggregation', ct.prelim_aggregation,
    'prelim_carries', ct.prelim_carries,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', cats.name, 'drop_rank', cats.drop_rank, 'round', cats.round,
        'scored_by', cats.scored_by, 'guest_average', cats.guest_average, 'deductions', cats.deductions,
        'components', coalesce((
          select jsonb_agg(jsonb_build_object('name', k.name, 'description', k.description,
                                              'min_points', k.min_points, 'max_points', k.max_points, 'step', k.step)
                           order by k.sort, k.created_at)
            from public.components k where k.category_id = cats.id), '[]'::jsonb)
      ) order by cats.idx) from cats), '[]'::jsonb),
    'tiebreak_steps', coalesce((
      select jsonb_agg(jsonb_build_object(
        'categories', (select jsonb_agg(cats.idx order by cats.idx) from cats where cats.id = any (t.category_ids)),
        'all_judges', t.all_judges) order by t.step_no)
        from public.tiebreak_steps t where t.contest_id = p_contest), '[]'::jsonb)
  )
  from public.contests ct where ct.id = p_contest
$$;

create or replace function private.create_contest_from_rubric(p_event uuid, p_name text, p_rubric jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_contest uuid;
  v_cat jsonb;
  v_cat_id uuid;
  v_ids uuid[] := '{}';
  v_comp jsonb;
  v_step jsonb;
  v_idx jsonb;
  i int := 0;
  j int;
begin
  insert into public.contests (event_id, name, aggregation, threshold_pct, threshold_single_only, report_as, anonymize_comments,
                               finalist_count, prelim_aggregation, prelim_carries)
  values (p_event, trim(p_name), coalesce(p_rubric ->> 'aggregation', 'sum'),
          (p_rubric ->> 'threshold_pct')::numeric, coalesce((p_rubric ->> 'threshold_single_only')::boolean, false),
          coalesce(p_rubric ->> 'report_as', 'total'), coalesce((p_rubric ->> 'anonymize_comments')::boolean, true),
          (p_rubric ->> 'finalist_count')::int, coalesce(p_rubric ->> 'prelim_aggregation', 'drop_high_low'),
          coalesce((p_rubric ->> 'prelim_carries')::boolean, false))
  returning id into v_contest;

  for v_cat in select * from jsonb_array_elements(coalesce(p_rubric -> 'categories', '[]'))
  loop
    i := i + 1;
    insert into public.categories (contest_id, name, sort, drop_rank, round, scored_by, guest_average, deductions)
    values (v_contest, v_cat ->> 'name', i, (v_cat ->> 'drop_rank')::int, coalesce(v_cat ->> 'round', 'final'),
            coalesce(v_cat ->> 'scored_by', 'judges'), coalesce((v_cat ->> 'guest_average')::boolean, false),
            coalesce(v_cat -> 'deductions', '[]'))
    returning id into v_cat_id;
    v_ids := v_ids || v_cat_id;
    j := 0;
    for v_comp in select * from jsonb_array_elements(coalesce(v_cat -> 'components', '[]'))
    loop
      j := j + 1;
      insert into public.components (category_id, name, description, min_points, max_points, step, sort)
      values (v_cat_id, v_comp ->> 'name', v_comp ->> 'description', coalesce((v_comp ->> 'min_points')::numeric, 0),
              (v_comp ->> 'max_points')::numeric, coalesce((v_comp ->> 'step')::numeric, 1), j);
    end loop;
  end loop;

  i := 0;
  for v_step in select * from jsonb_array_elements(coalesce(p_rubric -> 'tiebreak_steps', '[]'))
  loop
    i := i + 1;
    v_idx := case when jsonb_typeof(v_step) = 'array' then v_step else v_step -> 'categories' end;
    insert into public.tiebreak_steps (contest_id, step_no, category_ids, all_judges)
    values (v_contest, i, (select array_agg(v_ids[(x::int) + 1] order by x::int) from jsonb_array_elements_text(v_idx) x),
            coalesce((v_step ->> 'all_judges')::boolean, false));
  end loop;

  return v_contest;
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_org_member(uuid, text[]), private.is_platform_admin(), private.shares_org(uuid),
  private.contest_org(uuid), private.category_contest(uuid), private.is_contest_judge(uuid),
  private.contestant_contest(uuid), private.judge_contest(uuid) to authenticated;
