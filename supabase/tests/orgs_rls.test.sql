begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.dev');

select is((select count(*)::int from public.profiles), 2, 'profiles are created on signup');

-- ── Alice (creates an org) ──
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

select lives_ok($$ select set_config('test.org', public.create_org('Great Lakes Leather')::text, true) $$, 'create_org works');
select is((select count(*)::int from public.orgs), 1, 'creator sees the org');
select is((select role from public.org_members where user_id = '11111111-1111-1111-1111-111111111111'), 'producer', 'creator is producer');
select throws_ok($$ insert into public.orgs (name) values ('Sneaky') $$, '42501', null, 'direct org insert is blocked');
select throws_ok($$ update public.profiles set is_platform_admin = true $$, '42501', null, 'cannot self-promote to platform admin');
select lives_ok($$ update public.profiles set display_name = 'Alice' where id = '11111111-1111-1111-1111-111111111111' $$, 'can rename self');
select throws_ok(
  $$ delete from public.org_members where user_id = '11111111-1111-1111-1111-111111111111' $$,
  'P0001', 'An org needs at least one producer', 'last producer cannot leave');

-- ── Bob (outsider) ──
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

select is_empty($$ select * from public.orgs $$, 'outsider sees no orgs');
select is_empty($$ select * from public.org_members $$, 'outsider sees no memberships');
select is((select count(*)::int from public.profiles), 1, 'outsider sees only own profile');
select throws_ok(
  $$ insert into public.org_members (org_id, user_id, role)
     values (current_setting('test.org')::uuid, '22222222-2222-2222-2222-222222222222', 'producer') $$,
  '42501', null, 'outsider cannot join an org');

-- ── anon ──
set local role anon;
select throws_ok($$ select public.create_org('Anon Org') $$, '42501', null, 'anon cannot create orgs');

select * from finish();
rollback;
