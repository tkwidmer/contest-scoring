-- P1.5.2: finalize (freeze the engine's result) and reopen. The scoring engine runs in the browser
-- (design D21), so the client sends its result; the database checks what it can: producer role, every
-- expected score present, and a decided outcome (a winner in this contest, or no title).

alter table public.contests add column final_result jsonb, add column finalized_at timestamptz;
-- No client write privileges on these: only finalize_contest / set_contest_status set them.

create function public.finalize_contest(p_contest uuid, p_result jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
  v_org uuid;
  v_missing int;
  v_kind text := p_result -> 'winner' ->> 'kind';
  v_winner uuid;
begin
  select status, org_id into v_status, v_org from public.contests where id = p_contest for update;
  if v_org is null or not private.is_org_member(v_org, array['producer']) then
    raise exception 'Only producers can finalize a contest' using errcode = '42501';
  end if;
  if v_status <> 'scoring' then
    raise exception 'Only a contest being scored can be finalized' using errcode = 'P0001';
  end if;

  select count(*) into v_missing
    from public.contestants ct
    join public.judges j on j.contest_id = ct.contest_id
    join public.categories cat on cat.contest_id = ct.contest_id
    join public.components k on k.category_id = cat.id
   where ct.contest_id = p_contest and not ct.withdrawn
     and not exists (select 1 from public.recusals r where r.judge_id = j.id and r.contestant_id = ct.id)
     and not exists (select 1 from public.scores s where s.judge_id = j.id and s.contestant_id = ct.id and s.component_id = k.id);
  if v_missing > 0 then
    raise exception '% score(s) are still missing', v_missing using errcode = 'P0001';
  end if;

  if v_kind = 'decided' then
    v_winner := (p_result -> 'winner' ->> 'contestantId')::uuid;
    if not exists (select 1 from public.contestants where id = v_winner and contest_id = p_contest and not withdrawn) then
      raise exception 'The winner must be a contestant in this contest' using errcode = 'P0001';
    end if;
  elsif v_kind is distinct from 'no_title' then
    raise exception 'Resolve the tie before finalizing' using errcode = 'P0001';
  end if;

  update public.contests set status = 'finalized', final_result = p_result, finalized_at = now() where id = p_contest;
end $$;
revoke execute on function public.finalize_contest(uuid, jsonb) from public, anon;
grant execute on function public.finalize_contest(uuid, jsonb) to authenticated;

-- Adds finalized -> scoring (reopen), which discards the frozen result.
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
