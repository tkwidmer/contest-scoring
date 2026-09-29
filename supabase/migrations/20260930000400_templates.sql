-- P1.2.4 + P3.3: clone a contest, and rubric templates (org-private, public, or curated by a platform admin).
-- Both copy the rubric only: settings, categories, components, tiebreak steps. Never contestants, judges or scores.
--
-- Rubric JSON shape (also what templates store):
-- { "aggregation": "sum" | "drop_high_low", "threshold_pct": number | null, "anonymize_comments": bool,
--   "categories": [ { "name", "drop_rank": int | null,
--                     "components": [ { "name", "description", "min_points", "max_points", "step" } ] } ],
--   "tiebreak_steps": [ [category index, ...], ... ] }   -- indexes into "categories", 0-based

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.orgs (id) on delete cascade, -- null for curated templates
  name text not null check (length(trim(name)) between 1 and 120),
  description text check (length(description) <= 2000),
  visibility text not null default 'private' check (visibility in ('private', 'public', 'curated')),
  rubric jsonb not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((visibility = 'curated') = (org_id is null))
);
create index templates_org_idx on public.templates (org_id);
alter table public.templates enable row level security;
-- Templates are created by save_contest_as_template; clients may rename, re-describe, change visibility or delete.
revoke insert, update on public.templates from anon, authenticated;
grant update (name, description, visibility) on public.templates to authenticated;

create policy "templates: read own org's, public and curated" on public.templates for select to authenticated
  using (visibility in ('public', 'curated') or private.is_org_member(org_id));
create policy "templates: owners edit" on public.templates for update to authenticated
  using (case when visibility = 'curated' then private.is_platform_admin() else private.is_org_member(org_id, array['producer']) end)
  with check (case when visibility = 'curated' then private.is_platform_admin() else private.is_org_member(org_id, array['producer']) end);
create policy "templates: owners delete" on public.templates for delete to authenticated
  using (case when visibility = 'curated' then private.is_platform_admin() else private.is_org_member(org_id, array['producer']) end);

-- ── rubric helpers ──────────────────────────────────────────────────────────
create function private.contest_rubric(p_contest uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with cats as (
    select c.id, c.name, c.drop_rank, row_number() over (order by c.sort, c.created_at) - 1 as idx
      from public.categories c where c.contest_id = p_contest
  )
  select jsonb_build_object(
    'aggregation', ct.aggregation,
    'threshold_pct', ct.threshold_pct,
    'anonymize_comments', ct.anonymize_comments,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', cats.name, 'drop_rank', cats.drop_rank,
        'components', coalesce((
          select jsonb_agg(jsonb_build_object('name', k.name, 'description', k.description,
                                              'min_points', k.min_points, 'max_points', k.max_points, 'step', k.step)
                           order by k.sort, k.created_at)
            from public.components k where k.category_id = cats.id), '[]'::jsonb)
      ) order by cats.idx) from cats), '[]'::jsonb),
    'tiebreak_steps', coalesce((
      select jsonb_agg((select jsonb_agg(cats.idx order by cats.idx) from cats where cats.id = any (t.category_ids)) order by t.step_no)
        from public.tiebreak_steps t where t.contest_id = p_contest), '[]'::jsonb)
  )
  from public.contests ct where ct.id = p_contest
$$;

create function private.create_contest_from_rubric(p_event uuid, p_name text, p_rubric jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_contest uuid;
  v_cat jsonb;
  v_cat_id uuid;
  v_ids uuid[] := '{}';
  v_comp jsonb;
  v_step jsonb;
  i int := 0;
  j int;
begin
  insert into public.contests (event_id, name, aggregation, threshold_pct, anonymize_comments)
  values (p_event, trim(p_name), coalesce(p_rubric ->> 'aggregation', 'sum'),
          (p_rubric ->> 'threshold_pct')::numeric, coalesce((p_rubric ->> 'anonymize_comments')::boolean, true))
  returning id into v_contest;

  for v_cat in select * from jsonb_array_elements(coalesce(p_rubric -> 'categories', '[]'))
  loop
    i := i + 1;
    insert into public.categories (contest_id, name, sort, drop_rank)
    values (v_contest, v_cat ->> 'name', i, (v_cat ->> 'drop_rank')::int)
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
    insert into public.tiebreak_steps (contest_id, step_no, category_ids)
    values (v_contest, i, (select array_agg(v_ids[(x::int) + 1] order by x::int) from jsonb_array_elements_text(v_step) x));
  end loop;

  return v_contest;
end $$;

-- ── RPCs ────────────────────────────────────────────────────────────────────
create function public.clone_contest(p_source uuid, p_event uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_org_member(private.contest_org(p_source)) then
    raise exception 'You can only copy contests from your own organizations' using errcode = '42501';
  end if;
  if not private.is_org_member((select org_id from public.events where id = p_event), array['producer']) then
    raise exception 'Only producers can add contests to this event' using errcode = '42501';
  end if;
  return private.create_contest_from_rubric(p_event, p_name, private.contest_rubric(p_source));
end $$;

create function public.create_contest_from_template(p_template uuid, p_event uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_rubric jsonb;
begin
  select rubric into v_rubric from public.templates
   where id = p_template and (visibility in ('public', 'curated') or private.is_org_member(org_id));
  if v_rubric is null then
    raise exception 'Template not found' using errcode = 'P0001';
  end if;
  if not private.is_org_member((select org_id from public.events where id = p_event), array['producer']) then
    raise exception 'Only producers can add contests to this event' using errcode = '42501';
  end if;
  return private.create_contest_from_rubric(p_event, p_name, v_rubric);
end $$;

create function public.save_contest_as_template(p_contest uuid, p_name text, p_description text, p_visibility text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := private.contest_org(p_contest);
  v_id uuid;
begin
  if not private.is_org_member(v_org, array['producer']) then
    raise exception 'Only producers can save templates' using errcode = '42501';
  end if;
  if p_visibility = 'curated' and not private.is_platform_admin() then
    raise exception 'Only platform admins can publish curated templates' using errcode = '42501';
  end if;
  insert into public.templates (org_id, name, description, visibility, rubric, created_by)
  values (case when p_visibility = 'curated' then null else v_org end, trim(p_name), nullif(trim(p_description), ''),
          p_visibility, private.contest_rubric(p_contest), (select auth.uid()))
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.clone_contest(uuid, uuid, text), public.create_contest_from_template(uuid, uuid, text),
  public.save_contest_as_template(uuid, text, text, text) from public, anon;
grant execute on function public.clone_contest(uuid, uuid, text), public.create_contest_from_template(uuid, uuid, text),
  public.save_contest_as_template(uuid, text, text, text) to authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_org_member(uuid, text[]), private.is_platform_admin(), private.shares_org(uuid),
  private.contest_org(uuid), private.category_contest(uuid), private.is_contest_judge(uuid),
  private.contestant_contest(uuid), private.judge_contest(uuid) to authenticated;
