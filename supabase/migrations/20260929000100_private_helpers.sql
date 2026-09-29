-- RLS helpers and trigger functions don't belong on the REST API (/rest/v1/rpc/*).
-- Move them to a schema PostgREST doesn't expose. Policies and triggers reference
-- functions by OID, so they keep working. Only intended RPCs stay in public.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
alter default privileges in schema private revoke execute on functions from public;

alter function public.is_org_member(uuid, text[]) set schema private;
alter function public.is_platform_admin() set schema private;
alter function public.shares_org(uuid) set schema private;
alter function public.handle_new_user() set schema private;
alter function public.keep_one_producer() set schema private;

revoke execute on all functions in schema private from public, anon, authenticated;
-- Policies run as the caller, so the caller needs execute on the helpers they use.
grant execute on function private.is_org_member(uuid, text[]), private.is_platform_admin(), private.shares_org(uuid)
  to authenticated;
