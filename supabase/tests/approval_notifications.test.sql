begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev'),
  ('88888888-8888-8888-8888-888888888888', 'meg@test.dev'),
  ('99999999-9999-9999-9999-999999999999', 'admin@test.dev');
update public.profiles set is_platform_admin = true where id in ('88888888-8888-8888-8888-888888888888', '99999999-9999-9999-9999-999999999999');
create temp table queued_before as select coalesce(max(id), 0) as id from net.http_request_queue;
create function pg_temp.queued() returns setof net.http_request_queue language sql as $$
  select * from net.http_request_queue where id > (select id from queued_before)
$$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select set_config('test.org', public.create_org('GLL <b>')::text, true);
insert into public.events (org_id, name, starts_on) values
  (current_setting('test.org')::uuid, 'No key yet', current_date), (current_setting('test.org')::uuid, 'GLL 2027 <script>', current_date);

-- Without a Resend key nothing is queued, and the request still goes through.
select lives_ok($$ select public.request_event_approval(id) from public.events where name = 'No key yet' $$, 'requesting works without email set up');
reset role;
select is((select count(*)::int from pg_temp.queued()), 0, 'no email without a Resend key');

-- With a key, one email goes to every platform admin.
select vault.create_secret('re_test_key', 'resend_api_key');
set local role authenticated;
select public.request_event_approval(id) from public.events where name = 'GLL 2027 <script>';
reset role;
select is((select count(*)::int from pg_temp.queued()), 1, 'one email is queued');
select is((select url from pg_temp.queued()), 'https://api.resend.com/emails', 'sent through Resend');
select results_eq($$ select (select array_agg(x order by x) from jsonb_array_elements_text(convert_from(body, 'utf8')::jsonb -> 'to') x),
                            convert_from(body, 'utf8')::jsonb ->> 'reply_to' from pg_temp.queued() $$,
  $$ values (array['admin@test.dev', 'meg@test.dev'], 'alice@test.dev') $$, 'to every platform admin, replies go to the requester');
select ok((select convert_from(body, 'utf8')::jsonb ->> 'html' from pg_temp.queued()) like '%GLL 2027 &lt;script&gt;%', 'names are HTML-escaped in the email');

select * from finish();
rollback;
