begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.dev'),
  ('99999999-9999-9999-9999-999999999999', 'admin@test.dev');
update public.profiles set is_platform_admin = true where id = '99999999-9999-9999-9999-999999999999';

-- Alice produces an event with one ready contest.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select set_config('test.org', public.create_org('GLL')::text, true);
insert into public.events (org_id, name) values (current_setting('test.org')::uuid, 'GLL 2027');
select set_config('test.event', (select id::text from public.events), true);
insert into public.contests (event_id, name) values (current_setting('test.event')::uuid, 'Mr GLL');
select set_config('test.c', (select id::text from public.contests), true);
insert into public.categories (contest_id, name) values (current_setting('test.c')::uuid, 'Speech');
insert into public.components (category_id, name, max_points) select id, 'Speech', 10 from public.categories;
insert into public.contestants (contest_id, display_name) values (current_setting('test.c')::uuid, 'A');
insert into public.judges (contest_id, name) values (current_setting('test.c')::uuid, 'J1');

select is((select approved_at from public.events), null, 'new events start unapproved');
select throws_ok($$ insert into public.events (org_id, name, approved_at) values (current_setting('test.org')::uuid, 'Sneaky', now()) $$,
  '42501', null, 'producers cannot create an approved event');
select throws_ok($$ update public.events set approved_at = now() $$, '42501', null, 'producers cannot approve by updating');
select throws_ok($$ select public.set_contest_status(current_setting('test.c')::uuid, 'scoring') $$, 'P0001',
  'This event isn''t approved yet. Scoring opens once the event fee is paid and the event is approved.', 'no scoring before approval');
select throws_ok($$ select public.set_event_approval(current_setting('test.event')::uuid, true) $$, '42501', null, 'producers cannot approve');
select throws_ok($$ select * from public.event_approvals() $$, '42501', null, 'producers cannot see the approval queue');
select lives_ok($$ select public.request_event_approval(current_setting('test.event')::uuid) $$, 'producer requests approval');
select isnt((select approval_requested_at from public.events), null, 'the request is recorded');

-- Bob is not in the org.
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select throws_ok($$ select public.request_event_approval(current_setting('test.event')::uuid) $$, '42501', null,
  'outsiders cannot request approval');

-- The platform admin sees the request, with who asked, and approves it.
select set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}', true);
select results_eq($$ select event_name, org_name, requested_by_email, approved_at is null from public.event_approvals() where event_id = current_setting('test.event')::uuid $$,
  $$ values ('GLL 2027'::text, 'GLL'::text, 'alice@test.dev'::text, true) $$, 'admin sees the request');
select lives_ok($$ select public.set_event_approval(current_setting('test.event')::uuid, true) $$, 'admin approves');

select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select lives_ok($$ select public.set_contest_status(current_setting('test.c')::uuid, 'scoring') $$, 'scoring opens once approved');

-- Revoking stops other contests starting; ones already scoring carry on.
select set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}', true);
select lives_ok($$ select public.set_event_approval(current_setting('test.event')::uuid, false) $$, 'admin revokes');
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select lives_ok($$ select public.set_contest_status(current_setting('test.c')::uuid, 'draft') $$, 'a scoring contest can still go back to draft');
select throws_ok($$ select public.set_contest_status(current_setting('test.c')::uuid, 'scoring') $$, 'P0001', null,
  'but cannot start again until re-approved');

select * from finish();
rollback;
