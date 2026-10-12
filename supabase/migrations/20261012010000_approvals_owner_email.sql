-- The approvals queue shows who to contact for every event, not only requested ones: the requester, else the org's
-- earliest producer.
drop function public.event_approvals();
create function public.event_approvals() returns table (
  event_id uuid, event_name text, org_name text, starts_on date, contests int,
  requested_at timestamptz, owner_email text, approved_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Only platform admins can see event approvals' using errcode = '42501';
  end if;
  return query
    select e.id, e.name, o.name, e.starts_on, (select count(*)::int from public.contests c where c.event_id = e.id),
           e.approval_requested_at,
           (select u.email::text from auth.users u
             where u.id = coalesce(e.approval_requested_by,
                                   (select m.user_id from public.org_members m
                                     where m.org_id = e.org_id and m.role = 'producer'
                                     order by m.created_at limit 1))),
           e.approved_at
      from public.events e
      join public.orgs o on o.id = e.org_id
     order by (e.approved_at is null and e.approval_requested_at is not null) desc, e.approved_at is null desc,
              coalesce(e.approval_requested_at, e.created_at) desc;
end $$;

revoke execute on function public.event_approvals() from public, anon;
grant execute on function public.event_approvals() to authenticated;
