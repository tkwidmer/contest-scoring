begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev'),   -- producer
  ('22222222-2222-2222-2222-222222222222', 'judy@test.dev'),    -- judge J1
  ('44444444-4444-4444-4444-444444444444', 'tina@test.dev');    -- tabulator
create temp table emails as select id, email from auth.users;
grant select on emails to authenticated;
create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'email',
    (select email from emails where id = p))::text, true)
$$;

set local role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select set_config('test.org', public.create_org('GLL')::text, true);
insert into public.events (org_id, name) values (current_setting('test.org')::uuid, 'GLL 2027');
reset role; update public.events set approved_at = now();
insert into public.org_members (org_id, user_id, role) values (current_setting('test.org')::uuid, '44444444-4444-4444-4444-444444444444', 'tabulator');
set local role authenticated;
insert into public.contests (event_id, name) select id, 'Mr GLL' from public.events;
select set_config('test.c', (select id::text from public.contests), true);
insert into public.categories (contest_id, name) values (current_setting('test.c')::uuid, 'Speech');
select set_config('test.cat', (select id::text from public.categories), true);
insert into public.components (category_id, name, max_points) values (current_setting('test.cat')::uuid, 'Speech', 10);
insert into public.contestants (contest_id, display_name, number, sort) values (current_setting('test.c')::uuid, 'A', 1, 1), (current_setting('test.c')::uuid, 'B', 2, 2);
insert into public.contestant_contacts (contestant_id, email) select id, 'a@private.dev' from public.contestants where display_name = 'A';
insert into public.judges (contest_id, name, email, sort) values (current_setting('test.c')::uuid, 'J1', 'judy@test.dev', 1), (current_setting('test.c')::uuid, 'J2', null, 2);
select public.set_contest_status(current_setting('test.c')::uuid, 'scoring');
select set_config('test.a', (select id::text from public.contestants where display_name = 'A'), true);
select set_config('test.b', (select id::text from public.contestants where display_name = 'B'), true);
select set_config('test.j1', (select id::text from public.judges where name = 'J1'), true);
select set_config('test.j2', (select id::text from public.judges where name = 'J2'), true);

create function pg_temp.comment(judge text, who text, cat boolean, txt text) returns void language sql as $$
  insert into public.comments (judge_id, contestant_id, category_id, body)
  values (current_setting('test.' || judge)::uuid, current_setting('test.' || who)::uuid,
          case when cat then current_setting('test.cat')::uuid end, txt)
  on conflict on constraint comments_one_per_sheet do update set body = excluded.body
$$;

-- ── judges write their own comments ──
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select public.claim_invites();
select lives_ok($$ select pg_temp.comment('j1', 'a', true, 'Strong speech, watch your pacing') $$, 'judge comments on their sheet');
select lives_ok($$ select pg_temp.comment('j1', 'a', false, 'Great weekend overall') $$, 'and overall');
select throws_ok($$ select pg_temp.comment('j2', 'a', true, 'Not mine') $$, '42501', null, 'but not as another judge');
select throws_ok($$ update public.comments set approved = true $$, '42501', null, 'judges cannot approve');
select throws_ok($$ select public.review_comment(id, 'x', true) from public.comments limit 1 $$, '42501', null, 'or review');

-- ── producers ──
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select is((select count(*)::int from public.comments), 2, 'producer sees every comment');
select lives_ok($$ select pg_temp.comment('j2', 'a', true, 'From the paper sheet') $$, 'producer transcribes a paper judge''s comment');
update public.comments set body = 'rewritten' where judge_id = current_setting('test.j1')::uuid;
select is((select count(*)::int from public.comments where body = 'rewritten'), 0, 'producer cannot rewrite a signed-in judge''s original');
select lives_ok($$ select public.review_comment(id, 'Strong speech; watch your pacing.', true) from public.comments
  where judge_id = current_setting('test.j1')::uuid and category_id is not null $$, 'producer edits and approves');
select results_eq($$ select body, edited_body, approved from public.comments where judge_id = current_setting('test.j1')::uuid and category_id is not null $$,
  $$ values ('Strong speech, watch your pacing'::text, 'Strong speech; watch your pacing.'::text, true) $$, 'the original is kept beside the edit');

select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select is((select count(*)::int from public.comments), 0, 'tabulators do not see comments');

