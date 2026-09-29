-- Prelims -> finals (IML, IMBB), drop-by-judge-total aggregation (IML finals), and tiebreak steps that count
-- every judge. A contest has rounds when finalist_count is set; categories are marked prelim or final.

alter table public.contests drop constraint contests_aggregation_check;
alter table public.contests
  add constraint contests_aggregation_check check (aggregation in ('sum', 'drop_high_low', 'drop_high_low_total')),
  add column finalist_count int check (finalist_count > 0), -- null: single round
  add column prelim_aggregation text not null default 'drop_high_low' check (prelim_aggregation in ('sum', 'drop_high_low', 'drop_high_low_total')),
  add column prelim_carries boolean not null default false, -- prelim scores count in the finals (IMBB) or not (IML)
  add column finalists_confirmed_at timestamptz;
grant insert (finalist_count, prelim_aggregation, prelim_carries) on public.contests to authenticated;
grant update (finalist_count, prelim_aggregation, prelim_carries) on public.contests to authenticated;

alter table public.categories add column round text not null default 'final' check (round in ('prelim', 'final'));
alter table public.tiebreak_steps add column all_judges boolean not null default false;

-- Finalists are set only by confirm_finalists.
alter table public.contestants add column finalist boolean not null default false;
revoke insert, update on public.contestants from anon, authenticated;
grant insert (contest_id, display_name, number, represents, sort, withdrawn) on public.contestants to authenticated;
grant update (display_name, number, represents, sort, withdrawn) on public.contestants to authenticated;

-- Round settings lock with the rest of the scoring rules.
create or replace function private.lock_contest_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status <> 'draft' and (
       new.aggregation is distinct from old.aggregation or new.threshold_pct is distinct from old.threshold_pct
    or new.finalist_count is distinct from old.finalist_count or new.prelim_aggregation is distinct from old.prelim_aggregation
    or new.prelim_carries is distinct from old.prelim_carries) then
    raise exception 'Scoring rules are locked once scoring starts' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ── score validation: final-round categories only take finalists ──────────
create or replace function private.validate_score() returns trigger
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
         k.min_points, k.max_points, k.step, c.status, c.finalist_count, cat.round, ct.finalist
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
  if r.finalist_count is not null and r.round = 'final' and not r.finalist then
    raise exception 'Only finalists are scored in the finals' using errcode = 'P0001';
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

-- Expected score cells not yet entered: every judge x component x active contestant, except recusals;
-- in contests with rounds, final-round components only count for finalists. p_round: 'prelim', 'final' or null (all).
create function private.missing_scores(p_contest uuid, p_round text) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int
    from public.contestants ct
    join public.contests c on c.id = ct.contest_id
    join public.judges j on j.contest_id = ct.contest_id
    join public.categories cat on cat.contest_id = ct.contest_id
    join public.components k on k.category_id = cat.id
   where ct.contest_id = p_contest and not ct.withdrawn
     and (p_round is null or c.finalist_count is null or cat.round = p_round)
     and (c.finalist_count is null or cat.round = 'prelim' or ct.finalist)
     and not exists (select 1 from public.recusals r where r.judge_id = j.id and r.contestant_id = ct.id)
     and not exists (select 1 from public.scores s where s.judge_id = j.id and s.contestant_id = ct.id and s.component_id = k.id)
$$;

