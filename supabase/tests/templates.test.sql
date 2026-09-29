begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- Alice produces GLL; Bob produces another org; Pat is a platform admin with no org.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.dev'),
  ('55555555-5555-5555-5555-555555555555', 'pat@test.dev');
update public.profiles set is_platform_admin = true where id = '55555555-5555-5555-5555-555555555555';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select set_config('test.org', public.create_org('GLL')::text, true);
insert into public.events (org_id, name) values (current_setting('test.org')::uuid, 'GLL 2026'), (current_setting('test.org')::uuid, 'GLL 2027');
select set_config('test.e26', (select id::text from public.events where name = 'GLL 2026'), true);
select set_config('test.e27', (select id::text from public.events where name = 'GLL 2027'), true);
insert into public.contests (event_id, name, aggregation, threshold_pct, anonymize_comments)
  values (current_setting('test.e26')::uuid, 'Mr GLL 2026', 'drop_high_low', 70, false);
select set_config('test.src', (select id::text from public.contests), true);
insert into public.categories (contest_id, name, sort, drop_rank) values
  (current_setting('test.src')::uuid, 'Speech', 1, 3), (current_setting('test.src')::uuid, 'Interview', 2, 2), (current_setting('test.src')::uuid, 'Fantasy', 3, 1);
insert into public.components (category_id, name, description, max_points, step, sort)
  select id, 'Content', 'Message and structure', 10, 0.5, 1 from public.categories where name = 'Speech'
  union all select id, 'Delivery', null, 10, 0.5, 2 from public.categories where name = 'Speech'
  union all select id, 'Overall', null, 20, 1, 1 from public.categories where name = 'Interview'
  union all select id, 'Presentation', null, 10, 1, 1 from public.categories where name = 'Fantasy';
insert into public.tiebreak_steps (contest_id, step_no, category_ids) values
  (current_setting('test.src')::uuid, 1, array(select id from public.categories where name in ('Speech', 'Interview'))),
  (current_setting('test.src')::uuid, 2, array(select id from public.categories where name = 'Speech'));
insert into public.contestants (contest_id, display_name) values (current_setting('test.src')::uuid, 'Rex');
insert into public.judges (contest_id, name) values (current_setting('test.src')::uuid, 'Jay');

-- ── clone ──
select lives_ok($$ select set_config('test.clone',
  public.clone_contest(current_setting('test.src')::uuid, current_setting('test.e27')::uuid, 'Mr GLL 2027')::text, true) $$, 'producer clones a contest into another event');
select results_eq($$ select name, event_id, status, aggregation, threshold_pct, anonymize_comments from public.contests where id = current_setting('test.clone')::uuid $$,
  $$ values ('Mr GLL 2027', current_setting('test.e27')::uuid, 'draft', 'drop_high_low', 70.00::numeric, false) $$, 'clone keeps settings, starts in draft');
select results_eq($$ select c.name, c.sort, c.drop_rank, k.name, k.description, k.max_points, k.step from public.categories c join public.components k on k.category_id = c.id
                     where c.contest_id = current_setting('test.clone')::uuid order by c.sort, k.sort $$,
  $$ values ('Speech', 1, 3, 'Content', 'Message and structure', 10.00::numeric, 0.50::numeric), ('Speech', 1, 3, 'Delivery', null, 10.00, 0.50),
            ('Interview', 2, 2, 'Overall', null, 20.00, 1.00), ('Fantasy', 3, 1, 'Presentation', null, 10.00, 1.00) $$, 'clone copies the scoresheet');
select results_eq($$ select t.step_no, (select array_agg(c.name order by c.sort) from public.categories c where c.id = any (t.category_ids))
                     from public.tiebreak_steps t where t.contest_id = current_setting('test.clone')::uuid order by t.step_no $$,
  $$ values (1, array['Speech', 'Interview']), (2, array['Speech']) $$, 'clone points tiebreak steps at its own categories');
select is((select count(*)::int from public.contestants where contest_id = current_setting('test.clone')::uuid)
        + (select count(*)::int from public.judges where contest_id = current_setting('test.clone')::uuid), 0, 'clone copies no people');

-- ── templates ──
select lives_ok($$ select set_config('test.tpl',
  public.save_contest_as_template(current_setting('test.src')::uuid, 'GLL rubric', 'Our house rubric', 'private')::text, true) $$, 'producer saves a private template');
select throws_ok($$ select public.save_contest_as_template(current_setting('test.src')::uuid, 'Official', null, 'curated') $$,
  '42501', 'Only platform admins can publish curated templates', 'producer cannot publish a curated template');
select throws_ok($$ insert into public.templates (org_id, name, rubric) values (current_setting('test.org')::uuid, 'x', '{}') $$,
  '42501', null, 'templates cannot be inserted directly');
select lives_ok($$ select set_config('test.from_tpl',
  public.create_contest_from_template(current_setting('test.tpl')::uuid, current_setting('test.e27')::uuid, 'Ms GLL 2027')::text, true) $$, 'producer creates a contest from a template');
select is((select count(*)::int from public.components k join public.categories c on c.id = k.category_id where c.contest_id = current_setting('test.from_tpl')::uuid), 4,
  'template contest gets the full scoresheet');

-- Bob (another org) can't see or use the private template, or clone Alice's contest.
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select set_config('test.bob_org', public.create_org('Bob Leather')::text, true);
insert into public.events (org_id, name) values (current_setting('test.bob_org')::uuid, 'Bob 2027');
select set_config('test.bob_event', (select id::text from public.events where name = 'Bob 2027'), true);
select is((select count(*)::int from public.templates where visibility <> 'curated'), 0, 'other orgs cannot see a private template');
select throws_ok($$ select public.create_contest_from_template(current_setting('test.tpl')::uuid, current_setting('test.bob_event')::uuid, 'Stolen') $$,
  'P0001', 'Template not found', 'other orgs cannot use a private template');
select throws_ok($$ select public.clone_contest(current_setting('test.src')::uuid, current_setting('test.bob_event')::uuid, 'Stolen') $$,
  '42501', 'You can only copy contests from your own organizations', 'other orgs cannot clone your contest');

-- Alice makes it public; now Bob can use it but not edit it.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
update public.templates set visibility = 'public' where org_id is not null;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select lives_ok($$ select public.create_contest_from_template(current_setting('test.tpl')::uuid, current_setting('test.bob_event')::uuid, 'Mr Bob') $$,
  'public templates can be used by any producer');
update public.templates set name = 'Hijacked';
select is((select count(*)::int from public.templates where name = 'Hijacked'), 0, 'other orgs cannot edit a public or curated template');
select throws_ok($$ select public.clone_contest(current_setting('test.src')::uuid, current_setting('test.e27')::uuid, 'x') $$,
  '42501', null, 'cannot add a contest to another org''s event');

-- Pat, a platform admin, curates a template for everyone.
reset role;
insert into public.org_members (org_id, user_id, role) values (current_setting('test.org')::uuid, '55555555-5555-5555-5555-555555555555', 'producer');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
select lives_ok($$ select public.save_contest_as_template(current_setting('test.src')::uuid, 'Official rubric', null, 'curated') $$,
  'platform admin publishes a curated template');
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select is((select array_agg(name order by name) from public.templates where created_by is not null), array['GLL rubric', 'Official rubric'], 'everyone sees public and curated templates');

select * from finish();
rollback;
