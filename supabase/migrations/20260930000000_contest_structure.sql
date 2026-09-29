-- P1.2.1: events, contests, rubric (categories → components), tiebreak steps.
-- See docs/design/01-domain-model.md and 03-auth-rls.md. Judge read access arrives with the judges table.

-- ── tables ──────────────────────────────────────────────────────────────────
create table public.events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  starts_on date,
  venue text,
  created_at timestamptz not null default now()
);
create index events_org_idx on public.events (org_id);

create table public.contests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade, -- copied from event by trigger, keeps RLS cheap
  name text not null check (length(trim(name)) between 1 and 120),
  status text not null default 'draft' check (status in ('draft', 'scoring', 'finalized', 'published')),
  aggregation text not null default 'sum' check (aggregation in ('sum', 'drop_high_low')),
  threshold_pct numeric(5, 2) check (threshold_pct between 0 and 100),
  anonymize_comments boolean not null default true,
  manual_winner_reason text,
  created_at timestamptz not null default now()
);
create index contests_event_idx on public.contests (event_id);
create index contests_org_idx on public.contests (org_id);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  sort int not null default 0,
  -- 1 = dropped first in tiebreaks. ponytail: not unique; the UI rewrites all ranks at once. Add an RPC if races matter.
  drop_rank int check (drop_rank > 0),
  created_at timestamptz not null default now()
);
create index categories_contest_idx on public.categories (contest_id);

create table public.components (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  description text,
  min_points numeric(6, 2) not null default 0 check (min_points >= 0), -- scoring engine rounds half-up assuming >= 0
  max_points numeric(6, 2) not null,
  step numeric(4, 2) not null default 1 check (step > 0),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  check (max_points > min_points),
  check (mod(max_points - min_points, step) = 0)
);
create index components_category_idx on public.components (category_id);

create table public.tiebreak_steps (
  contest_id uuid not null references public.contests (id) on delete cascade,
  step_no int not null check (step_no > 0),
  category_ids uuid[] not null check (cardinality(category_ids) > 0),
  primary key (contest_id, step_no)
);

alter table public.events enable row level security;
alter table public.contests enable row level security;
alter table public.categories enable row level security;
alter table public.components enable row level security;
alter table public.tiebreak_steps enable row level security;

