-- P0: profiles, orgs, org membership. See docs/design/01-domain-model.md and 03-auth-rls.md.

-- ── profiles ────────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name) values (new.id, split_part(new.email, '@', 1));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users may only rename themselves; is_platform_admin is set by hand in SQL.
revoke update on public.profiles from anon, authenticated;
grant update (display_name) on public.profiles to authenticated;

-- ── orgs & members ──────────────────────────────────────────────────────────
create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  created_at timestamptz not null default now()
);
alter table public.orgs enable row level security;

create table public.org_members (
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('producer', 'tabulator')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
alter table public.org_members enable row level security;
create index org_members_user_idx on public.org_members (user_id);

-- ── helpers (security definer so policies don't recurse through RLS) ────────
create function public.is_org_member(p_org uuid, p_roles text[] default array['producer', 'tabulator'])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_members
    where org_id = p_org and user_id = (select auth.uid()) and role = any (p_roles)
  )
$$;

create function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select is_platform_admin from public.profiles where id = (select auth.uid())), false)
$$;

create function public.shares_org(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_members a
    join public.org_members b on a.org_id = b.org_id
    where a.user_id = (select auth.uid()) and b.user_id = p_user
  )
$$;

-- ── policies ────────────────────────────────────────────────────────────────
create policy "profiles: self, org-mates, platform admin" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_org(id) or public.is_platform_admin());
create policy "profiles: rename self" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- orgs are created only through create_org(), so no insert policy.
create policy "orgs: members read" on public.orgs for select to authenticated
  using (public.is_org_member(id));
create policy "orgs: producers update" on public.orgs for update to authenticated
  using (public.is_org_member(id, array['producer'])) with check (public.is_org_member(id, array['producer']));

create policy "org_members: members read" on public.org_members for select to authenticated
  using (public.is_org_member(org_id));
create policy "org_members: producers insert" on public.org_members for insert to authenticated
  with check (public.is_org_member(org_id, array['producer']));
create policy "org_members: producers update" on public.org_members for update to authenticated
  using (public.is_org_member(org_id, array['producer'])) with check (public.is_org_member(org_id, array['producer']));
create policy "org_members: producers delete" on public.org_members for delete to authenticated
  using (public.is_org_member(org_id, array['producer']));

-- An org always keeps at least one producer.
create function public.keep_one_producer() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'producer'
     and (tg_op = 'DELETE' or new.role <> 'producer')
     and exists (select 1 from public.orgs where id = old.org_id)
     and not exists (
       select 1 from public.org_members
       where org_id = old.org_id and role = 'producer' and user_id <> old.user_id
     ) then
    raise exception 'An org needs at least one producer' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

create trigger org_members_keep_one_producer before update or delete on public.org_members
  for each row execute function public.keep_one_producer();

-- ── RPC ─────────────────────────────────────────────────────────────────────
create function public.create_org(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  insert into public.orgs (name) values (trim(p_name)) returning id into v_org;
  insert into public.org_members (org_id, user_id, role) values (v_org, (select auth.uid()), 'producer');
  return v_org;
end $$;

revoke execute on function public.create_org(text) from public, anon;
grant execute on function public.create_org(text) to authenticated;
