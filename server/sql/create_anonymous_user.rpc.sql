-- server/sql/create_anonymous_user.rpc.sql
-- Mint an anonymous identity (Plan 40 T7).
--
-- ★ WHY THIS EXISTS.
--
-- `createAnonymousUser` (`server/lib/supabase.ts:182-193`) runs
-- `insert into auth.users (is_anonymous) values (true) returning id`. Two
-- problems over PostgREST:
--
--  1. `auth.users` is not exposed (`db-schemas=public`), so there is no
--     `/rest/v1/users` to POST to.
--  2. Even if it were, the WRITE would have to reach a table the client roles
--     must never touch. `migrations/000_portability.sql:179-200` grants SELECT
--     and DELETE on it to `service_role` only, and revokes SELECT from `anon`.
--
-- So the mint goes through a definer function whose only effect is one row with
-- `is_anonymous = true`.
--
-- ★ `is_anonymous: true` IS LOAD-BEARING.
--
-- It is the claim FR-8.36's restrictive policy reads. A row written here without
-- it would look like an account-holder to the schema, which is why the column is
-- set explicitly rather than left to its default — the default could change and
-- this function would silently start minting full accounts.
--
-- ★ THIS IS NOT A PUBLIC SIGN-UP ENDPOINT.
--
-- Execute is granted to `service_role` only. The route that calls it
-- (`server/routes/events.ts:50-65`) applies the per-address identity budget
-- before reaching here; a directly callable mint would be an unthrottled
-- account-creation endpoint.

create or replace function create_anonymous_user()
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into auth.users (is_anonymous)
  values (true)
  returning id into v_id;

  if v_id is null then
    -- Not reachable while the insert either commits or raises, but a NULL id
    -- would become `null::uuid` at the caller and read as "no caller".
    raise exception 'create_anonymous_user: insert returned no id';
  end if;

  return jsonb_build_object('id', v_id, 'is_anonymous', true);
end;
$$;

revoke all on function create_anonymous_user() from public;
grant execute on function create_anonymous_user() to service_role;
