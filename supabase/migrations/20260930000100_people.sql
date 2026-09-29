-- P1.3: contestants (+ producer-only contacts), judges (no login yet), recusals.
-- Also: judges can read the contests they're assigned to, and the "for all" producer
-- policies are split per command (advisor: multiple permissive SELECT policies).

-- ── tables ──────────────────────────────────────────────────────────────────
create table public.contestants (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests (id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  number int check (number > 0),
  represents text check (length(represents) <= 200), -- e.g. "Mr Chicago Leather 2026"
  sort int not null default 0,
  withdrawn boolean not null default false,
  created_at timestamptz not null default now(),
  unique (contest_id, number)
);
create index contestants_contest_idx on public.contestants (contest_id);

-- Split out so tabulators and judges can read contestants without seeing emails (D15).
create table public.contestant_contacts (
  contestant_id uuid primary key references public.contestants (id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

create table public.judges (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  email text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  user_id uuid references public.profiles (id) on delete set null, -- set when the judge claims the seat (P2)
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (contest_id, user_id)
);
create index judges_contest_idx on public.judges (contest_id);
create index judges_user_idx on public.judges (user_id);

create table public.recusals (
  judge_id uuid not null references public.judges (id) on delete cascade,
  contestant_id uuid not null references public.contestants (id) on delete cascade,
  reason text,
  primary key (judge_id, contestant_id)
);
create index recusals_contestant_idx on public.recusals (contestant_id);

alter table public.contests add column manual_winner_contestant_id uuid references public.contestants (id) on delete set null;
grant update (manual_winner_contestant_id) on public.contests to authenticated;

alter table public.contestants enable row level security;
alter table public.contestant_contacts enable row level security;
alter table public.judges enable row level security;
alter table public.recusals enable row level security;

-- ── helpers ─────────────────────────────────────────────────────────────────
create function private.is_contest_judge(p_contest uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.judges where contest_id = p_contest and user_id = (select auth.uid()))
$$;

create function private.contestant_contest(p_contestant uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select contest_id from public.contestants where id = p_contestant
$$;

create function private.judge_contest(p_judge uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select contest_id from public.judges where id = p_judge
$$;

create function private.check_recusal_contest() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.judge_contest(new.judge_id) is distinct from private.contestant_contest(new.contestant_id) then
    raise exception 'The judge and contestant must be in the same contest' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger recusals_same_contest before insert or update on public.recusals
  for each row execute function private.check_recusal_contest();

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_org_member(uuid, text[]), private.is_platform_admin(), private.shares_org(uuid),
  private.contest_org(uuid), private.category_contest(uuid), private.is_contest_judge(uuid),
  private.contestant_contest(uuid), private.judge_contest(uuid) to authenticated;

-- Judges' accounts are linked only by the claim RPC (P2), never directly.
revoke insert, update on public.judges from anon, authenticated;
grant insert (contest_id, name, email, sort) on public.judges to authenticated;
grant update (name, email, sort) on public.judges to authenticated;

-- ── structure policies: add judge read access, split producer writes per command ──
drop policy "contests: members read" on public.contests;
create policy "contests: members and judges read" on public.contests for select to authenticated
  using (private.is_org_member(org_id) or private.is_contest_judge(id));

drop policy "categories: members read" on public.categories;
drop policy "categories: producers write" on public.categories;
create policy "categories: members and judges read" on public.categories for select to authenticated
  using (private.is_org_member(private.contest_org(contest_id)) or private.is_contest_judge(contest_id));
create policy "categories: producers insert" on public.categories for insert to authenticated
  with check (private.is_org_member(private.contest_org(contest_id), array['producer']));
create policy "categories: producers update" on public.categories for update to authenticated
  using (private.is_org_member(private.contest_org(contest_id), array['producer']))
  with check (private.is_org_member(private.contest_org(contest_id), array['producer']));
create policy "categories: producers delete" on public.categories for delete to authenticated
  using (private.is_org_member(private.contest_org(contest_id), array['producer']));

drop policy "components: members read" on public.components;
drop policy "components: producers write" on public.components;
create policy "components: members and judges read" on public.components for select to authenticated
  using (private.is_org_member(private.contest_org(private.category_contest(category_id)))
         or private.is_contest_judge(private.category_contest(category_id)));
create policy "components: producers insert" on public.components for insert to authenticated
  with check (private.is_org_member(private.contest_org(private.category_contest(category_id)), array['producer']));
create policy "components: producers update" on public.components for update to authenticated
  using (private.is_org_member(private.contest_org(private.category_contest(category_id)), array['producer']))
  with check (private.is_org_member(private.contest_org(private.category_contest(category_id)), array['producer']));
create policy "components: producers delete" on public.components for delete to authenticated
  using (private.is_org_member(private.contest_org(private.category_contest(category_id)), array['producer']));

drop policy "tiebreak_steps: producers write" on public.tiebreak_steps;
create policy "tiebreak_steps: producers insert" on public.tiebreak_steps for insert to authenticated
  with check (private.is_org_member(private.contest_org(contest_id), array['producer']));
create policy "tiebreak_steps: producers update" on public.tiebreak_steps for update to authenticated
  using (private.is_org_member(private.contest_org(contest_id), array['producer']))
  with check (private.is_org_member(private.contest_org(contest_id), array['producer']));
create policy "tiebreak_steps: producers delete" on public.tiebreak_steps for delete to authenticated
  using (private.is_org_member(private.contest_org(contest_id), array['producer']));

-- ── people policies ─────────────────────────────────────────────────────────
create policy "contestants: members and judges read" on public.contestants for select to authenticated
  using (private.is_org_member(private.contest_org(contest_id)) or private.is_contest_judge(contest_id));
create policy "contestants: producers insert" on public.contestants for insert to authenticated
  with check (private.is_org_member(private.contest_org(contest_id), array['producer']));
create policy "contestants: producers update" on public.contestants for update to authenticated
  using (private.is_org_member(private.contest_org(contest_id), array['producer']))
  with check (private.is_org_member(private.contest_org(contest_id), array['producer']));
-- Once scoring starts, mark contestants withdrawn instead of deleting them (keeps scores and audit).
create policy "contestants: producers delete in draft" on public.contestants for delete to authenticated
  using (private.is_org_member(private.contest_org(contest_id), array['producer'])
         and exists (select 1 from public.contests c where c.id = contest_id and c.status = 'draft'));

create policy "contestant_contacts: producers only" on public.contestant_contacts for all to authenticated
  using (private.is_org_member(private.contest_org(private.contestant_contest(contestant_id)), array['producer']))
  with check (private.is_org_member(private.contest_org(private.contestant_contest(contestant_id)), array['producer']));

create policy "judges: members read, judges see themselves" on public.judges for select to authenticated
  using (private.is_org_member(private.contest_org(contest_id)) or user_id = (select auth.uid()));
create policy "judges: producers insert" on public.judges for insert to authenticated
  with check (private.is_org_member(private.contest_org(contest_id), array['producer']));
create policy "judges: producers update" on public.judges for update to authenticated
  using (private.is_org_member(private.contest_org(contest_id), array['producer']))
  with check (private.is_org_member(private.contest_org(contest_id), array['producer']));
create policy "judges: producers delete in draft" on public.judges for delete to authenticated
  using (private.is_org_member(private.contest_org(contest_id), array['producer'])
         and exists (select 1 from public.contests c where c.id = contest_id and c.status = 'draft'));

create policy "recusals: members read, judges see their own" on public.recusals for select to authenticated
  using (private.is_org_member(private.contest_org(private.judge_contest(judge_id)))
         or exists (select 1 from public.judges j where j.id = judge_id and j.user_id = (select auth.uid())));
create policy "recusals: producers and tabulators insert" on public.recusals for insert to authenticated
  with check (private.is_org_member(private.contest_org(private.judge_contest(judge_id))));
create policy "recusals: producers and tabulators update" on public.recusals for update to authenticated
  using (private.is_org_member(private.contest_org(private.judge_contest(judge_id))))
  with check (private.is_org_member(private.contest_org(private.judge_contest(judge_id))));
create policy "recusals: producers and tabulators delete" on public.recusals for delete to authenticated
  using (private.is_org_member(private.contest_org(private.judge_contest(judge_id))));
