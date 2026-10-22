-- migrations/017_analytics.sql
-- Idempotent and reversible. One concern. Named for what it creates.
--
-- ★ THE NUMBER IS 017, NOT 015, AND IT MATTERS.
--
-- The plan called this migration `015_analytics`. Both 015 and 016 already
-- exist on disk (`015_realtime_notify`, `016_demo_read`), and the runner
-- applies files in FILENAME ORDER — a second `015_` would sort before
-- `015_realtime_notify` and be applied BEFORE the things it references.
-- `analytics_event.event_id` is a foreign key to `event`, which migration 002
-- creates, so the ordering would have been correct by luck; the next reader
-- would not have been able to tell. 017 also means `is_demo` exists before
-- this file, which is what the emitter's demo-event bookkeeping assumes.
--
-- ★ THE FUNNEL IS MEASURED, NOT GUESSED.
--
-- PRD-12 §8 defines seven funnel events and the three numbers that decide
-- whether the product works: time to first vote, join completion, and time to
-- decision. None of them can be recovered after the fact, so the table that
-- holds them exists before the deployment does (PRD-09 §7A).
--
-- ★ SELF-HOSTED. NO US ANALYTICS SAAS.
--
-- An observability endpoint that is unreachable from Iran does not merely
-- lose data — it can block the request it is attached to, and the demo would
-- fail for a reason that has nothing to do with the product. This table is
-- therefore in the same Postgres the deployment already depends on.
--
-- ★ `event_id` IS NULLABLE, AND THAT IS THE DESIGN.
--
-- The funnel starts before an event exists (`invite_link_opened` fires on a
-- token, which may resolve to nothing) and continues after one is deleted.
-- A NOT NULL constraint here would silently drop the first step of the
-- acquisition funnel. ON DELETE SET NULL keeps the measurement and loses only
-- the join to a row that no longer exists.

-- ─────────────────────────────────────────────────────────────
-- 1. The table
-- ─────────────────────────────────────────────────────────────
create table if not exists analytics_event (
  id          bigserial primary key,
  event_id    uuid references event(id) on delete set null,
  name        text not null,
  props       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- PRD-09 §7A's index: the funnel is read per event and per step, always in
-- reverse chronological order. Without the leading `event_id` a "how long
-- from open to confirm for THIS event" query scans the table.
create index if not exists analytics_event_event_id_name_created_at_idx
  on analytics_event (event_id, name, created_at desc);

-- The metrics that do not name an event (`invite_link_opened` on a dead
-- token) still need a time-ordered read, and the composite index above cannot
-- serve it because `event_id` is null in that position.
create index if not exists analytics_event_name_created_at_idx
  on analytics_event (name, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- 2. Access
-- ─────────────────────────────────────────────────────────────
--
-- ★ RLS ON, NO POLICY, SERVICE ROLE ONLY.
--
-- The table is aggregate telemetry about real people's behaviour. Not one row
-- is needed by a client — the app emits events through the server, and the
-- organizer's screen never reads them. "No policy" is stricter than a policy
-- that denies every row: it also denies every future role that someone adds
-- to a policy by accident.
alter table analytics_event enable row level security;

grant select, insert, update, delete on analytics_event to service_role;

-- The sequence is granted explicitly. A table grant does not imply an
-- `insert` right on its identity sequence, and the failure only appears on
-- the first write — after the deploy has been declared successful.
grant usage, select on sequence analytics_event_id_seq to service_role;

revoke all on analytics_event from public;
revoke all on analytics_event from anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. The redaction backstop
-- ─────────────────────────────────────────────────────────────
--
-- ★ THE EMITTER REDACTES; THE DATABASE REFUSES.
--
-- `server/lib/analytics.ts` is the single writer and runs every payload
-- through `redactObject()` before it reaches the INSERT. That is one layer,
-- and one layer holds only as long as every future writer remembers it. This
-- check is the second: a payload carrying a coordinate-shaped KEY is rejected
-- outright, so a forgotten call site fails loudly at insert time rather than
-- quietly writing a participant's approximate home area into a table that
-- outlives their event.
--
-- ★ KEY SHAPES ONLY — NOT VALUES.
--
-- A value scan would have to guess whether `12.5` is a coordinate, a duration
-- or a confidence score, and a check that refuses legitimate numbers is a
-- check someone removes. The key names are unambiguous, and the emitter
-- already strips values; this catches the writer who bypassed the emitter
-- with a recognisable property name.
create or replace function analytics_event_reject_sensitive_keys()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_key text;
  pattern text;
begin
  for v_key in select jsonb_object_keys(new.props)
  loop
    -- ★ THE PATTERN IS BUILT AND EVALUATED IN TWO STEPS, AND IT MATTERS.
    --
    -- PostgreSQL parses `~` with LOWER precedence than `||`, so
    -- `key ~ 'a' || 'b'` is `(key ~ 'a') || 'b'` — a boolean concatenated with
    -- a string, which evaluates to `'true|b'` and MATCHES EVERYTHING. The
    -- parenthesised form is the only one that builds the pattern first.
    --
    -- Both mistakes have been seen here: a missing `)` made the function raise
    -- on every row, and the unparenthesised concatenation made it match
    -- everything. Either way the funnel stops recording, and `track()` cannot
    -- report why (see the emitter's note on why a failure carries no driver
    -- message) — so this is verified against a live database rather than read.
    -- ★ THE COORDINATE FRAGMENTS ARE ANCHORED ON THE RIGHT, THE REST ANYWHERE.
    --
    -- A plain `lat` substring rejects `platform` — the very first property the
    -- funnel records — and a trigger that refuses a legitimate event is a
    -- funnel that silently records nothing. A coordinate key always ENDS in
    -- its fragment: `lat`, `user_lat`, `userlat`, `participantLat`,
    -- `lat_rounded`. `(lat)` with a trailing word boundary covers all five and
    -- still lets `platform` through. The other fragments carry no such
    -- ambiguity and stay unanchored.
    pattern := '(lat|lng|lon|latitude|longitude)($|[^a-z])'
      || '|coord|geo|accuracy|token|secret|password|passwd|apikey'
      || '|authorization|authheader|bearer|credential|phone|displayname|fullname';

    if lower(v_key) ~ (pattern)
    then
      raise exception
        'analytics_event.props may not carry the key "%" (PRD-08 §15 redaction contract)',
        v_key
        using errcode = 'check_violation';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists analytics_event_reject_sensitive_keys on analytics_event;

create trigger analytics_event_reject_sensitive_keys
  before insert on analytics_event
  for each row
  execute function analytics_event_reject_sensitive_keys();

-- ─────────────────────────────────────────────────────────────
-- 4. Reversal
-- ─────────────────────────────────────────────────────────────
--
--   drop trigger if exists analytics_event_reject_sensitive_keys on analytics_event;
--   drop function if exists analytics_event_reject_sensitive_keys();
--   drop table if exists analytics_event;
