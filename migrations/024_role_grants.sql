-- migrations/024_role_grants.sql
-- Idempotent and reversible. One concern. Named for what it creates.
--
-- ★ THE MISSING GRANT WAS INVISIBLE ON BOTH DOCUMENTED BACKENDS.
--
-- `withCallerTransaction` (`server/lib/supabase.ts:283`) opens every
-- caller-scoped unit with
--
--     set local role service_role
--
-- `000_portability.sql:87-101` granted `service_role` to `authenticator` and
-- `authenticated` to `service_role` — every membership on the diagram EXCEPT the
-- one the server itself needs: the membership of the CONNECTION role in
-- `service_role`.
--
-- Nothing noticed, because neither backend asks for it:
--
--   * locally the connection is `postgres`, a SUPERUSER. `SET ROLE` on a
--     superuser succeeds against any role without a membership row, so the
--     statement is a no-op that always works.
--
--   * on Supabase the connection is also `postgres`, which the platform grants
--     `service_role` to outright.
--
-- A managed Postgres whose login role is neither superuser nor a member — Neon's
-- default `neondb_owner`, reached over the pooler — makes the statement fail on
-- every request that writes:
--
--     api: request failed: permission denied to set role "service_role"
--
-- which is a 500 on join, vote, confirm, proposal creation, and the events list.
-- The deployed web app answers «این لینک کار نمی کند» and «مشکلی در سرور رخ داده
-- است», which reads as a broken invite rather than as a missing grant.
--
-- ★ MEMBERSHIP ALONE IS NOT ENOUGH, AND THAT COST A ROUND OF DEBUGGING.
--
-- A grant is only half of it. Since Postgres 16 a membership carries `ADMIN`,
-- `INHERIT` and `SET` as three independent options, and `SET ROLE` needs `SET`.
-- On this database each is `INHERIT FALSE, SET FALSE`: the role OWNS the
-- objects, so it needs no attribute inheritance and no way to switch.
--
-- After a plain `grant`, `pg_has_role(neondb_owner, 'service_role', 'member')`
-- answered true and `set role service_role` STILL answered
--
--     42501: permission denied to set role "service_role"
--
-- because `pg_has_role(..., 'member')` reports the grant, not the permission.
-- `ALTER ROLE <login> SET ROLE service_role` is refused as well —
-- "permission will be denied" — so the option must be replaced, not modified.
--
-- ★ THE OPTIONS ARE REPLACED, NOT JUST GRANTED.
--
-- `GRANT` before `REVOKE` would raise `0LP01: ADMIN option cannot be granted
-- back to your own grantor`, and the plain `REVOKE` that precedes it answers
-- "has not been granted membership ... by role <self>" — because the membership
-- was issued BY THE PROVIDER, not by this session. Both notices are harmless;
-- the pair is what leaves exactly one membership carrying exactly
-- `INHERIT FALSE, SET TRUE`.
--
-- ★ NO ADMIN OPTION, AND THAT IS THE POINT.
--
-- The schema never needs to re-grant `service_role`: this file is the only place
-- that does, and it runs once per database. Admin option is what makes the grant
-- revocable by the grantee AND what raises the "own grantor" error, so the
-- provider-issued admin grant is removed rather than re-created.
--
-- ★ `session_user`, NOT A LITERAL ROLE NAME, AND NOT `current_user`.
--
-- The runner connects with the operator's credentials and applies this file in
-- that session. A literal (`neondb_owner`) would be wrong on Supabase, wrong on
-- the local compose stack, and wrong for an operator who connects as anything
-- else.
--
-- `current_user` is wrong too, on exactly the backend this file exists for: see
-- the `v_login` declaration below.
--
-- ★ WHAT IS SKIPPED, AND WHY.
--
-- A SUPERUSER needs no membership at all, and on Supabase `postgres` is one —
-- issuing `grant service_role to postgres` there raises `0LP01` instead of
-- succeeding. So the block is skipped entirely for a superuser and for a
-- membership that already carries `SET TRUE`.

