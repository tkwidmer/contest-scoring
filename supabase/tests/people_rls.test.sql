begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- Alice produces, Tina tabulates, Jay judges (linked seat), Bob is an outsider.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev'),
  ('33333333-3333-3333-3333-333333333333', 'tina@test.dev'),
  ('44444444-4444-4444-4444-444444444444', 'jay@test.dev'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.dev');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select set_config('test.org', public.create_org('Great Lakes Leather')::text, true);
insert into public.events (org_id, name) values (current_setting('test.org')::uuid, 'GLL 2027');
reset role; update public.events set approved_at = now() where approved_at is null; set local role authenticated; -- event fee paid
insert into public.contests (event_id, name) select id, 'Mr GLL' from public.events;
insert into public.contests (event_id, name) select id, 'Ms GLL' from public.events;
select set_config('test.contest', (select id::text from public.contests where name = 'Mr GLL'), true);
select set_config('test.other', (select id::text from public.contests where name = 'Ms GLL'), true);
insert into public.categories (contest_id, name) values (current_setting('test.contest')::uuid, 'Speech');

-- ── producer adds people ──
select lives_ok($$
  insert into public.contestants (contest_id, display_name, number, represents) values
    (current_setting('test.contest')::uuid, 'Rex', 1, 'Mr Chicago Leather'),
    (current_setting('test.contest')::uuid, 'Duke', 2, null);
  insert into public.contestants (contest_id, display_name) values (current_setting('test.other')::uuid, 'Ms Contestant');
  insert into public.contestant_contacts (contestant_id, email)
    select id, 'rex@test.dev' from public.contestants where display_name = 'Rex';
  insert into public.judges (contest_id, name, email) values
    (current_setting('test.contest')::uuid, 'Jay', 'jay@test.dev'),
    (current_setting('test.contest')::uuid, 'Kim', null),
    (current_setting('test.other')::uuid, 'Lou', null) $$,
  'producer adds contestants, contacts and judges');
select set_config('test.rex', (select id::text from public.contestants where display_name = 'Rex'), true);
select set_config('test.jay', (select id::text from public.judges where name = 'Jay'), true);
select set_config('test.lou', (select id::text from public.judges where name = 'Lou'), true);

select throws_ok($$ insert into public.contestants (contest_id, display_name, number) values (current_setting('test.contest')::uuid, 'Dup', 1) $$,
  '23505', null, 'contestant numbers are unique within a contest');
select throws_ok($$ insert into public.contestant_contacts (contestant_id, email)
  select id, 'not-an-email' from public.contestants where display_name = 'Duke' $$, '23514', null, 'contact emails are validated');
select throws_ok($$ update public.judges set user_id = '22222222-2222-2222-2222-222222222222' $$,
  '42501', null, 'judge accounts cannot be linked directly');
select lives_ok($$ update public.contests set manual_winner_contestant_id = current_setting('test.rex')::uuid
  where id = current_setting('test.contest')::uuid $$, 'producer can record a manual winner');
select throws_ok($$ insert into public.recusals (judge_id, contestant_id) values (current_setting('test.lou')::uuid, current_setting('test.rex')::uuid) $$,
  'P0001', 'The judge and contestant must be in the same contest', 'recusal across contests is rejected');

-- Link Jay's seat the way the P2 claim RPC will.
reset role;
update public.judges set user_id = '44444444-4444-4444-4444-444444444444' where name = 'Jay';
insert into public.org_members (org_id, user_id, role)
  values (current_setting('test.org')::uuid, '33333333-3333-3333-3333-333333333333', 'tabulator');
set local role authenticated;

-- ── tabulator ──
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select is((select count(*)::int from public.contestants), 3, 'tabulator sees contestants');
select is((select count(*)::int from public.contestant_contacts), 0, 'tabulator cannot see contestant emails');
select throws_ok($$ insert into public.contestants (contest_id, display_name) values (current_setting('test.contest')::uuid, 'Sneaky') $$,
  '42501', null, 'tabulator cannot add contestants');
select lives_ok($$ insert into public.recusals (judge_id, contestant_id, reason)
  values (current_setting('test.jay')::uuid, current_setting('test.rex')::uuid, 'Partner') $$, 'tabulator can record a recusal');

-- ── judge ──
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
select is((select array_agg(name) from public.contests), array['Mr GLL'], 'judge sees only their assigned contest');
select is((select count(*)::int from public.categories), 1, 'judge sees the rubric');
select is((select count(*)::int from public.contestants), 2, 'judge sees the contestants in their contest');
select is((select array_agg(name) from public.judges), array['Jay'], 'judge sees only their own judge row');
select is((select count(*)::int from public.recusals), 1, 'judge sees their own recusal');
select is((select count(*)::int from public.contestant_contacts), 0, 'judge cannot see contestant emails');
select is((select count(*)::int from public.events) + (select count(*)::int from public.tiebreak_steps), 0,
  'judge does not see events or tiebreaks');
select throws_ok($$ insert into public.recusals (judge_id, contestant_id)
  select current_setting('test.jay')::uuid, id from public.contestants where display_name = 'Duke' $$,
  '42501', null, 'judge cannot add recusals yet');

-- ── outsider ──
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select is((select count(*)::int from public.contestants) + (select count(*)::int from public.contestant_contacts)
  + (select count(*)::int from public.judges) + (select count(*)::int from public.recusals), 0, 'outsider sees no people');
select throws_ok($$ insert into public.judges (contest_id, name) values (current_setting('test.contest')::uuid, 'Sneaky') $$,
  '42501', null, 'outsider cannot add judges');

-- ── producer: deletes only in draft ──
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select is((select count(*)::int from public.contestant_contacts), 1, 'producer sees contestant emails');
reset role;
update public.contests set status = 'scoring' where id = current_setting('test.contest')::uuid;
set local role authenticated;
delete from public.contestants where id = current_setting('test.rex')::uuid;
select is((select count(*)::int from public.contestants where id = current_setting('test.rex')::uuid), 1,
  'contestants cannot be deleted once scoring starts');
select lives_ok($$ update public.contestants set withdrawn = true where id = current_setting('test.rex')::uuid $$,
  'contestants can be withdrawn once scoring starts');
delete from public.judges where id = current_setting('test.jay')::uuid;
select is((select count(*)::int from public.judges where id = current_setting('test.jay')::uuid), 1,
  'judges cannot be deleted once scoring starts');

select * from finish();
rollback;
