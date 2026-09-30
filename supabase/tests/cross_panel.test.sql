begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'alice@test.dev');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select set_config('test.org', public.create_org('IMsLBB')::text, true);
insert into public.events (org_id, name) values (current_setting('test.org')::uuid, 'IMsLBB 2024');
reset role; update public.events set approved_at = now() where approved_at is null; set local role authenticated; -- event fee paid
insert into public.contests (event_id, name, aggregation) select id, 'IMsBB', 'drop_high_low' from public.events;
select set_config('test.c', (select id::text from public.contests), true);
select lives_ok($$ insert into public.categories (contest_id, name, sort, scored_by) values
  (current_setting('test.c')::uuid, 'Speech', 1, 'judges'),
  (current_setting('test.c')::uuid, 'IMsL Interview', 2, 'cross_panel') $$, 'producer adds a cross-panel category');
select throws_ok($$ insert into public.categories (contest_id, name, scored_by) values (current_setting('test.c')::uuid, 'Bad', 'guests') $$,
  '23514', null, 'unknown scored_by values are rejected');
insert into public.components (category_id, name, max_points) select id, name, 100 from public.categories;
insert into public.contestants (contest_id, display_name) values (current_setting('test.c')::uuid, 'A');
insert into public.judges (contest_id, name) values (current_setting('test.c')::uuid, 'J1');
insert into public.judges (contest_id, name, guest) values (current_setting('test.c')::uuid, 'G1', true), (current_setting('test.c')::uuid, 'G2', true);
select public.set_contest_status(current_setting('test.c')::uuid, 'scoring');

create function pg_temp.score(judge text, cat text, v numeric) returns void language sql as $$
  insert into public.scores (judge_id, contestant_id, component_id, value)
  select (select id from public.judges where name = judge), c.id, k.id, v
    from public.contestants c, public.components k where c.display_name = 'A' and k.name = cat
$$;

reset role;
select is(private.missing_scores(current_setting('test.c')::uuid, null), 3, 'expected: J1 x Speech, G1 and G2 x IMsL Interview');
set local role authenticated;
select lives_ok($$ select pg_temp.score('G1', 'IMsL Interview', 80) $$, 'cross-panel judge scores the cross-panel category');
select throws_ok($$ select pg_temp.score('J1', 'IMsL Interview', 80) $$, 'P0001', 'Only cross-panel judges score this category',
  'panel judges stay out of the cross-panel category');
select throws_ok($$ select pg_temp.score('G1', 'Speech', 80) $$, 'P0001', 'Cross-panel judges only score cross-panel categories',
  'cross-panel judges stay out of panel categories');
insert into public.recusals (judge_id, contestant_id) select j.id, c.id from public.judges j, public.contestants c where j.name = 'G2';
select throws_ok($$ select pg_temp.score('G2', 'IMsL Interview', 80) $$, 'P0001', 'This judge is recused from this contestant',
  'a recused cross-panel judge cannot score');
reset role;
select is(private.missing_scores(current_setting('test.c')::uuid, null), 1, 'the recused cross-panel judge is not expected');
set local role authenticated;
select lives_ok($$ select pg_temp.score('J1', 'Speech', 70) $$, 'panel judge scores');

select * from finish();
rollback;
