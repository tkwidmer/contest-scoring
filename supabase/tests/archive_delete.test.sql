begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev'),
  ('44444444-4444-4444-4444-444444444444', 'tina@test.dev');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select set_config('test.org', public.create_org('GLL')::text, true);
insert into public.events (org_id, name) values (current_setting('test.org')::uuid, 'GLL 2026'), (current_setting('test.org')::uuid, 'GLL 2027');
reset role;
update public.events set approved_at = now();
insert into public.org_members (org_id, user_id, role) values (current_setting('test.org')::uuid, '44444444-4444-4444-4444-444444444444', 'tabulator');
set local role authenticated;
insert into public.contests (event_id, name) select id, 'Mr ' || name from public.events;
-- GLL 2026's contest is scored; GLL 2027's is still a draft.
insert into public.categories (contest_id, name) select id, 'Speech' from public.contests where name = 'Mr GLL 2026';
insert into public.components (category_id, name, max_points) select id, 'Speech', 10 from public.categories;
insert into public.contestants (contest_id, display_name) select id, 'A' from public.contests where name = 'Mr GLL 2026';
insert into public.judges (contest_id, name) select id, 'J1' from public.contests where name = 'Mr GLL 2026';
select public.set_contest_status((select id from public.contests where name = 'Mr GLL 2026'), 'scoring');

delete from public.contests where name = 'Mr GLL 2026';
select is((select count(*)::int from public.contests where name = 'Mr GLL 2026'), 1, 'a contest being scored cannot be deleted');
delete from public.events where name = 'GLL 2026';
select is((select count(*)::int from public.events where name = 'GLL 2026'), 1, 'nor its event');

select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
delete from public.contests where name = 'Mr GLL 2027';
select is((select count(*)::int from public.contests where name = 'Mr GLL 2027'), 1, 'tabulators cannot delete contests');
update public.events set archived_at = now() where name = 'GLL 2026';
select is((select count(*)::int from public.events where archived_at is not null), 0, 'tabulators cannot archive events');

select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select lives_ok($$ update public.events set archived_at = now() where name = 'GLL 2026' $$, 'producer archives a past event');
select isnt((select archived_at from public.events where name = 'GLL 2026'), null, 'it is archived');
delete from public.contests where name = 'Mr GLL 2027';
select is((select count(*)::int from public.contests where name = 'Mr GLL 2027'), 0, 'producer deletes a draft contest');
delete from public.events where name = 'GLL 2027';
select is((select count(*)::int from public.events where name = 'GLL 2027'), 0, 'and the empty event');

select * from finish();
rollback;
