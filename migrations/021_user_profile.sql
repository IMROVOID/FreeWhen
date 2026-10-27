-- migrations/021_user_profile.sql
-- Idempotent and reversible. One concern. Named for what it creates.
--
-- ★ THE NICKNAME HAD NOWHERE TO LIVE.
--
-- Names are per-event today: `participant.display_name` (migration 003) is
-- created at join time and is already serialised by twelve routes — proposals,
-- votes, decision-status, activity, messages, comments, rsvp, rank-travel, nudge.
-- That is correct for what it is (a person may want one name at a work dinner and
-- another at a party), but it left the app with no answer to "who are you?" before
-- the first event. A user who joined three events had typed three names and had no
-- identity the app could show, colour, or offer to reuse.
--
-- ★ THIS TABLE DOES NOT REPLACE `participant.display_name`.
--
-- It SEEDS it. Migration 026 of the plan's task list changes the join path to copy
-- this nickname into `participant.display_name` when the participant has not chosen
-- a per-event name. The reasons for keeping both:
--
--  1. `event_message.sender_name` and `activity_log.actor_name` are deliberate
--     SNAPSHOTS (`server/routes/messages.ts` documents it: "a person who renames
--     themselves should not silently rewrite what the thread says"). If this
--     table were the source of truth, a rename would retroactively alter history
--     that the product promises not to alter.
--  2. `display_name` already has a column-level grant, an RLS predicate, a 1-30
--     check constraint and collision disambiguation in `join_event.sql`. Reusing
--     it means no serialisation change in any of the twelve routes.
--
-- ★ THERE IS NO COLOUR COLUMN, AND THAT IS DELIBERATE.
--
-- The colour is derived from the nickname by a pure function in the client
-- (`src/features/profile/services/nickname-color.ts`). A stored colour would need
-- a second write path, could disagree between two devices reading an older row,
-- and would have to be re-written on every rename. A hash cannot drift.
--
-- ★ THE NAME IS NOT UNIQUE, AND MUST NOT BE.
--
-- Two people called "Sara" in different events are normal. Uniqueness here would
-- force a stranger to invent a name because someone they will never meet took
-- theirs. The per-event collision suffix ` (2)`, ` (3)` in `join_event.sql:156-175`
-- already disambiguates within the one scope where it matters.

-- ─────────────────────────────────────────────────────────────
-- 1. The table
-- ─────────────────────────────────────────────────────────────
-- Keyed on `auth.users.id` rather than a new surrogate id: this IS the person, and
-- a second identity table would need reconciling with the first on every delete.
--
-- `on delete cascade`, unlike `participant.auth_user_id`'s `on delete set null`:
-- a participant row records that someone took part in an event and must survive
-- an account deletion (the event belongs to everyone), but a nickname is purely
-- this person's own and has no meaning once they are gone.
create table if not exists user_profile (
  auth_user_id      uuid primary key references auth.users(id) on delete cascade,
  nickname          text not null check (char_length(nickname) between 1 and 30),
  nickname_chosen_at timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- ★ A NAME OF ONLY WHITESPACE IS NOT A NAME.
  --
  -- `char_length` alone accepts '   ', which would render as an empty gap on every
  -- proposal card and be impossible to tell from a rendering bug. The check is in
  -- the database as well as the route so both backends agree.
  constraint nickname_not_blank check (btrim(nickname) <> '')
);

comment on table user_profile is
  'The caller''s global nickname. Seeds participant.display_name at join time; does not replace it.';
comment on column user_profile.nickname is
  '1-30 characters, not blank. Not unique by design — collisions are disambiguated per event.';

-- ─────────────────────────────────────────────────────────────
-- 2. Retention
-- ─────────────────────────────────────────────────────────────
-- Migration 014's anonymous cleanup deletes `auth.users` rows with no activity.
-- The cascade above is what removes the profile with them; no new job is needed.
-- This comment exists so the next reader does not add one: a second sweeper racing
-- the first would delete the same row twice and log a failure.
comment on constraint user_profile_auth_user_id_fkey on user_profile is
  'Cascades from auth.users. Migration 014''s anon-cleanup deletes the user, which deletes this row.';

-- ─────────────────────────────────────────────────────────────
-- 3. RLS and grants, matching migration 011's shape
-- ─────────────────────────────────────────────────────────────
alter table user_profile enable row level security;

-- ★ A PROFILE IS READABLE BY NOBODY BUT ITS OWNER.
--
-- This is narrower than every other table in the schema, deliberately. A nickname
-- reaches other participants through `participant.display_name` inside an event,
-- which is already scoped by `is_event_participant`. Reading this table directly
-- would let a caller with any valid token enumerate nicknames of people they share
-- no event with — a directory the product does not promise to have.
drop policy if exists "read own profile" on user_profile;
create policy "read own profile" on user_profile
  for select to authenticated
  using (auth_user_id = auth.uid());

drop policy if exists "create own profile" on user_profile;
create policy "create own profile" on user_profile
  for insert to authenticated
  with check (auth_user_id = auth.uid());

drop policy if exists "update own profile" on user_profile;
create policy "update own profile" on user_profile
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- No DELETE policy: a profile goes away with its user, through the cascade. Allowing
-- a direct delete would create a second way to erase an identity, and the account
-- deletion path is the one that also clears the participant rows.

-- ★ COLUMN-LEVEL, LIKE MIGRATION 011.
--
-- `auth_user_id` is absent from the UPDATE grant so the ownership predicate cannot
-- be rewritten to claim another person's row. The service-role path is unaffected
-- (the API writes through it), which is why 018's precedent applies here too.
grant update (nickname, updated_at) on user_profile to authenticated;
grant insert (auth_user_id, nickname) on user_profile to authenticated;
