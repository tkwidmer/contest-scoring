begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev'),
  ('33333333-3333-3333-3333-333333333333', 'tina@test.dev'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.dev');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select set_config('test.org', public.create_org('IMsLBB')::text, true);
insert into public.events (org_id, name) values (current_setting('test.org')::uuid, 'IMsL 2027');
reset role; update public.events set approved_at = now() where approved_at is null; set local role authenticated; -- event fee paid
insert into public.contests (event_id, name, report_as, threshold_pct, threshold_single_only)
  select id, 'IMsL', 'average', 80, true from public.events;
insert into public.contests (event_id, name) select id, 'IMsBB' from public.events;
select set_config('test.c', (select id::text from public.contests where name = 'IMsL'), true);
select set_config('test.event', (select id::text from public.events), true);
select set_config('test.other', (select id::text from public.contests where name = 'IMsBB'), true);
insert into public.categories (contest_id, name, sort, scored_by, guest_average, deductions) values
  (current_setting('test.c')::uuid, 'Speech', 1, 'judges', false, '[{"label":"Over time","percent":10},{"label":"16–60 s","points":5}]'),
  (current_setting('test.c')::uuid, 'Interview', 2, 'judges', true, '[]'),
  (current_setting('test.c')::uuid, 'Community vote', 3, 'producer', false, '[]');
insert into public.categories (contest_id, name) values (current_setting('test.other')::uuid, 'Other');
insert into public.components (category_id, name, max_points) select id, name, 10 from public.categories;
insert into public.contestants (contest_id, display_name) values (current_setting('test.c')::uuid, 'A'), (current_setting('test.other')::uuid, 'Z');
insert into public.judges (contest_id, name) values (current_setting('test.c')::uuid, 'J1');
insert into public.judges (contest_id, name, guest) values (current_setting('test.c')::uuid, 'G1', true);
select set_config('test.a', (select id::text from public.contestants where display_name = 'A'), true);
select set_config('test.speech', (select id::text from public.categories where name = 'Speech'), true);
select public.set_contest_status(current_setting('test.c')::uuid, 'scoring');

create function pg_temp.score(judge text, cat text, v numeric) returns void language sql as $$
  insert into public.scores (judge_id, contestant_id, component_id, value)
  select (select id from public.judges where name = judge), c.id, k.id, v
    from public.contestants c, public.components k where c.display_name = 'A' and k.name = cat
  on conflict on constraint scores_cell_key do update set value = excluded.value
$$;
create function pg_temp.penalty(who text, cat text, t int) returns void language sql as $$
  insert into public.penalties (contestant_id, category_id, tier)
  select c.id, k.id, t from public.contestants c, public.categories k where c.display_name = who and k.name = cat
$$;

-- ── producer-entered and cross-panel scores ──
reset role;
select is(private.missing_scores(current_setting('test.c')::uuid, null), 4, 'expected: J1 x 2 categories, G1 x Interview, one vote');
set local role authenticated;
select lives_ok($$ select pg_temp.score(null, 'Community vote', 7) $$, 'producer enters a community vote with no judge');
select lives_ok($$ select pg_temp.score(null, 'Community vote', 8) $$, 're-entering the vote replaces it');
select is((select count(*)::int from public.scores where judge_id is null), 1, 'one vote per contestant');
select throws_ok($$ select pg_temp.score('J1', 'Community vote', 5) $$, 'P0001', 'This category is entered once per contestant, not per judge',
  'judges cannot score a producer-entered category');
select throws_ok($$ select pg_temp.score(null, 'Speech', 5) $$, 'P0001', 'The judge, contestant and component must be in the same contest',
  'judge-scored categories need a judge');
select lives_ok($$ select pg_temp.score('G1', 'Interview', 6) $$, 'cross-panel judge scores a cross-panel category');
select throws_ok($$ select pg_temp.score('G1', 'Speech', 6) $$, 'P0001', 'Cross-panel judges only score cross-panel categories',
  'cross-panel judges stay out of other categories');
select lives_ok($$ select pg_temp.score('J1', 'Speech', 9); select pg_temp.score('J1', 'Interview', 9) $$, 'panel judge scores');
reset role;
select is(private.missing_scores(current_setting('test.c')::uuid, null), 0, 'contest complete');
set local role authenticated;
reset role;
select is((select count(*)::int from public.score_audit where judge_id is null and contest_id = current_setting('test.c')::uuid), 2, 'producer entries are audited (insert, update)');
set local role authenticated;

-- ── deductions ──
select lives_ok($$ select pg_temp.penalty('A', 'Speech', 1) $$, 'tally master records a deduction');
select throws_ok($$ select pg_temp.penalty('A', 'Speech', 2) $$, 'P0001', 'That deduction is not defined for this category', 'unknown tier is rejected');
select throws_ok($$ insert into public.penalties (contestant_id, category_id, tier)
  select c.id, k.id, 0 from public.contestants c, public.categories k where c.display_name = 'Z' and k.name = 'Speech' $$,
  'P0001', 'The contestant and category must be in the same contest', 'cross-contest deduction is rejected');
select is((select contest_id from public.penalties), current_setting('test.c')::uuid, 'contest_id is filled in');

reset role;
insert into public.org_members (org_id, user_id, role) values (current_setting('test.org')::uuid, '33333333-3333-3333-3333-333333333333', 'tabulator');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select lives_ok($$ select pg_temp.penalty('A', 'Speech', 0); delete from public.penalties where tier = 1 $$, 'tabulator adds and removes deductions');
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select is((select count(*)::int from public.penalties), 0, 'outsiders see no deductions');
select throws_ok($$ insert into public.penalties (contestant_id, category_id, tier)
  values (current_setting('test.a')::uuid, current_setting('test.speech')::uuid, 0) $$, '42501', null, 'outsiders cannot add deductions');

-- ── settings lock and round-trip ──
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select throws_ok($$ update public.contests set report_as = 'total' where name = 'IMsL' $$, 'P0001', 'Scoring rules are locked once scoring starts',
  'report scale locks with the rules');
select set_config('test.copy', public.clone_contest(current_setting('test.c')::uuid, current_setting('test.event')::uuid, 'IMsL copy')::text, true);
select results_eq($$ select c.report_as, c.threshold_single_only,
                            (select array_agg(scored_by || ':' || guest_average || ':' || jsonb_array_length(deductions) order by sort) from public.categories where contest_id = c.id)
                     from public.contests c where c.id = current_setting('test.copy')::uuid $$,
  $$ values ('average', true, array['judges:false:2', 'judges:true:0', 'producer:false:0']) $$, 'clone keeps the new settings');

select * from finish();
rollback;
