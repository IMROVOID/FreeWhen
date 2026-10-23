-- migrations/018_participant_mute.sql
-- Idempotent and reversible. One concern. Named for what it creates.
--
-- ★ THE MUTE TOGGLE HAD NO PLACE TO STORE ITS ANSWER.
--
-- `MuteToggle` (Plan 10 Task 6) PATCHed
-- `{ preferences: { muted_events: 'mute' | 'unmute', event_id } }` at
-- `/api/participants/me`. `ParticipantPatchSchema` has no `preferences` field
-- and no table had a mute column, so every write was rejected by validation,
-- the component reverted its optimistic flip, and the switch was permanently
-- stuck in one position. Mounting that component without this table would have
-- shipped a control that silently does nothing.
--
-- ★ THE PREFERENCE IS PER PARTICIPANT, NOT PER USER.
--
-- A person is a `participant` per event (migration 003): the same user can have
-- a different name, travel budget and start point in two events. Notification
-- tolerance is the same kind of per-event judgement — someone who wants every
-- ping from a dinner they are organizing may want silence from a party they
-- were merely invited to. Storing it on `auth.users` would force one answer
-- across all of a person's events, and the first event to be muted would silence
-- the rest.
--
-- ★ THIS COLUMN NEVER SILENCES N4.
--
-- It records an intent. The bypass lives in `server/routes/notifications.ts`,
-- where `MUTABLE_TYPES` omits N4, so a muted participant still receives the
-- decision (FR-6.19, AC-6.4.1). Nothing here may be read as an override of that
-- rule: this is a preference, and the gate is the policy.

-- ─────────────────────────────────────────────────────────────
-- 1. The column
-- ─────────────────────────────────────────────────────────────
-- DEFAULT false, so every existing participant keeps receiving notifications.
-- A nullable column would make "never chosen" and "chose unmuted" two distinct
-- states that read the same at every call site, and the first caller to use
-- `coalesce` would decide the difference by accident.
alter table participant
  add column if not exists notifications_muted boolean not null default false;

comment on column participant.notifications_muted is
  'Mutes N1-N3 and N5/N6 for this participant. N4 (decision confirmed) bypasses mute unconditionally (FR-6.19).';

-- ─────────────────────────────────────────────────────────────
-- 2. The write grant
-- ─────────────────────────────────────────────────────────────
-- ★ A COLUMN-LEVEL GRANT, MATCHING MIGRATION 011 §2.
--
-- `grant update (display_name, visibility, modes, ...)` in 011 enumerates
-- exactly the columns a client may change about itself, and `role` is
-- deliberately absent so an RLS row predicate cannot be tricked into a
-- privilege escalation. A new writable column therefore needs its own grant;
-- without it the service-role path works but the direct PostgREST path does
-- not, and the two backends would disagree about what a participant may write.
grant update (notifications_muted) on participant to authenticated;