do $$
declare
  -- ★ `session_user`, NOT `current_user`.
  --
  -- Neon's pooler connects as `neondb_owner` and immediately sets
  -- `role = service_role`, so `current_user` is ALREADY `service_role` before
  -- this file runs — and `revoke service_role from service_role` is a 42501
  -- about ADMIN, not about the membership. `session_user` is the role the
  -- credential logs in as, which is the role the remaining grants hang off.
  --
  -- On a backend that sets no such parameter the two are the same role, so this
  -- is `current_user` everywhere the bug was originally reported, and the right
  -- answer on the one backend where they differ.
  v_login     text    := session_user;
  v_is_super  boolean;
  v_member    boolean;
  v_can_set   boolean;
begin
  select r.rolsuper into v_is_super from pg_roles r where r.rolname = v_login;

  if v_is_super then
    raise notice 'session role % is a superuser; service_role needs no grant', v_login;
    return;
  end if;

  -- Already switchable. Read the OPTION, not membership: a member with
  -- `SET FALSE` is exactly the broken state this block repairs.
  select coalesce(bool_or(am.set_option), false),
         coalesce(bool_or(true), false)
    into v_can_set, v_member
    from pg_auth_members am
    join pg_roles r on r.oid = am.member
    join pg_roles m on m.oid = am.roleid
   where r.rolname = v_login
     and m.rolname = 'service_role';

  if v_can_set then
    raise notice 'session role % can already SET ROLE service_role', v_login;
    return;
  end if;

  -- ★ REVOKE ONLY WHEN THERE IS SOMETHING TO REVOKE.
  --
  -- Issued unconditionally, this became `revoke service_role from <role>` on a
  -- database that had no such membership and Postgres answered
  --
  --     42501: permission denied to revoke role "service_role"
  --
  -- because a revoke needs ADMIN whether or not the row exists. Guarding on
  -- `v_member` makes it a no-op in that case, and the `grant` beside it is
  -- idempotent, so a re-run against a repaired database changes nothing.
  if v_member then
    execute format('revoke service_role from %I', v_login);
  end if;

  execute format('grant service_role to %I with inherit false, set true', v_login);

  raise notice 'session role % may now SET ROLE service_role', v_login;
end
$$;

-- ─────────────────────────────────────────────────────────────
-- The mint's missing INSERT
-- ─────────────────────────────────────────────────────────────
--
-- ★ `SET ROLE` WAS ONLY THE FIRST 500 ON THIS PATH.
--
-- With the membership fixed, `POST /api/invite/:token/join` still answered 500,
-- and the server's own log line named the next failure:
--
--     api: request failed: permission denied for table users
--
-- `createAnonymousUser` (`server/lib/supabase.ts:213`) runs
--
--     insert into auth.users (is_anonymous) values (true) returning id
--
-- as `service_role`, and `000_portability.sql:196-200` granted that role SELECT
-- and DELETE on `auth.users` — the two operations migrations had needed so far.
-- The mint was never among them, so it worked only where the connection was the
-- table's OWNER: `postgres` locally and on Supabase, where an owner needs no
-- privilege. On Neon the owner is `neondb_owner` and the request runs as
-- `service_role`, so the insert was refused.
--
-- ★ INSERT ONLY. NOT UPDATE, NOT TRUNCATE, NOT RE-EXPOSED SELECT.
--
-- Minting an identity is the one write the product performs on this table, and
-- `delete` is already granted for account deletion (Apple §5.1.1(v)). `update`
-- would let the server rewrite an address or phone number — nothing asks it to,
-- and a grant nobody uses is a grant that outlives its reason. `anon` and
-- `authenticated` stay revoked (`000_portability.sql:212-213`).

