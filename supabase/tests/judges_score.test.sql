begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev'),   -- producer
  ('22222222-2222-2222-2222-222222222222', 'Judy@Test.dev'),    -- judge J1 (email case differs)
  ('33333333-3333-3333-3333-333333333333', 'kim@test.dev'),     -- judge J2
  ('44444444-4444-4444-4444-444444444444', 'tina@test.dev'),    -- invited tabulator
  ('55555555-5555-5555-5555-555555555555', 'eve@test.dev');     -- nobody

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
reset role; update public.events set approved_at = now(); set local role authenticated;
insert into public.contests (event_id, name) select id, 'Mr GLL' from public.events;
select set_config('test.c', (select id::text from public.contests), true);
insert into public.categories (contest_id, name, sort) values (current_setting('test.c')::uuid, 'Speech', 1), (current_setting('test.c')::uuid, 'Image', 2);
insert into public.components (category_id, name, max_points) select id, name || ' a', 10 from public.categories;
insert into public.components (category_id, name, max_points) select id, 'Speech b', 10 from public.categories where name = 'Speech';
insert into public.contestants (contest_id, display_name) values (current_setting('test.c')::uuid, 'A');
insert into public.judges (contest_id, name, email, sort) values
  (current_setting('test.c')::uuid, 'J1', 'judy@test.dev', 1), (current_setting('test.c')::uuid, 'J2', 'kim@test.dev', 2);
insert into public.org_invites (org_id, email, role) values (current_setting('test.org')::uuid, 'Tina@test.dev', 'tabulator');
select set_config('test.j2', (select id::text from public.judges where name = 'J2'), true);
select public.set_contest_status(current_setting('test.c')::uuid, 'scoring');

create function pg_temp.score(judge text, comp text, v numeric) returns void language sql as $$
  insert into public.scores (judge_id, contestant_id, component_id, value)
  select (select id from public.judges where name = judge), c.id, k.id, v
    from public.contestants c, public.components k where c.display_name = 'A' and k.name = comp
  on conflict on constraint scores_cell_key do update set value = excluded.value
$$;
create function pg_temp.ids(judge text, cat text) returns table (j uuid, c uuid, k uuid) language sql as $$
  select (select id from public.judges where name = judge), (select id from public.contestants where display_name = 'A'),
         (select id from public.categories where name = cat)
$$;

-- ── invites ──
select throws_ok($$ insert into public.org_invites (org_id, email, role, invited_by) values (current_setting('test.org')::uuid, 'x@test.dev', 'producer', '55555555-5555-5555-5555-555555555555') $$,
  '42501', null, 'invited_by comes from the database');
select pg_temp.as_user('55555555-5555-5555-5555-555555555555');
select is((select count(*)::int from public.org_invites), 0, 'outsiders cannot see invites');
select throws_ok($$ insert into public.org_invites (org_id, email, role) values (current_setting('test.org')::uuid, 'eve@test.dev', 'producer') $$,
  '42501', null, 'outsiders cannot invite themselves');
select is(public.claim_invites(), 0, 'nothing to claim for an uninvited user');
select is((select count(*)::int from public.judges), 0, 'outsiders see no judges');

select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select is(public.claim_invites(), 1, 'the invited tabulator claims membership');
select is((select role from public.org_members where user_id = '44444444-4444-4444-4444-444444444444'), 'tabulator', 'as a tabulator');

-- ── a judge claims their seat and scores their own sheet ──
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is((select count(*)::int from public.contests), 0, 'before claiming, the judge sees no contests');
select is(public.claim_invites(), 1, 'judge claims the seat whose email matches, ignoring case');
select is((select count(*)::int from public.judges), 1, 'the judge sees only their own judge row');
select is((select name from public.contests), 'Mr GLL', 'and now sees the contest');
select is((select name from public.events), 'GLL 2027', 'and its event');
select throws_ok($$ select final_result from public.contests $$, '42501', null, 'but not the frozen result, which holds every judge''s scores');
select is(public.contest_final_result(current_setting('test.c')::uuid), null, 'nor through the RPC');
select lives_ok($$ select pg_temp.score('J1', 'Speech a', 8) $$, 'judge scores their own sheet');
select throws_ok($$ insert into public.scores (judge_id, contestant_id, component_id, value)
  select current_setting('test.j2')::uuid, c.id, k.id, 8 from public.contestants c, public.components k where k.name = 'Speech a' $$,
  '42501', null, 'but not another judge''s');
select throws_ok($$ select public.submit_sheet(j, c, k) from pg_temp.ids('J1', 'Speech') $$, 'P0001',
  'Score every part of this sheet before submitting it', 'a sheet must be complete to submit');
select lives_ok($$ select pg_temp.score('J1', 'Speech b', 7) $$, 'judge finishes the sheet');
select lives_ok($$ select public.submit_sheet(j, c, k) from pg_temp.ids('J1', 'Speech') $$, 'judge submits');
select throws_ok($$ select pg_temp.score('J1', 'Speech a', 9) $$, 'P0001', 'This sheet was submitted and is locked. A producer can unlock it.',
  'a submitted sheet is locked for the judge');
select lives_ok($$ select pg_temp.score('J1', 'Image a', 6) $$, 'other categories stay open');
select throws_ok($$ select public.submit_sheet(j, c, k) from pg_temp.ids('J2', 'Speech') $$, '42501', null, 'judges cannot submit others'' sheets');
select throws_ok($$ select public.unlock_sheet(j, c, k, 'typo') from pg_temp.ids('J1', 'Speech') $$, '42501', null, 'judges cannot unlock');
select is((select count(*)::int from public.scores), 3, 'the judge sees only their own scores');

-- ── tabulators and producers ──
select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select throws_ok($$ select pg_temp.score('J1', 'Speech a', 9) $$, 'P0001', null, 'the lock applies to tabulators too');
select throws_ok($$ select public.unlock_sheet(j, c, k, 'typo') from pg_temp.ids('J1', 'Speech') $$, '42501', null, 'tabulators cannot unlock');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select throws_ok($$ select public.unlock_sheet(j, c, k, ' ') from pg_temp.ids('J1', 'Speech') $$, 'P0001', 'Give a reason for unlocking the sheet',
  'unlocking needs a reason');
select lives_ok($$ select public.unlock_sheet(j, c, k, 'Judge misread the rubric') from pg_temp.ids('J1', 'Speech') $$, 'producer unlocks');
select lives_ok($$ select pg_temp.score('J1', 'Speech a', 9) $$, 'the sheet is editable again');
select results_eq($$ select action, reason from public.sheet_audit order by id $$,
  $$ values ('submit'::text, null::text), ('unlock', 'Judge misread the rubric') $$, 'submit and unlock are logged');

select * from finish();
rollback;
