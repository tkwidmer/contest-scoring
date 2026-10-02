-- Email every platform admin when a producer requests approval for an event. The database sends it through Resend's
-- API with pg_net (queued, sent after the transaction commits), using an API key kept encrypted in Supabase Vault:
--   select vault.create_secret('<resend api key>', 'resend_api_key');
-- With no key (local dev) nothing is sent; the Approvals badge and banner still show the request. A failure to queue
-- the email never blocks the request. Optional vault secret 'site_url' overrides the link (default: production URL).

create extension if not exists pg_net with schema extensions;

create function private.html_escape(p text) returns text
language sql immutable set search_path = '' as $$
  select replace(replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;')
$$;

create function private.notify_approval_request() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_key text := (select decrypted_secret from vault.decrypted_secrets where name = 'resend_api_key');
  v_site text := coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'site_url'), 'https://contest-scoring.vercel.app');
  v_to jsonb;
  v_org text := (select name from public.orgs where id = new.org_id);
  v_requester text := (select email from auth.users where id = new.approval_requested_by);
  v_contests int := (select count(*) from public.contests where event_id = new.id);
  e text := private.html_escape(new.name);
begin
  select jsonb_agg(u.email) into v_to
    from public.profiles p join auth.users u on u.id = p.id
   where p.is_platform_admin and u.email is not null;
  if v_key is null or v_to is null then return new; end if;
  begin
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
      body := jsonb_strip_nulls(jsonb_build_object(
        'from', 'Tallymaster.top <noreply@tallymaster.top>',
        'to', v_to,
        'reply_to', v_requester,
        'subject', format('Approval requested: %s (%s)', new.name, v_org),
        'html', format(
          '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#16181f">'
          '<p style="font-size:20px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;margin:0 0 20px">Tallymaster<span style="color:#e70039">.top</span></p>'
          '<p style="margin:0 0 12px"><strong>%s</strong> from <strong>%s</strong> is ready to be approved.</p>'
          '<table style="font-size:14px;margin:0 0 20px;border-collapse:collapse">'
          '<tr><td style="color:#5d6272;padding:2px 12px 2px 0">Event date</td><td>%s</td></tr>'
          '<tr><td style="color:#5d6272;padding:2px 12px 2px 0">Contests</td><td>%s</td></tr>'
          '<tr><td style="color:#5d6272;padding:2px 12px 2px 0">Requested by</td><td>%s</td></tr></table>'
          '<p style="margin:0 0 20px">Reply to this email to send them payment details. Once the $100 fee is in, approve the event:</p>'
          '<p style="margin:0 0 24px"><a href="%s/admin" style="display:inline-block;background:#18186b;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600">Review approvals</a></p>'
          '<p style="color:#5d6272;font-size:13px;margin:0">You get this because you''re a Tallymaster.top platform admin.</p></div>',
          e, private.html_escape(v_org), coalesce(to_char(new.starts_on, 'FMMonth FMDD, YYYY'), 'not set'), v_contests,
          private.html_escape(coalesce(v_requester, 'unknown')), v_site)))
    );
  exception when others then
    raise warning 'Approval email not queued: %', sqlerrm; -- never block the request itself
  end;
  return new;
end $$;

create trigger events_notify_approval after update of approval_requested_at on public.events
  for each row when (old.approval_requested_at is null and new.approval_requested_at is not null and new.approved_at is null)
  execute function private.notify_approval_request();
