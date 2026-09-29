begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev'),
  ('33333333-3333-3333-3333-333333333333', 'tina@test.dev');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select set_config('test.org', public.create_org('IMBB')::text, true);
insert into public.events (org_id, name) values (current_setting('test.org')::uuid, 'IML Weekend');
insert into public.contests (event_id, name, finalist_count, prelim_carries) select id, 'IMBB', 2, true from public.events;
select set_config('test.c', (select id::text from public.contests), true);
insert into public.categories (contest_id, name, round, sort) values
  (current_setting('test.c')::uuid, 'Skill', 'prelim', 1), (current_setting('test.c')::uuid, 'Speech', 'final', 2);
insert into public.components (category_id, name, max_points) select id, name, 10 from public.categories;
insert into public.tiebreak_steps (contest_id, step_no, category_ids, all_judges)
  values (current_setting('test.c')::uuid, 1, array(select id from public.categories), true);
insert into public.contestants (contest_id, display_name) values
  (current_setting('test.c')::uuid, 'A'), (current_setting('test.c')::uuid, 'B'), (current_setting('test.c')::uuid, 'C');
insert into public.judges (contest_id, name) values (current_setting('test.c')::uuid, 'J1');
select public.set_contest_status(current_setting('test.c')::uuid, 'scoring');

create function pg_temp.score(who text, cat text, v numeric) returns void language sql as $$
  insert into public.scores (judge_id, contestant_id, component_id, value)
  select j.id, c.id, k.id, v from public.judges j, public.contestants c, public.components k
   where c.display_name = who and k.name = cat
  on conflict (judge_id, contestant_id, component_id) do update set value = excluded.value
$$;
create function pg_temp.ids(variadic names text[]) returns uuid[] language sql as $$
  select array_agg(id order by display_name) from public.contestants where display_name = any (names)
$$;

select throws_ok($$ select pg_temp.score('A', 'Speech', 5) $$, 'P0001', 'Only finalists are scored in the finals',
  'finals scores wait for the cut');
select lives_ok($$ select pg_temp.score('A', 'Skill', 9); select pg_temp.score('B', 'Skill', 8) $$, 'prelim scores go in');
select throws_ok($$ select public.confirm_finalists(current_setting('test.c')::uuid, pg_temp.ids('A', 'B')) $$,
  'P0001', '1 preliminary score(s) are still missing', 'cut needs every prelim score');
select pg_temp.score('C', 'Skill', 4);
select throws_ok($$ select public.confirm_finalists(current_setting('test.c')::uuid, pg_temp.ids('A')) $$,
  'P0001', 'Choose exactly 2 finalists from this contest''s contestants', 'cut must be exactly N');
select throws_ok($$ select public.confirm_finalists(current_setting('test.c')::uuid, array[gen_random_uuid(), gen_random_uuid()]) $$,
  'P0001', 'Choose exactly 2 finalists from this contest''s contestants', 'finalists must be contestants here');
select throws_ok($$ update public.contestants set finalist = true $$, '42501', null, 'finalist flag cannot be set directly');

reset role;
insert into public.org_members (org_id, user_id, role) values (current_setting('test.org')::uuid, '33333333-3333-3333-3333-333333333333', 'tabulator');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select throws_ok($$ select public.confirm_finalists(current_setting('test.c')::uuid, pg_temp.ids('A', 'B')) $$,
  '42501', null, 'tabulator cannot confirm the cut');
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

select throws_ok($$ select public.finalize_contest(current_setting('test.c')::uuid, '{"winner":{"kind":"decided","contestantId":null}}') $$,
  'P0001', 'Confirm the finalists before finalizing', 'finalize needs a confirmed cut');
select lives_ok($$ select public.confirm_finalists(current_setting('test.c')::uuid, pg_temp.ids('A', 'B')) $$, 'producer confirms the cut');
select results_eq($$ select display_name, finalist from public.contestants order by display_name $$,
  $$ values ('A', true), ('B', true), ('C', false) $$, 'finalist flags are set');
select throws_ok($$ select pg_temp.score('C', 'Speech', 5) $$, 'P0001', 'Only finalists are scored in the finals',
  'non-finalists get no finals scores');
select lives_ok($$ select pg_temp.score('A', 'Speech', 5) $$, 'finalists get finals scores');
select throws_ok($$ select public.confirm_finalists(current_setting('test.c')::uuid, pg_temp.ids('B', 'C')) $$,
  'P0001', 'Someone being removed from the finals already has finals scores; clear them first', 'cannot drop a finalist who has finals scores');

select throws_ok($$ select public.finalize_contest(current_setting('test.c')::uuid, jsonb_build_object('winner', jsonb_build_object('kind', 'decided', 'contestantId', (pg_temp.ids('A'))[1]))) $$,
  'P0001', '1 score(s) are still missing', 'finals need every finalist scored (non-finalists excluded)');
select pg_temp.score('B', 'Speech', 6);
select throws_ok($$ select public.finalize_contest(current_setting('test.c')::uuid, jsonb_build_object('winner', jsonb_build_object('kind', 'decided', 'contestantId', (pg_temp.ids('C'))[1]))) $$,
  'P0001', 'The winner must be a contestant in this contest', 'winner must be a finalist');
select lives_ok($$ select public.finalize_contest(current_setting('test.c')::uuid, jsonb_build_object('winner', jsonb_build_object('kind', 'decided', 'contestantId', (pg_temp.ids('B'))[1]))) $$,
  'finalize with a finalist winner');

select throws_ok($$ update public.contests set finalist_count = 3 $$, 'P0001', 'Scoring rules are locked once scoring starts', 'round settings lock');

-- Rubric round-trip keeps rounds, category rounds and every-judge steps.
insert into public.events (org_id, name) values (current_setting('test.org')::uuid, 'Next year');
select set_config('test.copy', public.clone_contest(current_setting('test.c')::uuid, (select id from public.events where name = 'Next year'), 'IMBB copy')::text, true);
select results_eq($$ select finalist_count, prelim_carries, prelim_aggregation, (select array_agg(round order by sort) from public.categories where contest_id = c.id),
                            (select bool_and(all_judges) from public.tiebreak_steps where contest_id = c.id)
                     from public.contests c where id = current_setting('test.copy')::uuid $$,
  $$ values (2, true, 'drop_high_low', array['prelim', 'final'], true) $$, 'clone keeps rounds and every-judge steps');
select is((select count(*)::int from public.contestants where contest_id = current_setting('test.copy')::uuid and finalist), 0, 'clone brings no finalists');

select * from finish();
rollback;
