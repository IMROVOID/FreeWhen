-- migrations/003_participant.sql
-- Idempotent and reversible. One concern. Named for what it creates.

create table if not exists participant (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references event(id) on delete cascade,
  auth_user_id  uuid references auth.users(id) on delete set null,
  display_name  text not null check (char_length(display_name) between 1 and 30),
  role          text not null default 'member' check (role in ('organizer','member')),
  is_anonymous  boolean not null default true,
  visibility    text not null default 'event' check (visibility in ('private','event')),
  modes         text[] not null default '{}',
  has_car       boolean not null default false,
  max_travel_minutes integer not null default 60 check (max_travel_minutes between 5 and 240),
  access_needs  jsonb not null default '{}'::jsonb,
  joined_at     timestamptz not null default now(),
  -- ★ Duplicate-join detection (FR-1.20) is a database guarantee, not an
  -- application check. A NULL auth_user_id is allowed and does not collide,
  -- which is correct — it is the pre-join state.
  unique (event_id, auth_user_id),
  -- modes[] is a subset of the canonical transport set (PRD-09 §5.3).
  constraint modes_known check (modes <@ array['car','transit','walk','cycle','taxi'])
);

create index if not exists participant_event_id_idx      on participant (event_id);
create index if not exists participant_auth_user_id_idx  on participant (auth_user_id);

-- ★ THE PARTICIPANT CAP, ENFORCED BY THE DATABASE (FR-8.38, PRD-01 E1).
--
-- The cap of 10 bounds write abuse, so it has to be a database guarantee
-- rather than a check the server performs. The `redeem_invite` RPC checks
-- it too, but a count inside a function is a read-then-write: two
-- concurrent joins can both read 9 and both insert.
--
-- A BEFORE INSERT trigger closes the race the same way `for update` closes
-- it in the RPC: the row lock is taken before the count is read.
--
-- The trigger RAISES, so the insert is rejected outright rather than
-- silently accepted. A member who is over the cap gets the same
-- EVENT_FULL the server would have returned.
create or replace function enforce_participant_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  -- The event row is locked first, so a concurrent join for the same event
  -- serialises here rather than racing the count.
  perform 1 from public.event where id = new.event_id for update;

  select count(*) into v_count
  from public.participant
  where event_id = new.event_id;

  if v_count >= 10 then
    raise exception 'EVENT_FULL' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists participant_cap_trigger on participant;
create trigger participant_cap_trigger
  before insert on participant
  for each row
  execute function enforce_participant_cap();

revoke all on function enforce_participant_cap() from public;
grant execute on function enforce_participant_cap() to authenticated;

-- ★ The membership predicate. Every access rule in the schema reduces to this
-- one question: is the caller a participant of this event?
--
-- GOTCHA: `security definer` bypasses RLS, so this function must stay
-- minimal and correct. A definer function with a join bug is a
-- privilege-escalation vector. It touches exactly one table, one predicate.
--
-- GOTCHA: `set search_path` is mandatory on a definer function. Without it,
-- a caller can shadow `participant` with a temp table.
--
-- ★ `pg_temp` IS LISTED EXPLICITLY, AND THE TABLE IS SCHEMA-QUALIFIED.
--
-- `set search_path = public` alone is NOT enough. `pg_temp` is searched
-- BEFORE `public` for unqualified names, and both `anon` and
-- `authenticated` hold TEMP privilege on the database. A caller could
-- therefore create a temp table named `participant`, and this function —
-- whose body is re-parsed on every call, unlike a policy expression which
-- is bound at CREATE time — would read the CALLER'S table instead of the
-- real one. The same shadowing would apply to `redeem_invite`, whose
-- `event` table could be forged.
--
-- Listing `pg_temp` LAST puts the real schema ahead of the temporary one,
-- and `public.participant` is qualified as well, so neither the
-- search_path nor the qualification can be subverted.
create or replace function is_event_participant(p_event_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.participant
    where event_id = p_event_id
      and auth_user_id = auth.uid()
  );
$$;

-- The function is called from RLS policies on every table. It is not
-- SECURITY DEFINER for a reason, but it is not a public API either: the
-- server exposes no endpoint that calls it directly.
revoke all on function is_event_participant(uuid) from public;
grant execute on function is_event_participant(uuid) to anon, authenticated;
