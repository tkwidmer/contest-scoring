begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- Alice produces, Tina tabulates, Bob is an outsider.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev'),
  ('33333333-3333-3333-3333-333333333333', 'tina@test.dev'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.dev');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select set_config('test.org', public.create_org('Great Lakes Leather')::text, true);
reset role;
insert into public.org_members (org_id, user_id, role)
  values (current_setting('test.org')::uuid, '33333333-3333-3333-3333-333333333333', 'tabulator');

-- ── producer builds a contest ──
set local role authenticated;
select lives_ok($$ insert into public.events (org_id, name) values (current_setting('test.org')::uuid, 'GLL 2027') $$,
  'producer creates an event');
select set_config('test.event', (select id::text from public.events where name = 'GLL 2027'), true);
select lives_ok($$ insert into public.contests (event_id, name, threshold_pct) values (current_setting('test.event')::uuid, 'Mr GLL', 70) $$,
  'producer creates a contest');
select set_config('test.contest', (select id::text from public.contests where name = 'Mr GLL'), true);
select is((select org_id from public.contests where id = current_setting('test.contest')::uuid),
  current_setting('test.org')::uuid, 'contest org_id is copied from the event');
select lives_ok($$
  insert into public.categories (contest_id, name, drop_rank) values
    (current_setting('test.contest')::uuid, 'Speech', 2), (current_setting('test.contest')::uuid, 'Fantasy', 1);
  select set_config('test.speech', (select id::text from public.categories where name = 'Speech'), true);
  select set_config('test.fantasy', (select id::text from public.categories where name = 'Fantasy'), true);
  insert into public.components (category_id, name, max_points, step)
    values (current_setting('test.speech')::uuid, 'Content', 10, 0.5);
  insert into public.tiebreak_steps (contest_id, step_no, category_ids) values
    (current_setting('test.contest')::uuid, 1, array[current_setting('test.speech')::uuid, current_setting('test.fantasy')::uuid]),
    (current_setting('test.contest')::uuid, 2, array[current_setting('test.fantasy')::uuid]) $$,
  'producer builds the rubric');
select throws_ok($$ insert into public.components (category_id, name, max_points) values (current_setting('test.speech')::uuid, 'Bad', 0) $$,
  '23514', null, 'max must exceed min');
select throws_ok($$ insert into public.components (category_id, name, max_points, step) values (current_setting('test.speech')::uuid, 'Bad', 10, 3) $$,
  '23514', null, 'range must be a whole number of steps');
select throws_ok($$ update public.contests set status = 'published' $$, '42501', null, 'status cannot be set directly');
select throws_ok($$ update public.events set org_id = gen_random_uuid() $$, '42501', null, 'events cannot move between orgs');
select throws_ok($$ insert into public.contests (event_id, name, status) values (current_setting('test.event')::uuid, 'Sneaky', 'scoring') $$,
  '42501', null, 'status cannot be set on insert');

-- A tiebreak step can't reference another contest's category.
select lives_ok($$ insert into public.contests (event_id, name) values (current_setting('test.event')::uuid, 'Ms GLL') $$, 'second contest');
select set_config('test.other_contest', (select id::text from public.contests where name = 'Ms GLL'), true);
select throws_ok($$ insert into public.tiebreak_steps (contest_id, step_no, category_ids)
  values (current_setting('test.other_contest')::uuid, 1, array[current_setting('test.speech')::uuid]) $$,
  'P0001', 'Tiebreak steps can only use this contest''s categories', 'foreign category in tiebreak step is rejected');

-- ── tabulator reads, can't write ──
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select is((select count(*)::int from public.components), 1, 'tabulator sees the rubric');
select throws_ok($$ insert into public.categories (contest_id, name) values (current_setting('test.contest')::uuid, 'Sneaky') $$,
  '42501', null, 'tabulator cannot add categories');
update public.contests set name = 'Hacked'; -- RLS filters it to zero rows
select is((select count(*)::int from public.contests where name = 'Hacked'), 0, 'tabulator cannot rename contests');

-- ── outsider sees nothing, can't write ──
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select is((select count(*)::int from public.events) + (select count(*)::int from public.contests)
  + (select count(*)::int from public.categories) + (select count(*)::int from public.components)
  + (select count(*)::int from public.tiebreak_steps), 0, 'outsider sees no structure');
select throws_ok($$ insert into public.contests (event_id, name) values (current_setting('test.event')::uuid, 'Sneaky') $$,
  '42501', null, 'outsider cannot add a contest to the event');

-- ── back to the producer: pruning and locking ──
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select lives_ok($$ delete from public.categories where id = current_setting('test.fantasy')::uuid $$, 'draft category can be deleted');
select results_eq($$ select step_no, category_ids from public.tiebreak_steps order by step_no $$,
  $$ values (1, array[current_setting('test.speech')::uuid]) $$,
  'deleted category is pruned from tiebreak steps; emptied steps are removed');

reset role;
update public.contests set status = 'scoring' where id = current_setting('test.contest')::uuid;
set local role authenticated;

select throws_ok($$ insert into public.categories (contest_id, name) values (current_setting('test.contest')::uuid, 'Late') $$,
  'P0001', 'The rubric is locked once scoring starts', 'rubric locks once scoring starts');
select throws_ok($$ update public.components set max_points = 20 $$,
  'P0001', 'The rubric is locked once scoring starts', 'components lock too');
select throws_ok($$ update public.contests set threshold_pct = 50 where id = current_setting('test.contest')::uuid $$,
  'P0001', 'Scoring rules are locked once scoring starts', 'threshold locks once scoring starts');
select lives_ok($$ update public.contests set name = 'Mr Great Lakes Leather' where id = current_setting('test.contest')::uuid $$,
  'contest can still be renamed while scoring');
delete from public.contests where id = current_setting('test.contest')::uuid;
select is((select count(*)::int from public.contests where id = current_setting('test.contest')::uuid), 1,
  'a contest being scored cannot be deleted');
delete from public.events;
select is((select count(*)::int from public.events), 1, 'an event with a contest being scored cannot be deleted');

select * from finish();
rollback;
