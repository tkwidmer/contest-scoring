-- Local dev seed: the worked example from docs/design/02-scoring-engine.md.
-- Sign in as producer@test.dev (code/link arrives in Mailpit, http://127.0.0.1:54324).

-- GoTrue can't scan NULL token columns, so they're set to ''.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
values ('00000000-0000-0000-0000-00000000a11c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'producer@test.dev', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', '', '', '');
insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
values (gen_random_uuid(), '00000000-0000-0000-0000-00000000a11c', '00000000-0000-0000-0000-00000000a11c', 'email',
        '{"sub":"00000000-0000-0000-0000-00000000a11c","email":"producer@test.dev"}', now(), now());

insert into public.orgs (id, name) values ('00000000-0000-0000-0000-0000000000a1', 'Great Lakes Leather');
insert into public.org_members (org_id, user_id, role)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a11c', 'producer');

insert into public.events (id, org_id, name, starts_on, venue)
values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'GLL Weekend 2027', '2027-05-21', 'Hotel Ballroom');

insert into public.contests (id, event_id, name, aggregation, threshold_pct)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', 'Mr Great Lakes Leather', 'drop_high_low', 70);

insert into public.categories (id, contest_id, name, sort, drop_rank) values
  ('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-0000000000c1', 'Speech', 1, 3),
  ('00000000-0000-0000-0000-00000000ca02', '00000000-0000-0000-0000-0000000000c1', 'Interview', 2, 2),
  ('00000000-0000-0000-0000-00000000ca03', '00000000-0000-0000-0000-0000000000c1', 'Fantasy', 3, 1);

insert into public.components (id, category_id, name, max_points, step, sort) values
  ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000ca01', 'Content', 10, 0.5, 1),
  ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-00000000ca01', 'Delivery', 10, 0.5, 2),
  ('00000000-0000-0000-0000-00000000c003', '00000000-0000-0000-0000-00000000ca02', 'Overall', 20, 0.5, 1),
  ('00000000-0000-0000-0000-00000000c004', '00000000-0000-0000-0000-00000000ca03', 'Presentation', 10, 0.5, 1);

insert into public.tiebreak_steps (contest_id, step_no, category_ids) values
  ('00000000-0000-0000-0000-0000000000c1', 1, array['00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000ca02']::uuid[]),
  ('00000000-0000-0000-0000-0000000000c1', 2, array['00000000-0000-0000-0000-00000000ca01']::uuid[]);

insert into public.contestants (id, contest_id, display_name, number, represents, sort) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'A', 1, 'Mr Chicago Leather', 1),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000c1', 'B', 2, 'Mr Detroit Leather', 2),
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000c1', 'C', 3, 'Mr Milwaukee Leather', 3);

insert into public.judges (id, contest_id, name, sort) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', 'J1', 1),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000c1', 'J2', 2),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000c1', 'J3', 3),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000c1', 'J4', 4),
  ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-0000000000c1', 'J5', 5);

insert into public.recusals (judge_id, contestant_id, reason)
values ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-00000000000b', 'Partner');