-- ─────────────────────────────────────────────────────────────
-- The profile table's missing service_role grants
-- ─────────────────────────────────────────────────────────────
--
-- ★ THIS ONE IS VISIBLE IN THE REPORTED CONSOLE.
--
--     PUT https://freewhen-orpin.vercel.app/api/profile 403 (Forbidden)
--
-- `021_user_profile.sql:118-119` granted `user_profile` to `authenticated` only
-- — column-scoped, which is right for a client that holds a JWT and is subject
-- to the RLS predicates beside it. But the API does not act as
-- `authenticated`: `withCallerTransaction` sets the role to `service_role` and
-- carries the caller's identity in the JWT CLAIMS, so `service_role` is the role
-- that must be able to read and write this table.
--
-- It worked on Supabase and locally for the same reason the other two defects
-- hid: the connection was the table's owner there. On Neon it is not, so the
-- API's own statements were refused — a 42501 that `/api/profile` reports as a
-- generic failure, which is what the client rendered as "a problem occurred on
-- the server".
--
-- ★ CRUD ONLY — NOT TRUNCATE, NOT REFERENCES, NOT TRIGGER.
--
-- A managed provider grants `ALL` by default and that includes `TRUNCATE` on
-- every table, which no route can use and no accident should be able to reach.
-- RLS still does not apply to `service_role` (it holds BYPASSRLS, matching
-- Supabase), and that is unchanged by this file: the routes are the gate, as
-- they already are for the other seventeen tables.
---
-- ★ ISSUED AS THE SESSION ROLE, BECAUSE A GRANT NEEDS THE GRANTOR TO BE RIGHT.
--
-- Neon's pooler connects as `neondb_owner` and sets `role = service_role`, so a
-- bare `grant` in this session is issued BY `service_role` — which owns nothing,
-- so Postgres answers "no privileges were granted" and nothing changes.
-- `reset role` does not help: `role` is a connection parameter there, not a
-- `SET ROLE`, so resetting it restores the same role.
--
-- `SET LOCAL ROLE` to the session role IS allowed, and it puts the grant back in
-- the hands of the role that actually owns these tables. On a backend where the
-- two roles are the same this is a no-op that grants to itself.
--
-- Idempotent either way: granting a privilege that is already held is a no-op,
-- and it is safe on Supabase where the platform has already granted more.
do $$
begin
  begin
    execute format('set local role %I', session_user);
  exception when others then
    -- A backend that will not let the session re-enter its own role leaves the
    -- grants to whoever is already connected, which is what worked before this.
    raise notice 'could not SET ROLE %: %', session_user, sqlerrm;
  end;

  grant insert on auth.users to service_role;

  grant select, insert, update, delete on user_profile to service_role;
end
$$;

-- ─────────────────────────────────────────────────────────────
-- Why no grant to `authenticated` is added here
-- ─────────────────────────────────────────────────────────────
--
-- The server only ever switches to `service_role` (`withCallerTransaction`) and
-- never to `authenticated`: the caller's identity travels as JWT claims, not as
-- a role (`server/lib/supabase.ts:236-270`). The one role switch to
-- `authenticated` happens in the realtime bridge, which holds the service role
-- and already carries that membership from `000_portability.sql:101`.
--
-- Granting `authenticated` to the login role would let a leaked application
-- credential read every event the caller is not a participant of, for no gain.

-- ─────────────────────────────────────────────────────────────
-- The one thing this file deliberately does NOT fix
-- ─────────────────────────────────────────────────────────────
--
-- ★ `ensureServerSql` RE-ISSUED DDL IT HAD NO RIGHT TO ISSUE. Fixed in code.
--
-- `server/lib/server-sql.ts` applied all six `server/sql/*.sql` files on the
-- first request of EVERY process, before checking whether the functions were
-- already there. `create or replace function` needs `CREATE` on schema `public`
-- and OWNERSHIP of the function it replaces, and `000_portability.sql:123`
-- grants the server USAGE only — deliberately, because a server that never
-- creates anything needs nothing more. So the first request after each deploy
-- answered
--
--     permission denied for schema public
--
-- on join, vote, confirm and the proposal list, and the failure looked like a
-- broken invite.
--
-- That is not fixable here. `CREATE` on `public` would let the application
-- create arbitrary objects in the schema every policy lives in, and handing the
-- units' ownership to `service_role` would mean this file dropping and
-- re-creating functions whose bodies live in `server/sql/` — SQL cannot read a
-- file, and a retyped copy of those bodies in a migration is the drift
-- `tests/server/server-sql.test.ts` exists to prevent.
--
-- The applier now asks the catalogue FIRST and issues no DDL when the functions
-- are present, which is every request on every healthy backend. A backend that
-- genuinely loses its functions still needs the migration role to repair them,
-- which is what a deploy already does.

-- ─────────────────────────────────────────────────────────────
-- Reverse
-- ─────────────────────────────────────────────────────────────
-- `revoke insert on auth.users from service_role;` — the mint then fails again
-- on any backend where the connection is not the table's owner.
-- `revoke all on user_profile from service_role;` — `/api/profile` returns to
-- the 403 in the original report.
-- `revoke service_role from <login role>;` — safe on any backend. A superuser
-- or an existing member keeps working; anything else returns to the 42501 above.
