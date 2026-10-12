begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- Storage refuses direct deletes unless told they are intentional; this lets the tests exercise the delete policy.
select set_config('storage.allow_delete_query', 'true', true);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev'),   -- producer
  ('44444444-4444-4444-4444-444444444444', 'tina@test.dev'),    -- tabulator
  ('55555555-5555-5555-5555-555555555555', 'omar@test.dev');    -- producer of another org
create temp table emails as select id, email from auth.users;
grant select on emails to authenticated;
create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'email',
    (select email from emails where id = p))::text, true)
$$;

set local role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select set_config('test.org', public.create_org('GLL')::text, true);
select pg_temp.as_user('55555555-5555-5555-5555-555555555555');
select set_config('test.other', public.create_org('Other')::text, true);
reset role;
insert into public.org_members (org_id, user_id, role) values (current_setting('test.org')::uuid, '44444444-4444-4444-4444-444444444444', 'tabulator');

set local role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('logos', current_setting('test.org') || '/a.png') $$, 'a producer uploads into their organization''s folder');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('logos', current_setting('test.other') || '/a.png') $$, '42501', null, 'but not into another organization''s');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('other-bucket', current_setting('test.org') || '/a.png') $$, '42501', null, 'or another bucket');

select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('logos', current_setting('test.org') || '/b.png') $$, '42501', null, 'tabulators cannot upload');
delete from storage.objects where bucket_id = 'logos';
reset role;
select is((select count(*)::int from storage.objects where bucket_id = 'logos'), 1, 'or delete');

set local role authenticated;
select pg_temp.as_user('55555555-5555-5555-5555-555555555555');
delete from storage.objects where bucket_id = 'logos';
reset role;
select is((select count(*)::int from storage.objects where bucket_id = 'logos'), 1, 'another organization''s producer cannot delete it');

set local role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
delete from storage.objects where bucket_id = 'logos';
reset role;
select is((select count(*)::int from storage.objects where bucket_id = 'logos'), 0, 'the organization''s producer can');

select is((select public from storage.buckets where id = 'logos'), true, 'the bucket is public, so results pages can show logos');
select results_eq($$ select file_size_limit, allowed_mime_types from storage.buckets where id = 'logos' $$,
  $$ values (1048576::bigint, array['image/png', 'image/jpeg', 'image/webp']) $$, 'limited to small PNG, JPEG and WebP files');

select * from finish();
rollback;
