-- P3: judge comments for contestants, producer review, and published results.
--  * A comment is one judge's note for one contestant, on a category sheet or overall (category null).
--    Judges write their own (while scoring, and not on a submitted sheet); producers write for paper judges
--    (no account). Producers review with review_comment: an edited version and an approval, keeping the original.
--  * publish_contest freezes a public snapshot built from the finalized result; anyone, signed in or not, reads it.

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests (id) on delete cascade, -- set by trigger
  judge_id uuid not null references public.judges (id) on delete cascade,
  contestant_id uuid not null references public.contestants (id) on delete cascade,
  category_id uuid references public.categories (id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 4000),
  edited_body text check (length(edited_body) <= 4000),
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comments_one_per_sheet unique nulls not distinct (judge_id, contestant_id, category_id)
);
create index comments_contest_idx on public.comments (contest_id);
alter table public.comments enable row level security;
revoke insert, update on public.comments from anon, authenticated;
grant insert (judge_id, contestant_id, category_id, body) on public.comments to authenticated;
-- Upserts need update rights on every column they send; the policies and trigger keep judge/contestant/category honest.
grant update (judge_id, contestant_id, category_id, body) on public.comments to authenticated;

-- Who may write a comment's text: the judge themself, or a producer for a judge with no account (paper sheets).
create function private.may_write_comment(p_judge uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_own_judge(p_judge) or exists (
    select 1 from public.judges j where j.id = p_judge and j.user_id is null
       and private.is_org_member(private.contest_org(j.contest_id), array['producer']))
$$;

create policy "comments: producers read, judges see their own" on public.comments for select to authenticated
  using (private.is_org_member(private.contest_org(contest_id), array['producer']) or private.is_own_judge(judge_id));
create policy "comments: writers insert" on public.comments for insert to authenticated
  with check (private.may_write_comment(judge_id));
create policy "comments: writers update" on public.comments for update to authenticated
  using (private.may_write_comment(judge_id)) with check (private.may_write_comment(judge_id));
create policy "comments: writers delete" on public.comments for delete to authenticated
  using (private.may_write_comment(judge_id) and not approved);

create function private.validate_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_contest uuid := private.judge_contest(coalesce(new.judge_id, old.judge_id));
  v_status text := (select status from public.contests where id = v_contest);
begin
  if tg_op = 'DELETE' then
    if v_status not in ('scoring', 'finalized') then
      raise exception 'Comments can only be changed before results are published' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if private.contestant_contest(new.contestant_id) is distinct from v_contest
     or (new.category_id is not null and private.category_contest(new.category_id) is distinct from v_contest) then
    raise exception 'The judge, contestant and category must be in the same contest' using errcode = 'P0001';
  end if;
  -- Judges comment while scoring, and a submitted sheet's comment is locked with it. Producers transcribing
  -- paper comments can also add them after finalizing.
  if private.is_own_judge(new.judge_id) then
    if v_status <> 'scoring' then
      raise exception 'Comments can only be written while the contest is being scored' using errcode = 'P0001';
    end if;
    if new.category_id is not null and exists (select 1 from public.sheet_submissions s where s.judge_id = new.judge_id
        and s.contestant_id = new.contestant_id and s.category_id = new.category_id and s.unlocked_at is null) then
      raise exception 'This sheet was submitted and is locked. A producer can unlock it.' using errcode = 'P0001';
    end if;
  elsif v_status not in ('scoring', 'finalized') then
    raise exception 'Comments can only be changed before results are published' using errcode = 'P0001';
  end if;
  new.contest_id := v_contest;
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.body is distinct from old.body then
    new.approved := false; -- a changed comment needs another look
  end if;
  return new;
end $$;
create trigger comments_validate before insert or update or delete on public.comments
  for each row execute function private.validate_comment();

create function public.review_comment(p_comment uuid, p_edited_body text, p_approved boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_contest uuid := (select contest_id from public.comments where id = p_comment);
begin
  if v_contest is null or not private.is_org_member(private.contest_org(v_contest), array['producer']) then
    raise exception 'Only producers can review comments' using errcode = '42501';
  end if;
  if (select status from public.contests where id = v_contest) = 'published' then
    raise exception 'Comments can only be changed before results are published' using errcode = 'P0001';
  end if;
  update public.comments
     set edited_body = nullif(trim(p_edited_body), ''), approved = p_approved
   where id = p_comment;
end $$;

-- ── published results ───────────────────────────────────────────────────────
create table public.published_results (
  contest_id uuid primary key references public.contests (id) on delete cascade,
  snapshot jsonb not null,
  show_breakdown boolean not null,
  published_at timestamptz not null default now(),
  published_by uuid references public.profiles (id) on delete set null
);
alter table public.published_results enable row level security;
revoke insert, update, delete on public.published_results from anon, authenticated; -- publish_contest only
grant select on public.published_results to anon;
create policy "published_results: everyone reads" on public.published_results for select to anon, authenticated using (true);

-- The snapshot has names, ranks and the winner; with the breakdown, also totals, % and category totals.
-- Never judges, scores per judge, contestant emails or comments.
create function public.publish_contest(p_contest uuid, p_show_breakdown boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c record;
  v_snapshot jsonb;
begin
  select ct.*, e.name as event_name into c from public.contests ct join public.events e on e.id = ct.event_id
   where ct.id = p_contest for update of ct;
  if c.id is null or not private.is_org_member(c.org_id, array['producer']) then
    raise exception 'Only producers can publish results' using errcode = '42501';
  end if;
  if c.status not in ('finalized', 'published') or c.final_result is null then
    raise exception 'Finalize the results before publishing them' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'contest', c.name,
    'event', c.event_name,
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

  insert into public.published_results (contest_id, snapshot, show_breakdown, published_by)
  values (c.id, v_snapshot, p_show_breakdown, (select auth.uid()))
  on conflict (contest_id) do update set snapshot = excluded.snapshot, show_breakdown = excluded.show_breakdown,
    published_at = now(), published_by = excluded.published_by;
  update public.contests set status = 'published' where id = c.id;
end $$;

create function public.unpublish_contest(p_contest uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_org_member(private.contest_org(p_contest), array['producer']) then
    raise exception 'Only producers can unpublish results' using errcode = '42501';
  end if;
  delete from public.published_results where contest_id = p_contest;
  update public.contests set status = 'finalized' where id = p_contest and status = 'published';
end $$;

revoke execute on function public.review_comment(uuid, text, boolean), public.publish_contest(uuid, boolean), public.unpublish_contest(uuid)
  from public, anon;
grant execute on function public.review_comment(uuid, text, boolean), public.publish_contest(uuid, boolean), public.unpublish_contest(uuid)
  to authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_org_member(uuid, text[]), private.is_platform_admin(), private.shares_org(uuid),
  private.contest_org(uuid), private.category_contest(uuid), private.is_contest_judge(uuid),
  private.contestant_contest(uuid), private.judge_contest(uuid), private.is_own_judge(uuid),
  private.may_write_comment(uuid) to authenticated;
