-- Contest and event logos. Files live in the public `logos` bucket under <org id>/<random name>: anyone can fetch them
-- (public results), only the org's producers can add or remove them. The paths are stored on the event and contest,
-- and publish_contest copies them into the public snapshot (so a logo added after publishing shows once re-published).
alter table public.events add column logo_path text;
alter table public.contests add column logo_path text;
grant update (logo_path) on public.events to authenticated;
grant update (logo_path) on public.contests to authenticated;
-- contests has column-level select grants (final_result is members-only), so a new readable column needs its own.
grant select (logo_path) on public.contests to authenticated;

-- No SVG: it can carry script, and these files are served from our storage domain.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 1048576, array['image/png', 'image/jpeg', 'image/webp']);

create policy "logos: producers upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'logos' and private.is_org_member(((storage.foldername(name))[1])::uuid, array['producer']));
-- Deleting a row also needs to see it, so producers get a select policy (public reads don't go through RLS).
create policy "logos: producers read" on storage.objects for select to authenticated
  using (bucket_id = 'logos' and private.is_org_member(((storage.foldername(name))[1])::uuid, array['producer']));
create policy "logos: producers delete" on storage.objects for delete to authenticated
  using (bucket_id = 'logos' and private.is_org_member(((storage.foldername(name))[1])::uuid, array['producer']));

create or replace function public.publish_contest(p_contest uuid, p_show_breakdown boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c record;
  v_snapshot jsonb;
begin
  select ct.*, e.name as event_name, e.starts_on as event_date, e.logo_path as event_logo into c from public.contests ct join public.events e on e.id = ct.event_id
   where ct.id = p_contest for update of ct;
  if c.id is null or not private.is_org_member(c.org_id, array['producer']) then
    raise exception 'Only producers can publish results' using errcode = '42501';
  end if;
  if c.status not in ('finalized', 'published') or c.final_result is null then
    raise exception 'Finalize the results before publishing them' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'org', (select name from public.orgs where id = c.org_id),
    'contest', c.name,
    'event', c.event_name,
    'date', c.event_date,
    'logo', c.logo_path,
    'eventLogo', c.event_logo,
    'prelim', case when c.final_result ? 'prelim' then (
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'rank', (s ->> 'rank')::int, 'name', ct.display_name, 'number', ct.number, 'finalist', ct.finalist,
        'total', case when p_show_breakdown then s -> 'total' end,
        'pct', case when p_show_breakdown then s -> 'pct' end))
        order by (s ->> 'rank')::int, ct.sort)
        from jsonb_array_elements(c.final_result -> 'prelim' -> 'standings') s
        join public.contestants ct on ct.id = (s ->> 'contestantId')::uuid) end,
    'winner', case c.final_result -> 'winner' ->> 'kind'
      when 'decided' then jsonb_build_object('name', (select display_name from public.contestants where id = (c.final_result -> 'winner' ->> 'contestantId')::uuid),
                                             'reason', case when (c.final_result -> 'winner' ->> 'manual')::boolean then c.manual_winner_reason end)
      else null end,
    'maxPossible', case when p_show_breakdown then c.final_result -> 'maxPossible' end,
    'thresholdPct', c.threshold_pct,
    'categories', case when p_show_breakdown then (
      select jsonb_agg(cat.name order by cat.sort, cat.created_at) from public.categories cat
       where cat.contest_id = c.id and c.final_result -> 'standings' -> 0 -> 'categoryTotals' ? cat.id::text) end,
    'standings', (
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'rank', (s ->> 'rank')::int, 'name', ct.display_name, 'number', ct.number,
        'total', case when p_show_breakdown then s -> 'total' end,
        'pct', case when p_show_breakdown then s -> 'pct' end,
        'categoryTotals', case when p_show_breakdown then (
          select jsonb_agg(s -> 'categoryTotals' -> cat.id::text order by cat.sort, cat.created_at) from public.categories cat
           where cat.contest_id = c.id and s -> 'categoryTotals' ? cat.id::text) end))
        order by (s ->> 'rank')::int, ct.sort)
        from jsonb_array_elements(c.final_result -> 'standings') s
        join public.contestants ct on ct.id = (s ->> 'contestantId')::uuid)
  ) into v_snapshot;

  insert into public.published_results (contest_id, org_id, snapshot, show_breakdown, published_by)
  values (c.id, c.org_id, v_snapshot, p_show_breakdown, (select auth.uid()))
  on conflict (contest_id) do update set snapshot = excluded.snapshot, show_breakdown = excluded.show_breakdown,
    published_at = now(), published_by = excluded.published_by;
  update public.contests set status = 'published' where id = c.id;
end $$;
