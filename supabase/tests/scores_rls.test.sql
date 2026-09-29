begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

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
insert into public.contests (event_id, name) select id, 'Mr GLL' from public.events;
insert into public.contests (event_id, name) select id, 'Ms GLL' from public.events;
select set_config('test.c', (select id::text from public.contests where name = 'Mr GLL'), true);
select set_config('test.other', (select id::text from public.contests where name = 'Ms GLL'), true);
insert into public.categories (contest_id, name) values (current_setting('test.c')::uuid, 'Speech');
insert into public.components (category_id, name, max_points, step) select id, 'Content', 10, 0.5 from public.categories;
insert into public.contestants (contest_id, display_name) values
  (current_setting('test.c')::uuid, 'Rex'), (current_setting('test.c')::uuid, 'Duke'), (current_setting('test.other')::uuid, 'Ms One');
insert into public.judges (contest_id, name) values
  (current_setting('test.c')::uuid, 'Jay'), (current_setting('test.c')::uuid, 'Kim'), (current_setting('test.other')::uuid, 'Lou');
select set_config('test.k', (select id::text from public.components), true);
select set_config('test.rex', (select id::text from public.contestants where display_name = 'Rex'), true);
select set_config('test.duke', (select id::text from public.contestants where display_name = 'Duke'), true);
select set_config('test.msone', (select id::text from public.contestants where display_name = 'Ms One'), true);
select set_config('test.jay', (select id::text from public.judges where name = 'Jay'), true);
select set_config('test.kim', (select id::text from public.judges where name = 'Kim'), true);
insert into public.recusals (judge_id, contestant_id) values (current_setting('test.kim')::uuid, current_setting('test.duke')::uuid);

create function pg_temp.score(j text, c text, v numeric) returns void language sql as $$
  insert into public.scores (judge_id, contestant_id, component_id, value)
  values (current_setting(j)::uuid, current_setting(c)::uuid, current_setting('test.k')::uuid, v)
  on conflict (judge_id, contestant_id, component_id) do update set value = excluded.value
$$;

select throws_ok($$ select pg_temp.score('test.jay', 'test.rex', 8) $$,
  'P0001', 'Scores can only be changed while the contest is being scored', 'no scores while in draft');

reset role;
insert into public.org_members (org_id, user_id, role)
  values (current_setting('test.org')::uuid, '33333333-3333-3333-3333-333333333333', 'tabulator');
update public.judges set user_id = '44444444-4444-4444-4444-444444444444' where name = 'Jay';
set local role authenticated;

-- ── status transitions ──
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select throws_ok($$ select public.set_contest_status(current_setting('test.c')::uuid, 'scoring') $$,
  '42501', null, 'tabulator cannot start scoring');
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select throws_ok($$ select public.set_contest_status(current_setting('test.other')::uuid, 'scoring') $$,
  'P0001', 'Add at least one scored component before scoring starts', 'scoring needs a rubric');
select throws_ok($$ select public.set_contest_status(current_setting('test.c')::uuid, 'published') $$,
  'P0001', 'A contest can''t move from draft to published', 'invalid transition is rejected');
select lives_ok($$ select public.set_contest_status(current_setting('test.c')::uuid, 'scoring') $$, 'producer starts scoring');

-- ── validation ──
select lives_ok($$ select pg_temp.score('test.jay', 'test.rex', 8.5) $$, 'producer enters a score');
select results_eq($$ select contest_id, entered_by from public.scores $$,
  $$ values (current_setting('test.c')::uuid, '11111111-1111-1111-1111-111111111111'::uuid) $$,
  'contest_id and entered_by are filled in by the database');
select throws_ok($$ select pg_temp.score('test.jay', 'test.duke', 11) $$,
  'P0001', 'Score must be between 0 and 10 in steps of 0.5', 'out-of-range score is rejected');
select throws_ok($$ select pg_temp.score('test.jay', 'test.duke', 7.25) $$,
  'P0001', 'Score must be between 0 and 10 in steps of 0.5', 'off-step score is rejected');
select throws_ok($$ select pg_temp.score('test.kim', 'test.duke', 7) $$,
  'P0001', 'This judge is recused from this contestant', 'recused cell cannot be scored');
select throws_ok($$ select pg_temp.score('test.jay', 'test.msone', 7) $$,
  'P0001', 'The judge, contestant and component must be in the same contest', 'cross-contest score is rejected');
select throws_ok($$ select public.set_contest_status(current_setting('test.c')::uuid, 'draft') $$,
  'P0001', 'Scores have been entered, so the contest can''t go back to draft', 'cannot return to draft once scored');

-- ── tabulator enters and corrects; audit records it ──
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select lives_ok($$ select pg_temp.score('test.kim', 'test.rex', 6) $$, 'tabulator enters a score');
select lives_ok($$ select pg_temp.score('test.kim', 'test.rex', 6.5) $$, 'tabulator corrects a score');
select lives_ok($$ select pg_temp.score('test.kim', 'test.rex', 6.5) $$, 'saving the same value again is fine');
select lives_ok($$ delete from public.scores where judge_id = current_setting('test.kim')::uuid $$, 'tabulator clears a score');
select is((select count(*)::int from public.score_audit), 0, 'tabulator cannot read the audit log');

select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select results_eq($$ select op, old_value, new_value, changed_by from public.score_audit
                     where judge_id = current_setting('test.kim')::uuid order by id $$,
  $$ values ('insert', null::numeric, 6.00::numeric, '33333333-3333-3333-3333-333333333333'::uuid),
            ('update', 6.00, 6.50, '33333333-3333-3333-3333-333333333333'),
            ('delete', 6.50, null, '33333333-3333-3333-3333-333333333333') $$,
  'audit records insert, update and delete by the tabulator; no-op saves are skipped');
select throws_ok($$ insert into public.score_audit (score_id, contest_id, judge_id, contestant_id, component_id, op)
  values (gen_random_uuid(), current_setting('test.c')::uuid, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'insert') $$,
  '42501', null, 'nobody writes the audit log directly');
select throws_ok($$ delete from public.score_audit $$, '42501', null, 'nobody deletes from the audit log');

-- ── judge sees only their own scores; can't write yet ──
select pg_temp.score('test.kim', 'test.rex', 5);
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
select is((select array_agg(value) from public.scores), array[8.50::numeric], 'judge sees only their own scores');
select throws_ok($$ select pg_temp.score('test.jay', 'test.duke', 5) $$, '42501', null, 'judge cannot enter scores yet');

-- ── outsider ──
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select is((select count(*)::int from public.scores) + (select count(*)::int from public.score_audit), 0, 'outsider sees no scores');
select throws_ok($$ select pg_temp.score('test.jay', 'test.duke', 5) $$, '42501', null, 'outsider cannot enter scores');
select throws_ok($$ select public.set_contest_status(current_setting('test.c')::uuid, 'draft') $$,
  '42501', null, 'outsider cannot change status');

select * from finish();
rollback;