-- A judge's change takes the approval back; a submitted sheet locks its comment.
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is((select count(*)::int from public.comments), 2, 'the judge sees only their own comments');
select lives_ok($$ select pg_temp.comment('j1', 'a', true, 'Strong speech!') $$, 'judge edits their comment');
select is((select approved from public.comments where category_id is not null), false, 'which needs approving again');
insert into public.scores (judge_id, contestant_id, component_id, value)
  select current_setting('test.j1')::uuid, current_setting('test.a')::uuid, id, 8 from public.components;
select public.submit_sheet(current_setting('test.j1')::uuid, current_setting('test.a')::uuid, current_setting('test.cat')::uuid);
select throws_ok($$ select pg_temp.comment('j1', 'a', true, 'late change') $$, 'P0001', null, 'a submitted sheet locks its comment');

-- ── publishing ──
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
insert into public.scores (judge_id, contestant_id, component_id, value)
  select j, c, k.id, v from public.components k, (values (current_setting('test.j1')::uuid, current_setting('test.b')::uuid, 6),
    (current_setting('test.j2')::uuid, current_setting('test.a')::uuid, 9), (current_setting('test.j2')::uuid, current_setting('test.b')::uuid, 5)) x(j, c, v);
select throws_ok($$ select public.publish_contest(current_setting('test.c')::uuid, true) $$, 'P0001', 'Finalize the results before publishing them',
  'only finalized results publish');
select public.finalize_contest(current_setting('test.c')::uuid, jsonb_build_object(
  'maxPossible', 20, 'winner', jsonb_build_object('kind', 'decided', 'contestantId', current_setting('test.a')),
  'standings', jsonb_build_array(
    jsonb_build_object('contestantId', current_setting('test.a'), 'rank', 1, 'total', 17, 'pct', 0.85, 'categoryTotals', jsonb_build_object(current_setting('test.cat'), 17)),
    jsonb_build_object('contestantId', current_setting('test.b'), 'rank', 2, 'total', 11, 'pct', 0.55, 'categoryTotals', jsonb_build_object(current_setting('test.cat'), 11)))));

select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select throws_ok($$ select public.publish_contest(current_setting('test.c')::uuid, true) $$, '42501', null, 'tabulators cannot publish');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select lives_ok($$ select public.publish_contest(current_setting('test.c')::uuid, false) $$, 'producer publishes the winner only');
select is((select status from public.contests where id = current_setting('test.c')::uuid), 'published', 'the contest is published');

reset role;
set local role anon;
select results_eq($$ select snapshot -> 'winner' ->> 'name', snapshot -> 'standings' -> 0 ->> 'name', snapshot -> 'standings' -> 0 -> 'total' from public.published_results where contest_id = current_setting('test.c')::uuid $$,
  $$ values ('A'::text, 'A'::text, null::jsonb) $$, 'anyone reads it; winner-only has no totals');
select is((select count(*)::int from public.contests) + (select count(*)::int from public.scores), 0, 'anonymous visitors read no live tables');
select ok((select snapshot::text !~ '(J1|J2|private\.dev|pacing)' from public.published_results where contest_id = current_setting('test.c')::uuid), 'no judges, emails or comments in the snapshot');
reset role;
set local role authenticated;

select lives_ok($$ select public.publish_contest(current_setting('test.c')::uuid, true) $$, 'republish with the full standings');
select results_eq($$ select snapshot -> 'categories', snapshot -> 'standings' -> 1 -> 'categoryTotals', snapshot -> 'standings' -> 1 -> 'total' from public.published_results where contest_id = current_setting('test.c')::uuid $$,
  $$ values ('["Speech"]'::jsonb, '[11]'::jsonb, '11'::jsonb) $$, 'full standings carry totals by category');
select throws_ok($$ select public.review_comment(id, null, false) from public.comments limit 1 $$, 'P0001', null, 'comments are frozen once published');
select throws_ok($$ select public.set_contest_status(current_setting('test.c')::uuid, 'scoring') $$, 'P0001', null, 'unpublish before reopening');
select lives_ok($$ select public.unpublish_contest(current_setting('test.c')::uuid) $$, 'producer unpublishes');
select results_eq($$ select (select status from public.contests where id = current_setting('test.c')::uuid), (select count(*)::int from public.published_results where contest_id = current_setting('test.c')::uuid) $$,
  $$ values ('finalized'::text, 0) $$, 'the snapshot is gone and the contest is finalized again');

select * from finish();
rollback;
