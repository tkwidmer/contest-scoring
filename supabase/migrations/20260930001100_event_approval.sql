-- Event approval: a contest can't start scoring until a platform admin approves its event, which happens once the
-- $100 event fee is paid (see /pricing). Producers request approval; platform admins approve or revoke it.
-- Events that already exist are approved so nothing in progress stops working.

alter table public.events
  add column approval_requested_at timestamptz,
  add column approval_requested_by uuid references public.profiles (id) on delete set null,
  add column approved_at timestamptz,
  add column approved_by uuid references public.profiles (id) on delete set null;
update public.events set approved_at = now();

-- Clients may only set these columns; approval goes through the RPCs below.
revoke insert on public.events from anon, authenticated;
grant insert (org_id, name, starts_on, venue) on public.events to authenticated;

create function public.request_event_approval(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.events where id = p_event for update;
  if v_org is null or not private.is_org_member(v_org, array['producer']) then
    raise exception 'Only producers can request approval for an event' using errcode = '42501';
  end if;
  update public.events set approval_requested_at = coalesce(approval_requested_at, now()),
                           approval_requested_by = coalesce(approval_requested_by, (select auth.uid()))
   where id = p_event and approved_at is null;
end $$;

create function public.set_event_approval(p_event uuid, p_approved boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Only platform admins can approve events' using errcode = '42501';
  end if;
  update public.events
     set approved_at = case when p_approved then coalesce(approved_at, now()) end,
         approved_by = case when p_approved then coalesce(approved_by, (select auth.uid())) end
   where id = p_event;
  if not found then
    raise exception 'Unknown event' using errcode = 'P0001';
  end if;
end $$;

-- The platform admin's approval queue: every event, requested ones first, with who asked (to send payment details).
create function public.event_approvals() returns table (
  event_id uuid, event_name text, org_name text, starts_on date, contests int,
  requested_at timestamptz, requested_by_email text, approved_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Only platform admins can see event approvals' using errcode = '42501';
  end if;
  return query
    select e.id, e.name, o.name, e.starts_on, (select count(*)::int from public.contests c where c.event_id = e.id),
           e.approval_requested_at, u.email::text, e.approved_at
      from public.events e
      join public.orgs o on o.id = e.org_id
      left join auth.users u on u.id = e.approval_requested_by
     order by (e.approved_at is null and e.approval_requested_at is not null) desc, e.approved_at is null desc,
              coalesce(e.approval_requested_at, e.created_at) desc;
end $$;

revoke execute on function public.request_event_approval(uuid), public.set_event_approval(uuid, boolean), public.event_approvals()
  from public, anon;
grant execute on function public.request_event_approval(uuid), public.set_event_approval(uuid, boolean), public.event_approvals()
  to authenticated;

-- Scoring needs an approved event.
create or replace function public.set_contest_status(p_contest uuid, p_status text) returns void
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
    if not exists (select 1 from public.contests c join public.events e on e.id = c.event_id
                    where c.id = p_contest and e.approved_at is not null) then
      raise exception 'This event isn''t approved yet. Scoring opens once the event fee is paid and the event is approved.' using errcode = 'P0001';
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
