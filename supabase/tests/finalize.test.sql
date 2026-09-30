begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev'),
  ('33333333-3333-3333-3333-333333333333', 'tina@test.dev');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select set_config('test.org', public.create_org('GLL')::text, true);
insert into public.events (org_id, name) values (current_setting('test.org')::uuid, 'GLL 2027');
reset role; update public.events set approved_at = now() where approved_at is null; set local role authenticated; -- event fee paid
insert into public.contests (event_id, name) select id, 'Mr GLL' from public.events;
insert into public.contests (event_id, name) select id, 'Ms GLL' from public.events;
select set_config('test.c', (select id::text from public.contests where name = 'Mr GLL'), true);
insert into public.categories (contest_id, name) values (current_setting('test.c')::uuid, 'Speech');
insert into public.components (category_id, name, max_points) select id, 'Content', 10 from public.categories;
insert into public.contestants (contest_id, display_name) values (current_setting('test.c')::uuid, 'Rex'), (current_setting('test.c')::uuid, 'Duke');
insert into public.contestants (contest_id, display_name) select id, 'Ms One' from public.contests where name = 'Ms GLL';
insert into public.judges (contest_id, name) values (current_setting('test.c')::uuid, 'Jay'), (current_setting('test.c')::uuid, 'Kim');
insert into public.recusals (judge_id, contestant_id)
  select j.id, c.id from public.judges j, public.contestants c where j.name = 'Kim' and c.display_name = 'Duke';
select set_config('test.rex', (select id::text from public.contestants where display_name = 'Rex'), true);
select set_config('test.msone', (select id::text from public.contestants where display_name = 'Ms One'), true);
select public.set_contest_status(current_setting('test.c')::uuid, 'scoring');

create function pg_temp.result(kind text, winner text) returns jsonb language sql as $$
  select jsonb_build_object('winner', jsonb_build_object('kind', kind, 'contestantId', winner), 'standings', '[]'::jsonb)
$$;

-- Rex: Jay + Kim; Duke: Jay only (Kim recused). One score in so far.
insert into public.scores (judge_id, contestant_id, component_id, value)
  select j.id, c.id, k.id, 8 from public.judges j, public.contestants c, public.components k where j.name = 'Jay' and c.display_name = 'Rex';

select throws_ok($$ select public.finalize_contest(current_setting('test.c')::uuid, pg_temp.result('decided', current_setting('test.rex'))) $$,
  'P0001', '2 score(s) are still missing', 'cannot finalize with missing scores (recused cells not counted)');

insert into public.scores (judge_id, contestant_id, component_id, value)
  select j.id, c.id, k.id, 7 from public.judges j, public.contestants c, public.components k
   where (j.name = 'Kim' and c.display_name = 'Rex') or (j.name = 'Jay' and c.display_name = 'Duke');

select throws_ok($$ select public.finalize_contest(current_setting('test.c')::uuid, pg_temp.result('tie_unresolved', null)) $$,
  'P0001', 'Resolve the tie before finalizing', 'an unresolved tie cannot be finalized');
select throws_ok($$ select public.finalize_contest(current_setting('test.c')::uuid, pg_temp.result('decided', current_setting('test.msone'))) $$,
  'P0001', 'The winner must be a contestant in this contest', 'winner must belong to the contest');
select throws_ok($$ select public.set_contest_status(current_setting('test.c')::uuid, 'finalized') $$,
  'P0001', 'Use finalize to lock in results', 'status RPC cannot skip the finalize checks');

select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
reset role;
insert into public.org_members (org_id, user_id, role) values (current_setting('test.org')::uuid, '33333333-3333-3333-3333-333333333333', 'tabulator');
set local role authenticated;
select throws_ok($$ select public.finalize_contest(current_setting('test.c')::uuid, pg_temp.result('decided', current_setting('test.rex'))) $$,
  '42501', null, 'tabulator cannot finalize');

select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select lives_ok($$ select public.finalize_contest(current_setting('test.c')::uuid, pg_temp.result('decided', current_setting('test.rex'))) $$,
  'producer finalizes');
select results_eq($$ select status, final_result -> 'winner' ->> 'contestantId', finalized_at is not null from public.contests where id = current_setting('test.c')::uuid $$,
  $$ values ('finalized', current_setting('test.rex'), true) $$, 'result is frozen on the contest');
select throws_ok($$ update public.scores set value = 1 $$,
  'P0001', 'Scores can only be changed while the contest is being scored', 'scores lock once finalized');
select throws_ok($$ update public.contests set final_result = '{}' $$, '42501', null, 'the frozen result cannot be edited directly');

select lives_ok($$ select public.set_contest_status(current_setting('test.c')::uuid, 'scoring') $$, 'producer reopens scoring');
select results_eq($$ select status, final_result is null, finalized_at is null from public.contests where id = current_setting('test.c')::uuid $$,
  $$ values ('scoring', true, true) $$, 'reopening discards the frozen result');
select lives_ok($$ select public.finalize_contest(current_setting('test.c')::uuid, pg_temp.result('no_title', null)) $$,
  'no title is a valid final outcome');

select * from finish();
rollback;
