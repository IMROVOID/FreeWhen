-- migrations/001_extensions.sql
-- Idempotent and reversible. One concern. Named for what it creates.

-- pgcrypto provides gen_random_uuid() and digest() (sha256 token hashing).
-- GOTCHA: digest() lives in pgcrypto, not core. Migration 012 fails without
-- this, and the failure surfaces as "function digest does not exist" — obscure
-- if 001 was skipped.
-- `with schema public` matters: on Supabase pgcrypto is pre-installed in the
-- `extensions` schema, and a bare `create extension if not exists` is a
-- no-op there, so `digest()` would not be resolvable from a function whose
-- search_path is `public`. Naming the schema makes the intent explicit, and
-- the functions that use digest() search `public, extensions` so they
-- resolve on BOTH backends.
create extension if not exists pgcrypto with schema public;

-- Optional proximity helpers. Absent on some managed Postgres hosts, and
-- nothing in migrations 002-014 depends on them, so a failure here is not
-- fatal. Kept in a DO block because CREATE EXTENSION cannot be run inside a
-- conditional expression.
do $$
begin
  begin
    create extension if not exists cube;
  exception when others then
    null;
  end;

  begin
    create extension if not exists earthdistance;
  exception when others then
    null;
  end;
end
$$;
