-- Cross-panel categories: scored only by the cross-panel (guest) judges, as a panel of their own (IMsBB 2024:
-- the five IMsL judges score a separate 300-point interview, dropping their high and low). The guest-average
-- option on panel categories stays for contests that fold the other panel into one extra judge.
-- Cross-panel judges can now be recused too; the engine backfills them from the other cross-panel judges.

alter table public.categories drop constraint categories_scored_by_check;
alter table public.categories add constraint categories_scored_by_check check (scored_by in ('judges', 'producer', 'cross_panel'));

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

  new.contest_id := r.contest_id;
  new.entered_by := (select auth.uid());
  new.updated_at := now();
  return new;
end $$;

create or replace function private.missing_scores(p_contest uuid, p_round text) returns int
language sql stable security definer set search_path = '' as $$
  with cells as (
    select ct.id as contestant_id, k.id as component_id, j.id as judge_id, cat.round, ct.finalist, c.finalist_count
      from public.contestants ct
      join public.contests c on c.id = ct.contest_id
      join public.categories cat on cat.contest_id = ct.contest_id and cat.scored_by in ('judges', 'cross_panel')
      join public.components k on k.category_id = cat.id
      join public.judges j on j.contest_id = ct.contest_id
       and case cat.scored_by when 'cross_panel' then j.guest else not j.guest or cat.guest_average end
     where ct.contest_id = p_contest and not ct.withdrawn
       and not exists (select 1 from public.recusals r where r.judge_id = j.id and r.contestant_id = ct.id)
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
