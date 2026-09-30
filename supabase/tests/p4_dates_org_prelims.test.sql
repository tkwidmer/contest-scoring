begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev'),
  ('99999999-9999-9999-9999-999999999999', 'admin@test.dev');
update public.profiles set is_platform_admin = true where id = '99999999-9999-9999-9999-999999999999';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select set_config('test.org', public.create_org('GLL')::text, true);
insert into public.events (org_id, name, starts_on) values (current_setting('test.org')::uuid, 'GLL 2027', current_date);
select set_config('test.event', (select id::text from public.events), true);
reset role; update public.events set approved_at = now(); set local role authenticated;

-- ── fixing an approved event's date ──
select throws_ok($$ select public.set_event_date(current_setting('test.event')::uuid, current_date + 7) $$, '42501', null, 'producers cannot use the admin date editor');
select set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}', true);
select lives_ok($$ select public.set_event_date(current_setting('test.event')::uuid, current_date + 7) $$, 'a platform admin fixes the date');
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select is((select starts_on from public.events), current_date + 7, 'the approved event has the new date');

-- ── publishing carries the org and the prelim placings ──
insert into public.contests (event_id, name) select id, 'Mr GLL' from public.events;
select set_config('test.c', (select id::text from public.contests), true);
insert into public.categories (contest_id, name) values (current_setting('test.c')::uuid, 'Speech');
insert into public.components (category_id, name, max_points) select id, 'Speech', 10 from public.categories;
insert into public.contestants (contest_id, display_name, sort) values (current_setting('test.c')::uuid, 'A', 1), (current_setting('test.c')::uuid, 'B', 2);
insert into public.judges (contest_id, name) values (current_setting('test.c')::uuid, 'J1');
select public.set_contest_status(current_setting('test.c')::uuid, 'scoring');
insert into public.scores (judge_id, contestant_id, component_id, value)
  select j.id, c.id, k.id, 5 from public.judges j, public.contestants c, public.components k;
select set_config('test.a', (select id::text from public.contestants where display_name = 'A'), true);
select set_config('test.b', (select id::text from public.contestants where display_name = 'B'), true);
select public.finalize_contest(current_setting('test.c')::uuid, jsonb_build_object(
  'maxPossible', 10, 'winner', jsonb_build_object('kind', 'decided', 'contestantId', current_setting('test.a')),
  'standings', jsonb_build_array(jsonb_build_object('contestantId', current_setting('test.a'), 'rank', 1, 'total', 5, 'pct', 0.5, 'categoryTotals', '{}'::jsonb),
                                 jsonb_build_object('contestantId', current_setting('test.b'), 'rank', 2, 'total', 5, 'pct', 0.5, 'categoryTotals', '{}'::jsonb)),
  'prelim', jsonb_build_object('standings', jsonb_build_array(
    jsonb_build_object('contestantId', current_setting('test.b'), 'rank', 1, 'total', 9, 'pct', 0.9),
    jsonb_build_object('contestantId', current_setting('test.a'), 'rank', 2, 'total', 8, 'pct', 0.8)))));
select lives_ok($$ select public.publish_contest(current_setting('test.c')::uuid, false) $$, 'producer publishes');

reset role;
set local role anon;
select is((select org_id::text from public.published_results where contest_id = current_setting('test.c')::uuid), current_setting('test.org'), 'the published result belongs to the org (for its public page)');
select results_eq($$ select snapshot ->> 'org', snapshot -> 'prelim' -> 0 ->> 'name', snapshot -> 'prelim' -> 0 -> 'total' from public.published_results where contest_id = current_setting('test.c')::uuid $$,
  $$ values ('GLL'::text, 'B'::text, null::jsonb) $$, 'the snapshot names the org and lists prelim placings (no totals when winner-only)');
select is((select count(*)::int from public.published_results where org_id = current_setting('test.org')::uuid), 1, 'anyone can list an org''s published results');

select * from finish();
rollback;