-- ── helpers ─────────────────────────────────────────────────────────────────
create function private.contest_org(p_contest uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select org_id from public.contests where id = p_contest
$$;

create function private.category_contest(p_category uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select contest_id from public.categories where id = p_category
$$;

-- No-op when the contest is already gone (cascading deletes).
create function private.assert_contest_draft(p_contest uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if exists (select 1 from public.contests where id = p_contest and status <> 'draft') then
    raise exception 'The rubric is locked once scoring starts' using errcode = 'P0001';
  end if;
end $$;

-- ── triggers ────────────────────────────────────────────────────────────────
create function private.set_contest_org() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.org_id := (select org_id from public.events where id = new.event_id);
  return new;
end $$;
create trigger contests_set_org before insert or update of event_id on public.contests
  for each row execute function private.set_contest_org();

-- Scoring rules can't change under the judges: aggregation and threshold lock with the rubric.
create function private.lock_contest_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status <> 'draft'
     and (new.aggregation is distinct from old.aggregation or new.threshold_pct is distinct from old.threshold_pct) then
    raise exception 'Scoring rules are locked once scoring starts' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger contests_lock_rules before update on public.contests
  for each row execute function private.lock_contest_rules();

create function private.lock_category() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_contest_draft(coalesce(new.contest_id, old.contest_id));
  return coalesce(new, old);
end $$;
create trigger categories_lock before insert or update or delete on public.categories
  for each row execute function private.lock_category();
create trigger tiebreak_steps_lock before insert or update or delete on public.tiebreak_steps
  for each row execute function private.lock_category();

create function private.lock_component() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_contest_draft(private.category_contest(coalesce(new.category_id, old.category_id)));
  return coalesce(new, old);
end $$;
create trigger components_lock before insert or update or delete on public.components
  for each row execute function private.lock_component();

create function private.check_tiebreak_categories() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select unnest(new.category_ids)
    except
    select id from public.categories where contest_id = new.contest_id
  ) then
    raise exception 'Tiebreak steps can only use this contest''s categories' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger tiebreak_steps_check before insert or update on public.tiebreak_steps
  for each row execute function private.check_tiebreak_categories();

-- Deleting a category removes it from tiebreak steps; steps left empty are dropped.
create function private.prune_tiebreak_steps() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.tiebreak_steps set category_ids = array_remove(category_ids, old.id)
    where contest_id = old.contest_id and old.id = any (category_ids) and cardinality(category_ids) > 1;
  delete from public.tiebreak_steps where contest_id = old.contest_id and category_ids = array[old.id];
  return old;
end $$;
create trigger categories_prune_tiebreak after delete on public.categories
  for each row execute function private.prune_tiebreak_steps();

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_org_member(uuid, text[]), private.is_platform_admin(), private.shares_org(uuid),
  private.contest_org(uuid), private.category_contest(uuid) to authenticated;

-- ── column privileges: status only changes through RPCs (P1.5.2); org_id comes from the event ──
-- Events can't move between orgs (contests copy org_id from their event).
revoke update on public.events from anon, authenticated;
grant update (name, starts_on, venue) on public.events to authenticated;
revoke insert, update on public.contests from anon, authenticated;
grant insert (event_id, name, aggregation, threshold_pct, anonymize_comments) on public.contests to authenticated;
grant update (name, aggregation, threshold_pct, anonymize_comments, manual_winner_reason) on public.contests to authenticated;

-- ── policies ────────────────────────────────────────────────────────────────
create policy "events: members read" on public.events for select to authenticated
  using (private.is_org_member(org_id));
create policy "events: producers insert" on public.events for insert to authenticated
  with check (private.is_org_member(org_id, array['producer']));
create policy "events: producers update" on public.events for update to authenticated
  using (private.is_org_member(org_id, array['producer'])) with check (private.is_org_member(org_id, array['producer']));
create policy "events: producers delete when nothing is scored" on public.events for delete to authenticated
  using (private.is_org_member(org_id, array['producer'])
         and not exists (select 1 from public.contests c where c.event_id = events.id and c.status <> 'draft'));

create policy "contests: members read" on public.contests for select to authenticated
  using (private.is_org_member(org_id));
create policy "contests: producers insert" on public.contests for insert to authenticated
  with check (private.is_org_member(org_id, array['producer']));
create policy "contests: producers update" on public.contests for update to authenticated
  using (private.is_org_member(org_id, array['producer'])) with check (private.is_org_member(org_id, array['producer']));
create policy "contests: producers delete drafts" on public.contests for delete to authenticated
  using (private.is_org_member(org_id, array['producer']) and status = 'draft');

create policy "categories: members read" on public.categories for select to authenticated
  using (private.is_org_member(private.contest_org(contest_id)));
create policy "categories: producers write" on public.categories for all to authenticated
  using (private.is_org_member(private.contest_org(contest_id), array['producer']))
  with check (private.is_org_member(private.contest_org(contest_id), array['producer']));

create policy "components: members read" on public.components for select to authenticated
  using (private.is_org_member(private.contest_org(private.category_contest(category_id))));
create policy "components: producers write" on public.components for all to authenticated
  using (private.is_org_member(private.contest_org(private.category_contest(category_id)), array['producer']))
  with check (private.is_org_member(private.contest_org(private.category_contest(category_id)), array['producer']));

create policy "tiebreak_steps: members read" on public.tiebreak_steps for select to authenticated
  using (private.is_org_member(private.contest_org(contest_id)));
create policy "tiebreak_steps: producers write" on public.tiebreak_steps for all to authenticated
  using (private.is_org_member(private.contest_org(contest_id), array['producer']))
  with check (private.is_org_member(private.contest_org(contest_id), array['producer']));
