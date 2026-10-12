begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

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

-- Scoring is under way: one scored and submitted sheet, a deduction, and a frozen result.
reset role;
update public.categories set deductions = '[{"label":"Over time","points":5}]'::jsonb where contest_id = current_setting('test.c')::uuid;
update public.contests set status = 'scoring', final_result = '{"winner":"Rex"}'::jsonb where id = current_setting('test.c')::uuid;
set local role authenticated;
insert into public.scores (judge_id, contestant_id, component_id, value)
  select j.id, c.id, k.id, 8 from public.judges j, public.contestants c, public.components k;
select public.submit_sheet((select id from public.judges), (select id from public.contestants), (select id from public.categories));
insert into public.penalties (contestant_id, category_id, tier) select c.id, k.id, 0 from public.contestants c, public.categories k;
insert into public.comments (judge_id, contestant_id, body) select j.id, c.id, 'private note' from public.judges j, public.contestants c;
-- Duke arrives unscored, with the judge recused from him (Rex's scoring above isn't blocked by it).
insert into public.contestants (contest_id, display_name) values (current_setting('test.c')::uuid, 'Duke');
insert into public.recusals (judge_id, contestant_id) select j.id, c.id from public.judges j, public.contestants c where c.display_name = 'Duke';

-- ── the platform admin reads the whole configuration ──
select set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}', true);
-- Scoped to Alice's rows: the seed data from other organizations is visible to the admin too.
select results_eq($$ select (select count(*) from public.orgs where id = current_setting('test.org')::uuid),
                            (select count(*) from public.events where org_id = current_setting('test.org')::uuid),
                            (select count(*) from public.contests where id = current_setting('test.c')::uuid) $$,
  $$ values (1::bigint, 1::bigint, 1::bigint) $$, 'admin reads the org, event and contest');
select results_eq($$ select (select count(*) from public.categories where contest_id = current_setting('test.c')::uuid),
                            (select count(*) from public.components where category_id in (select id from public.categories where contest_id = current_setting('test.c')::uuid)),
                            (select count(*) from public.tiebreak_steps where contest_id = current_setting('test.c')::uuid) $$,
  $$ values (1::bigint, 1::bigint, 1::bigint) $$, 'admin reads the scoresheet and tiebreaks');
select results_eq($$ select (select count(*) from public.contestants where contest_id = current_setting('test.c')::uuid and display_name = 'Rex'),
                            (select count(*) from public.judges where contest_id = current_setting('test.c')::uuid),
                            (select count(*) from public.recusals where judge_id in (select id from public.judges where contest_id = current_setting('test.c')::uuid)) $$,
  $$ values (1::bigint, 1::bigint, 1::bigint) $$, 'admin reads contestants, judges and recusals');
select results_eq($$ select (select count(*) from public.scores where contest_id = current_setting('test.c')::uuid),
                            (select count(*) from public.penalties where contest_id = current_setting('test.c')::uuid),
                            (select count(*) from public.sheet_submissions where contest_id = current_setting('test.c')::uuid) $$,
  $$ values (1::bigint, 1::bigint, 1::bigint) $$, 'admin reads scores, deductions and submitted sheets');
select is((select public.contest_final_result(current_setting('test.c')::uuid)->>'winner'), 'Rex', 'admin reads the frozen result');
select is_empty($$ select 1 from public.contestant_contacts $$, 'but not contestant emails');
select is_empty($$ select 1 from public.comments $$, 'or comments');
select is_empty($$ select 1 from public.score_audit $$, 'or the score audit trail');
select is_empty($$ select 1 from public.sheet_audit $$, 'or the sheet audit trail');

-- ── and cannot change any of it ──
select throws_ok($$ insert into public.events (org_id, name) values (current_setting('test.org')::uuid, 'Sneaky') $$, '42501', null, 'admin cannot add an event');
select throws_ok($$ insert into public.contests (event_id, name) select id, 'Sneaky' from public.events $$, '42501', null, 'admin cannot add a contest');
select throws_ok($$ insert into public.penalties (contestant_id, category_id, tier) select c.id, k.id, 0 from public.contestants c, public.categories k $$,
  '42501', null, 'admin cannot apply a deduction');
select throws_ok($$ insert into public.judges (contest_id, name) values (current_setting('test.c')::uuid, 'Sneaky') $$, '42501', null, 'admin cannot add a judge');
update public.scores set value = 0; -- RLS filters each of these to zero rows
delete from public.penalties;
update public.contests set name = 'Hacked';
update public.components set max_points = 99;
delete from public.contests;
delete from public.judges;

-- ── everyone else still sees nothing outside their own organizations ──
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select is_empty($$ select 1 from public.contests $$, 'an outsider still sees no contests');
select is_empty($$ select 1 from public.scores $$, 'an outsider still sees no scores');
select is((select public.contest_final_result(current_setting('test.c')::uuid)), null, 'an outsider gets no frozen result');

-- ── and Alice's setup is untouched ──
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select is((select name from public.contests), 'Mr GLL', 'admin cannot rename a contest');
select is((select value::int from public.scores), 8, 'admin cannot change a score');
select is((select count(*)::int from public.penalties), 1, 'admin cannot remove a deduction');
select is((select max_points::int from public.components), 10, 'admin cannot edit the scoresheet');
select is((select count(*)::int from public.contests), 1, 'admin cannot delete a contest');
select is((select count(*)::int from public.judges), 1, 'admin cannot delete a judge');

select * from finish();
rollback;
