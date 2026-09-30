-- Approval covers one event date, not an event forever: a contest can start scoring only from 14 days before the
-- event's date until 14 days after it (events approved before dates were required use their approval date).
-- Approval needs a date, and the date is locked while the event is approved. Contests already scoring carry on,
-- and a finalized contest can still be reopened.

create or replace function public.request_event_approval(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_date date;
begin
  select org_id, starts_on into v_org, v_date from public.events where id = p_event for update;
  if v_org is null or not private.is_org_member(v_org, array['producer']) then
    raise exception 'Only producers can request approval for an event' using errcode = '42501';
  end if;
  if v_date is null then
    raise exception 'Add the event''s date before requesting approval' using errcode = 'P0001';
  end if;
  update public.events set approval_requested_at = coalesce(approval_requested_at, now()),
                           approval_requested_by = coalesce(approval_requested_by, (select auth.uid()))
   where id = p_event and approved_at is null;
end $$;

create function private.lock_approved_event_date() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.approved_at is not null and new.approved_at is not null and new.starts_on is distinct from old.starts_on then
    raise exception 'The date can''t change once the event is approved. Ask us to change it.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger events_lock_approved_date before update of starts_on on public.events
  for each row execute function private.lock_approved_event_date();

create or replace function public.set_contest_status(p_contest uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
  v_org uuid;
  v_approved timestamptz;
  v_anchor date;
begin
  select status, org_id into v_status, v_org from public.contests where id = p_contest for update;
  if v_org is null or not private.is_org_member(v_org, array['producer']) then
    raise exception 'Only producers can change a contest''s status' using errcode = '42501';
  end if;

  if v_status = 'draft' and p_status = 'scoring' then
    select e.approved_at, coalesce(e.starts_on, e.approved_at::date) into v_approved, v_anchor
      from public.contests c join public.events e on e.id = c.event_id where c.id = p_contest;
    if v_approved is null then
      raise exception 'This event isn''t approved yet. Scoring opens once the event fee is paid and the event is approved.' using errcode = 'P0001';
    end if;
    if current_date < v_anchor - 14 then
      raise exception 'Scoring opens on %, two weeks before the event.', to_char(v_anchor - 14, 'FMMonth FMDD, YYYY') using errcode = 'P0001';
    end if;
    if current_date > v_anchor + 14 then
      raise exception 'This event''s approval ended on %. Create a new event to score more contests.', to_char(v_anchor + 14, 'FMMonth FMDD, YYYY') using errcode = 'P0001';
    end if;
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
  elsif v_status = 'finalized' and p_status = 'scoring' then
    update public.contests set final_result = null, finalized_at = null where id = p_contest;
  elsif p_status = 'finalized' then
    raise exception 'Use finalize to lock in results' using errcode = 'P0001';
  else
    raise exception 'A contest can''t move from % to %', v_status, p_status using errcode = 'P0001';
  end if;

  update public.contests set status = p_status where id = p_contest;
end $$;