-- ── confirm the cut ─────────────────────────────────────────────────────────
-- The browser proposes the top N (engine + tiebreaks + any producer pick at the line); the database checks
-- role, status, prelim completeness, the count, and that nobody with finals scores is being dropped.
create function public.confirm_finalists(p_contest uuid, p_finalists uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c record;
  v_active int;
begin
  select status, org_id, finalist_count into c from public.contests where id = p_contest for update;
  if c.org_id is null or not private.is_org_member(c.org_id, array['producer']) then
    raise exception 'Only producers can confirm finalists' using errcode = '42501';
  end if;
  if c.finalist_count is null then
    raise exception 'This contest has no preliminary round' using errcode = 'P0001';
  end if;
  if c.status <> 'scoring' then
    raise exception 'Finalists can only be confirmed while the contest is being scored' using errcode = 'P0001';
  end if;
  if private.missing_scores(p_contest, 'prelim') > 0 then
    raise exception '% preliminary score(s) are still missing', private.missing_scores(p_contest, 'prelim') using errcode = 'P0001';
  end if;
  select count(*) into v_active from public.contestants where contest_id = p_contest and not withdrawn;
  if cardinality(p_finalists) <> least(c.finalist_count, v_active)
     or (select count(*) from public.contestants where id = any (p_finalists) and contest_id = p_contest and not withdrawn) <> cardinality(p_finalists) then
    raise exception 'Choose exactly % finalists from this contest''s contestants', least(c.finalist_count, v_active) using errcode = 'P0001';
  end if;
  if exists (select 1 from public.scores s join public.components k on k.id = s.component_id join public.categories cat on cat.id = k.category_id
              where s.contest_id = p_contest and cat.round = 'final' and not (s.contestant_id = any (p_finalists))) then
    raise exception 'Someone being removed from the finals already has finals scores; clear them first' using errcode = 'P0001';
  end if;

  update public.contestants set finalist = (id = any (p_finalists)) where contest_id = p_contest;
  update public.contests set finalists_confirmed_at = now() where id = p_contest;
end $$;
revoke execute on function public.confirm_finalists(uuid, uuid[]) from public, anon;
grant execute on function public.confirm_finalists(uuid, uuid[]) to authenticated;

-- ── finalize: rounds-aware completeness and winner ──────────────────────────
create or replace function public.finalize_contest(p_contest uuid, p_result jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
  v_org uuid;
  v_rounds boolean;
  v_confirmed timestamptz;
  v_missing int;
  v_kind text := p_result -> 'winner' ->> 'kind';
  v_winner uuid;
begin
  select status, org_id, finalist_count is not null, finalists_confirmed_at into v_status, v_org, v_rounds, v_confirmed
    from public.contests where id = p_contest for update;
  if v_org is null or not private.is_org_member(v_org, array['producer']) then
    raise exception 'Only producers can finalize a contest' using errcode = '42501';
  end if;
  if v_status <> 'scoring' then
    raise exception 'Only a contest being scored can be finalized' using errcode = 'P0001';
  end if;
  if v_rounds and v_confirmed is null then
    raise exception 'Confirm the finalists before finalizing' using errcode = 'P0001';
  end if;
  v_missing := private.missing_scores(p_contest, null);
  if v_missing > 0 then
    raise exception '% score(s) are still missing', v_missing using errcode = 'P0001';
  end if;

  if v_kind = 'decided' then
    v_winner := (p_result -> 'winner' ->> 'contestantId')::uuid;
    if not exists (select 1 from public.contestants where id = v_winner and contest_id = p_contest and not withdrawn
                     and (not v_rounds or finalist)) then
      raise exception 'The winner must be a contestant in this contest' using errcode = 'P0001';
    end if;
  elsif v_kind is distinct from 'no_title' then
    raise exception 'Resolve the tie before finalizing' using errcode = 'P0001';
  end if;

  update public.contests set status = 'finalized', final_result = p_result, finalized_at = now() where id = p_contest;
end $$;

-- ── rubric JSON: rounds, per-category round, tiebreak steps as objects ─────
-- tiebreak_steps entries are { "categories": [index, ...], "all_judges": bool }; plain arrays are still accepted.
create or replace function private.contest_rubric(p_contest uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with cats as (
    select c.id, c.name, c.drop_rank, c.round, row_number() over (order by c.sort, c.created_at) - 1 as idx
      from public.categories c where c.contest_id = p_contest
  )
  select jsonb_build_object(
    'aggregation', ct.aggregation,
    'threshold_pct', ct.threshold_pct,
    'anonymize_comments', ct.anonymize_comments,
    'finalist_count', ct.finalist_count,
    'prelim_aggregation', ct.prelim_aggregation,
    'prelim_carries', ct.prelim_carries,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', cats.name, 'drop_rank', cats.drop_rank, 'round', cats.round,
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
  insert into public.contests (event_id, name, aggregation, threshold_pct, anonymize_comments, finalist_count, prelim_aggregation, prelim_carries)
  values (p_event, trim(p_name), coalesce(p_rubric ->> 'aggregation', 'sum'),
          (p_rubric ->> 'threshold_pct')::numeric, coalesce((p_rubric ->> 'anonymize_comments')::boolean, true),
          (p_rubric ->> 'finalist_count')::int, coalesce(p_rubric ->> 'prelim_aggregation', 'drop_high_low'),
          coalesce((p_rubric ->> 'prelim_carries')::boolean, false))
  returning id into v_contest;

  for v_cat in select * from jsonb_array_elements(coalesce(p_rubric -> 'categories', '[]'))
  loop
    i := i + 1;
    insert into public.categories (contest_id, name, sort, drop_rank, round)
    values (v_contest, v_cat ->> 'name', i, (v_cat ->> 'drop_rank')::int, coalesce(v_cat ->> 'round', 'final'))
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
