-- migrations/000_portability.sql
-- The portability shim (PRD-09 §4.0).
--
-- PROVISIONAL OWNERSHIP: this file is P02B's deliverable. P02 needs it in
-- order to apply migrations 001-014 to a plain Postgres instance, so it is
-- created here verbatim from PRD-09 §4.0. P02B owns it from this point and
-- may amend it — the only change P02 made is the guarded creation described
-- below, which is what makes the file a true no-op on Supabase (D22).
--
-- Why the guard: `create or replace function auth.uid()` would overwrite a
-- platform-owned function on Supabase. The shim body therefore lives in two
-- distinctly named functions that are always (re)created, and the public
-- `auth.uid()` / `auth.is_anonymous()` entries are created ONLY when they
-- are absent. On Supabase nothing is replaced; on plain Postgres both are
-- created and delegate to the shim body.

create schema if not exists auth;

-- The three database roles the schema's policies and grants refer to.
--
-- On Supabase they already exist and this block is a no-op. On plain Postgres
-- they must exist before migrations 003 and 011 can GRANT to them and before
-- a policy can name them in a `to` clause.
--
-- They are created NOLOGIN: the roles are targets for `grant` and for
-- `set role`, not login accounts. The connection role is a separate concern.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end
$$;

-- ★ BYPASSRLS on `service_role`, matching Supabase.
--
-- The server holds this role, and it is the only thing that writes the
-- shared travel cache and the append-only activity log. On Supabase the
-- role already has the attribute; a plain Postgres role created without it
-- would make the two backends behave differently, which is exactly what
-- D22 exists to prevent.
--
-- `alter role` rather than `create role ... bypassrls`, so the attribute is
-- applied even when the role already existed — the conditional create above
-- only covers a role's FIRST appearance.
alter role service_role bypassrls;

-- ★ USAGE on the `auth` schema.
--
-- Every policy calls `auth.uid()`, and `auth.uid()` lives in the `auth`
-- schema. Without this grant the call fails with "permission denied for
-- schema auth" the moment a policy is evaluated — which is every request.
--
-- On Supabase the grant already exists; this statement is a no-op there.
grant usage on schema auth to anon, authenticated, service_role;

-- The shim body. Always replaced; it references nothing but pg_catalog.
create or replace function auth.freewhen_uid() returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::json->>'sub',
    nullif(current_setting('request.jwt.claim.sub', true), '')
  )::uuid;
$$;

-- The anonymous flag. `is_anonymous` is cast BEFORE coalesce, so a missing
-- claim yields false rather than NULL — a NULL there would silently disable
-- the FR-8.36 restrictive policy.
create or replace function auth.freewhen_is_anonymous() returns boolean
language sql
stable
as $$
  select coalesce(
    (nullif(current_setting('request.jwt.claims', true), '')::json->>'is_anonymous')::boolean,
    false
  );
$$;

do $$
begin
  if to_regprocedure('auth.uid()') is null then
    execute 'create function auth.uid() returns uuid language sql stable as $b$ select auth.freewhen_uid() $b$';
  end if;

  if to_regprocedure('auth.is_anonymous()') is null then
    execute 'create function auth.is_anonymous() returns boolean language sql stable as $b$ select auth.freewhen_is_anonymous() $b$';
  end if;
end
$$;

-- Identity table. On Supabase this already exists and is populated by GoTrue;
-- `create table if not exists` leaves it untouched there. On plain Postgres it
-- is ours, and our auth service writes to it. Columns mirror the Supabase
-- subset we actually use — nothing else is referenced anywhere in this PRD.
create table if not exists auth.users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique,
  phone         text unique,
  is_anonymous  boolean not null default true,
  created_at    timestamptz not null default now(),
  last_sign_in_at timestamptz
);

-- The cleanup job filters on these two columns; the index is what keeps the
-- 30-day sweep from scanning the whole table.
create index if not exists auth_users_anonymous_created_at_idx
  on auth.users (is_anonymous, created_at);

-- ★ SELECT on `auth.users` is NOT granted to the client roles.
--
-- An earlier draft granted it "because the foreign keys need it". That is
-- false: PostgreSQL checks foreign keys as the table owner, so the
-- INSERTING role does not need SELECT on the referenced table. Verified —
-- a `participant` insert with an FK to `auth.users` still succeeds with
-- the grant revoked.
--
-- Granting it would publish every user's id, email and phone to anyone
-- holding the publishable anon key, and would let an attacker enumerate
-- user ids to impersonate.
--
-- Supabase does not expose the `auth` schema to `anon` either
-- (`db-schemas=public`), so this matches the platform's behaviour rather
-- than diverging from it.
--
-- The server reads `auth.users` through the service role.
grant select on auth.users to service_role;

-- The cleanup job deletes abandoned anonymous users. The server holds the
-- service role, so the job runs with this grant.
grant delete on auth.users to service_role;

-- ★ The REVOKE is explicit, and it is not optional.
--
-- `drop schema public cascade` in `--fresh` does NOT touch the `auth`
-- schema, so a grant made by an earlier version of this file SURVIVES a
-- fresh migration. A `grant` alone would therefore not fix a database
-- that had already been migrated — the exposure would persist and the
-- migration would report success.
--
-- Revoking is safe on Supabase: the `anon` role there has no access to
-- `auth` either (PostgREST is configured with `db-schemas=public`).
revoke select on auth.users from anon, authenticated;
revoke insert, update, delete on auth.users from anon, authenticated;
