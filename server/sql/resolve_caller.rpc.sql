-- server/sql/resolve_caller.rpc.sql
-- Resolve a user id to the claim the schema reads (Plan 40 T7).
--
-- ★ WHY THIS EXISTS.
--
-- `resolveCaller` (`server/lib/supabase.ts:270-282`) runs
-- `select is_anonymous from auth.users where id = $1`. That statement cannot run
-- over PostgREST, and the reason is a security property this project already
-- relies on: PostgREST is configured with `db-schemas=public`
-- (`docker-compose.local.yml:99`), so `auth.users` is NOT exposed. Supabase
-- configures it the same way, because the table holds every user's id, email
-- and phone (`migrations/000_portability.sql:179-193`).
--
-- So the read goes through a definer function that returns ONE column for ONE id.
--
-- ★ IT RETURNS NULL FOR A NON-EXISTENT ID, AND THAT IS THE CONTRACT.
--
-- `resolveCaller` maps "no row" to `null`, and every caller treats that as "not
-- a caller" — a 403 on a write, an anonymous read. Raising instead would turn a
-- forged `x-user-id` into a 500 rather than a 403.
--
-- ★ `security definer` IS REQUIRED AND IS SAFE HERE.
--
-- Required: the server's role must read `auth.users` without that table being
-- exposed to PostgREST at all.
--
-- Safe: the function takes a user id and returns the boolean `is_anonymous` for
-- it. It writes nothing, and the only fact it discloses is one a caller who
-- already holds a uuid cannot use — knowing that an id is anonymous says nothing
-- about who the id belongs to. It is still granted to `service_role` only, so a
-- browser holding the publishable key cannot use it as a user-id oracle.

create or replace function resolve_caller(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions, pg_temp
as $$
declare
  v_is_anonymous boolean;
begin
  if p_user_id is null then
    return null;
  end if;

  select u.is_anonymous into v_is_anonymous
  from auth.users u
  where u.id = p_user_id;

  -- `not found` here means "no such user", which the caller models as `null`.
  if not found then
    return null;
  end if;

  return jsonb_build_object('is_anonymous', coalesce(v_is_anonymous, true));
end;
$$;

revoke all on function resolve_caller(uuid) from public;
grant execute on function resolve_caller(uuid) to service_role;
