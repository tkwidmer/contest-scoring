begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.dev'),
  ('99999999-9999-9999-9999-999999999999', 'admin@test.dev');
update public.profiles set is_platform_admin = true where id = '99999999-9999-9999-9999-999999999999';

-- Alice produces a draft contest with a full setup. The admin and Bob belong to no organization.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select set_config('test.org', public.create_org('GLL')::text, true);
insert into public.events (org_id, name) values (current_setting('test.org')::uuid, 'GLL 2027');
insert into public.contests (event_id, name) select id, 'Mr GLL' from public.events;
select set_config('test.c', (select id::text from public.contests), true);
insert into public.categories (contest_id, name) values (current_setting('test.c')::uuid, 'Speech');
insert into public.components (category_id, name, max_points) select id, 'Speech', 10 from public.categories;
insert into public.tiebreak_steps (contest_id, step_no, category_ids) select contest_id, 1, array[id] from public.categories;
insert into public.contestants (contest_id, display_name) values (current_setting('test.c')::uuid, 'Rex');
insert into public.contestant_contacts (contestant_id, email) select id, 'rex@test.dev' from public.contestants;
insert into public.judges (contest_id, name) values (current_setting('test.c')::uuid, 'Jay');
insert into public.recusals (judge_id, contestant_id) select j.id, c.id from public.judges j, public.contestants c;

-- ── the platform admin reads the whole configuration ──
select set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}', true);
select results_eq($$ select (select count(*) from public.orgs), (select count(*) from public.events), (select count(*) from public.contests) $$,
  $$ values (1::bigint, 1::bigint, 1::bigint) $$, 'admin reads the org, event and contest');
select results_eq($$ select (select count(*) from public.categories), (select count(*) from public.components), (select count(*) from public.tiebreak_steps) $$,
  $$ values (1::bigint, 1::bigint, 1::bigint) $$, 'admin reads the scoresheet and tiebreaks');
select results_eq($$ select (select count(*) from public.contestants), (select count(*) from public.judges), (select count(*) from public.recusals) $$,
  $$ values (1::bigint, 1::bigint, 1::bigint) $$, 'admin reads contestants, judges and recusals');
select is_empty($$ select 1 from public.contestant_contacts $$, 'but not contestant emails');

-- ── and cannot change any of it ──
select throws_ok($$ insert into public.events (org_id, name) values (current_setting('test.org')::uuid, 'Sneaky') $$, '42501', null, 'admin cannot add an event');
select throws_ok($$ insert into public.contests (event_id, name) select id, 'Sneaky' from public.events $$, '42501', null, 'admin cannot add a contest');
select throws_ok($$ insert into public.categories (contest_id, name) values (current_setting('test.c')::uuid, 'Sneaky') $$, '42501', null, 'admin cannot add a category');
select throws_ok($$ insert into public.judges (contest_id, name) values (current_setting('test.c')::uuid, 'Sneaky') $$, '42501', null, 'admin cannot add a judge');
update public.contests set name = 'Hacked'; -- RLS filters each of these to zero rows
update public.components set max_points = 99;
delete from public.contests;
delete from public.judges;

-- ── everyone else still sees nothing outside their own organizations ──
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select is_empty($$ select 1 from public.contests $$, 'an outsider still sees no contests');

-- ── and Alice's setup is untouched ──
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select is((select name from public.contests), 'Mr GLL', 'admin cannot rename a contest');
select is((select max_points::int from public.components), 10, 'admin cannot edit the scoresheet');
select is((select count(*)::int from public.contests), 1, 'admin cannot delete a contest');
select is((select count(*)::int from public.judges), 1, 'admin cannot delete a judge');

select * from finish();
rollback;
