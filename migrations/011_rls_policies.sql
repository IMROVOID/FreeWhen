-- migrations/011_rls_policies.sql
-- Idempotent and reversible. One concern. Named for what it creates.
--
-- ★ RLS IS ENABLED ON EVERY TABLE, AND THE DEFAULT IS DENY.
-- A table without RLS is readable by anyone holding the publishable key.
-- One omission is a full data exposure.
--
-- Every policy below reduces to one question, answered by
-- `is_event_participant()`: is the caller a participant of this event?

-- ─────────────────────────────────────────────────────────────
-- 1. Enable RLS on every table
-- ─────────────────────────────────────────────────────────────
alter table event            enable row level security;
alter table participant      enable row level security;
alter table start_point      enable row level security;
alter table venue            enable row level security;
alter table proposal         enable row level security;
alter table vote             enable row level security;
alter table decision         enable row level security;
alter table comment          enable row level security;
alter table event_message    enable row level security;
alter table user_group       enable row level security;
alter table message_report   enable row level security;
alter table rsvp             enable row level security;
alter table activity_log     enable row level security;
alter table travel_measurement enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 2. Table privileges
-- ─────────────────────────────────────────────────────────────
-- Table-level grants say WHICH OPERATIONS are possible; RLS says WHICH ROWS.
-- The anon role is granted SELECT on every table so that a non-participant
-- read returns ZERO ROWS (AC-9.3.1) rather than a permission error — the
-- denial must come from the policy, or the test proves nothing.
--
-- ★ `service_role` is granted USAGE on the schema too. Without it the
-- server cannot even name a table in `public`, and the two cleanup jobs
-- would be dead code: "permission denied for schema public" is the whole
-- of their failure, and the failure is silent because nothing calls them.
grant usage on schema public to anon, authenticated, service_role;

grant select on all tables in schema public to anon;
grant usage, select on all sequences in schema public to authenticated;

-- ★ COLUMN-LEVEL GRANTS, NOT TABLE-LEVEL.
--
-- A table-level `grant update on participant` covers EVERY column, including
-- `role` — and an RLS row predicate cannot see column-level intent. That is
-- a privilege-escalation hole: a plain member could run
-- `update participant set role = 'organizer' where auth_user_id = auth.uid()`
-- and then confirm any decision in the event.
--
-- The column list below is the participant's OWN editable profile. `role`,
-- `event_id` and `auth_user_id` are deliberately absent: they are who the
-- participant IS, not what they prefer, and the server owns them.
--
-- The remaining tables have no column-level sensitivity, so they keep the
-- table-level grant. `activity_log` is append-only and has no UPDATE or
-- DELETE policy, so a grant on those operations would be inert.
--
-- ★ `start_point` IS IN THE LIST. It is a table whose rows a client writes
-- for ITSELF, and the row predicate — not the grant — decides whose row it
-- may write.
grant insert, update, delete on
  event, venue, proposal, vote, decision, comment, rsvp, start_point,
  event_message, message_report, travel_measurement
  to authenticated;

grant select on all tables in schema public to authenticated;
grant insert, update, delete on all tables in schema public to service_role;

-- The participant profile a client may change about ITSELF. `role`,
-- `event_id` and `auth_user_id` are not in this list, by design.
grant update (display_name, visibility, modes, has_car, max_travel_minutes, access_needs)
  on participant to authenticated;
grant insert (id, event_id, auth_user_id, display_name, role, is_anonymous, visibility, modes, has_car, max_travel_minutes, access_needs)
  on participant to authenticated;

-- ★ DELETE on `participant` is a table-level grant.
--
-- A column-level DELETE grant is not a thing in PostgreSQL, and leaving an
-- event must remove the whole row (FR-8.22). The ROW is protected by the
-- "leave event" policy below, which only allows a participant to delete
-- their OWN row — so a table-level grant is safe here: the policy, not the
-- grant, decides whose row may go.
grant delete on participant to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. event
-- ─────────────────────────────────────────────────────────────
drop policy if exists "read own events" on event;
create policy "read own events" on event
  for select to authenticated
  using (is_event_participant(id));

drop policy if exists "create own event" on event;
create policy "create own event" on event
  for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists "update own event" on event;
create policy "update own event" on event
  for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- 4. participant
-- ─────────────────────────────────────────────────────────────
-- Participants can read each other.
drop policy if exists "read event participants" on participant;
create policy "read event participants" on participant
  for select to authenticated
  using (is_event_participant(event_id));

-- ★ A participant row may only be created FOR THE CALLER.
--
-- The check on `auth_user_id = auth.uid()` is what stops a member from
-- attributing a DIFFERENT user id to the event with `role = 'organizer'`.
-- Without it, one statement would let an attacker mint an organizer for
-- someone else — and that someone else could then confirm a decision.
--
-- The `role` check is the second half: a member may not create a
-- participant row claiming to be the organizer, not even their own.
--
-- The organizer's OWN row is created by the server when the event is
-- created, so the organizer's join is a server-side insert, not a client
-- one. Phase 5 owns that path.
drop policy if exists "join event" on participant;
create policy "join event" on participant
  for insert to authenticated
  with check (
    is_event_participant(event_id)
    and auth_user_id = auth.uid()
    and role = 'member'
  );

-- A participant updates their own row.
--
-- ★ The row predicate cannot restrict WHICH COLUMNS change; the column
-- grant above does that. This policy only restricts WHICH ROW.
drop policy if exists "update own participant row" on participant;
create policy "update own participant row" on participant
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- ★ A participant may LEAVE an event (FR-8.22).
--
-- Leaving deletes their participant row, their location, their votes and
-- their RSVP. Without this policy the delete is filtered to zero rows and
-- the feature is silently unreachable.
drop policy if exists "leave event" on participant;
create policy "leave event" on participant
  for delete to authenticated
  using (auth_user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- 5. start_point
-- ─────────────────────────────────────────────────────────────
-- Event participants may read each other's approximate area. There is no
-- update/insert policy for OTHER participants — only the owning participant
-- writes their own row.
--
-- ★ `visibility = 'event'` IS ENFORCED HERE (FR-8.18).
--
-- A participant may set their visibility to `private`: their location is
-- used by the engine but is not shown to the other participants. The UI
-- renders "location not shared" for them. If the policy did not check the
-- flag, the "private" setting would be a promise the database does not
-- keep — the raw coordinates would still be readable by every member.
--
-- The engine always uses the real coordinate regardless of visibility
-- (PRD-09 §12): only the DISPLAY is filtered. That is why the row is
-- hidden rather than deleted.
drop policy if exists "read event start points" on start_point;
create policy "read event start points" on start_point
  for select to authenticated
  using (
    exists (
      select 1 from participant p
      where p.id = start_point.participant_id
        and is_event_participant(p.event_id)
        and p.visibility = 'event'
    )
  );

drop policy if exists "write own start point" on start_point;
create policy "write own start point" on start_point
  for insert to authenticated
  with check (
    participant_id in (select id from participant where auth_user_id = auth.uid())
  );

drop policy if exists "update own start point" on start_point;
create policy "update own start point" on start_point
  for update to authenticated
  using (participant_id in (select id from participant where auth_user_id = auth.uid()))
  with check (participant_id in (select id from participant where auth_user_id = auth.uid()));

drop policy if exists "delete own start point" on start_point;
create policy "delete own start point" on start_point
  for delete to authenticated
  using (participant_id in (select id from participant where auth_user_id = auth.uid()));

-- ─────────────────────────────────────────────────────────────
-- 6. venue
-- ─────────────────────────────────────────────────────────────
drop policy if exists "read event venues" on venue;
create policy "read event venues" on venue
  for select to authenticated
  using (is_event_participant(event_id));

drop policy if exists "add event venue" on venue;
create policy "add event venue" on venue
  for insert to authenticated
  with check (is_event_participant(event_id));

-- ─────────────────────────────────────────────────────────────
-- 7. proposal
-- ─────────────────────────────────────────────────────────────
drop policy if exists "read event proposals" on proposal;
create policy "read event proposals" on proposal
  for select to authenticated
  using (is_event_participant(event_id));

drop policy if exists "insert event proposals" on proposal;
create policy "insert event proposals" on proposal
  for insert to authenticated
  with check (
    is_event_participant(event_id)
    and created_by in (select id from participant where auth_user_id = auth.uid())
  );

drop policy if exists "update own or event proposal" on proposal;
create policy "update own or event proposal" on proposal
  for update to authenticated
  using (
    created_by in (select id from participant where auth_user_id = auth.uid())
    or exists (
      select 1 from participant p
      where p.event_id = proposal.event_id
        and p.auth_user_id = auth.uid()
        and p.role = 'organizer'
    )
  );

drop policy if exists "withdraw own or event proposal" on proposal;
create policy "withdraw own or event proposal" on proposal
  for delete to authenticated
  using (
    created_by in (select id from participant where auth_user_id = auth.uid())
    or exists (
      select 1 from participant p
      where p.event_id = proposal.event_id
        and p.auth_user_id = auth.uid()
        and p.role = 'organizer'
    )
  );

-- ─────────────────────────────────────────────────────────────
-- 8. vote ★
-- ─────────────────────────────────────────────────────────────
-- Read: any participant of the event that owns the proposal.
drop policy if exists "participants read votes" on vote;
create policy "participants read votes" on vote
  for select to authenticated
  using (
    exists (
      select 1 from proposal p
      where p.id = vote.proposal_id and is_event_participant(p.event_id)
    )
  );

-- Write: only in your own name, and only on a proposal in your own event.
drop policy if exists "vote as self" on vote;
create policy "vote as self" on vote
  for insert to authenticated
  with check (
    participant_id in (select id from participant where auth_user_id = auth.uid())
    and exists (
      select 1
      from participant p
      join proposal pr on pr.event_id = p.event_id
      where p.id = vote.participant_id
        and pr.id = vote.proposal_id
    )
  );

drop policy if exists "update own vote" on vote;
create policy "update own vote" on vote
  for update to authenticated
  using (participant_id in (select id from participant where auth_user_id = auth.uid()))
  with check (participant_id in (select id from participant where auth_user_id = auth.uid()));

drop policy if exists "delete own vote" on vote;
create policy "delete own vote" on vote
  for delete to authenticated
  using (participant_id in (select id from participant where auth_user_id = auth.uid()));

-- ─────────────────────────────────────────────────────────────
-- 9. decision ★
-- ─────────────────────────────────────────────────────────────
drop policy if exists "read event decisions" on decision;
create policy "read event decisions" on decision
  for select to authenticated
  using (is_event_participant(event_id));

-- ★ PERMISSIVE: only the ORGANIZER may confirm a decision.
--
-- GOTCHA: a restrictive policy alone fails unless another policy returns
-- true, so the organizer-confirm path needs a permissive policy AND the
-- restrictive anti-anonymous policy below. AC-9.4.1 exists because this
-- fails silently.
drop policy if exists "organizer confirms decision" on decision;
create policy "organizer confirms decision" on decision
  for insert to authenticated
  with check (
    exists (
      select 1 from participant p
      where p.event_id = decision.event_id
        and p.auth_user_id = auth.uid()
        and p.role = 'organizer'
    )
  );

-- ★ RESTRICTIVE: an anonymous guest may not perform a privileged write.
--
-- DEVIATION FROM PRD-08 FR-8.36, and the reasoning is recorded here because
-- it is a security decision, not a convenience:
--
-- FR-8.36's literal SQL is `with check ((select (auth.jwt()->>'is_anonymous')::boolean) is false)`.
-- Applied literally it BREAKS THE PRODUCT. The MVP organizer has no account
-- (PRD-01 FR-1.2, AS1.1 "Creating an event requires no account"), so the
-- organizer is an anonymous user and could never confirm anything — MVP step
-- 10 would be unreachable.
--
-- What FR-8.36 is FOR is "guests cannot perform privileged writes" (FR-8.36's
-- own words). The privilege is the organizer role, not the absence of an
-- account. So the restriction is scoped to the case it is about: a guest who
-- is NOT the organizer. An anonymous organizer still holds the only role that
-- may confirm.
--
-- The pair of policies therefore ANDs to exactly one outcome: the organizer
-- of that event, and nobody else — anonymous or not.
--
-- `auth.is_anonymous()` is used rather than `auth.jwt()` so the policy does
-- not know which backend it runs on (PRD-09 §4.0). It is provided by
-- migration 000, which is a no-op on Supabase and creates the shim on plain
-- Postgres.
drop policy if exists "confirmed decision writes are not by anonymous guests" on decision;
create policy "confirmed decision writes are not by anonymous guests" on decision
  as restrictive for insert to authenticated
  with check (
    auth.is_anonymous() is not true
    or exists (
      select 1 from participant p
      where p.event_id = decision.event_id
        and p.auth_user_id = auth.uid()
        and p.role = 'organizer'
    )
  );

-- Reopening (PRD-02 FR-2.22) is an organizer write on an existing decision.
drop policy if exists "organizer updates decision" on decision;
create policy "organizer updates decision" on decision
  for update to authenticated
  using (
    exists (
      select 1 from participant p
      where p.event_id = decision.event_id
        and p.auth_user_id = auth.uid()
        and p.role = 'organizer'
    )
  );

-- ─────────────────────────────────────────────────────────────
-- 10. comment
-- ─────────────────────────────────────────────────────────────
drop policy if exists "read event comments" on comment;
create policy "read event comments" on comment
  for select to authenticated
  using (
    exists (
      select 1 from proposal p
      where p.id = comment.proposal_id and is_event_participant(p.event_id)
    )
  );

drop policy if exists "insert event comment" on comment;
create policy "insert event comment" on comment
  for insert to authenticated
  with check (
    participant_id in (select id from participant where auth_user_id = auth.uid())
    and exists (
      select 1 from proposal p
      where p.id = comment.proposal_id and is_event_participant(p.event_id)
    )
  );

-- ─────────────────────────────────────────────────────────────
-- 11. rsvp
-- ─────────────────────────────────────────────────────────────
drop policy if exists "read event rsvps" on rsvp;
create policy "read event rsvps" on rsvp
  for select to authenticated
  using (is_event_participant(event_id));

drop policy if exists "set own rsvp" on rsvp;
create policy "set own rsvp" on rsvp
  for insert to authenticated
  with check (
    participant_id in (select id from participant where auth_user_id = auth.uid())
    and exists (
      select 1 from participant p
      where p.id = rsvp.participant_id and p.event_id = rsvp.event_id
    )
  );

drop policy if exists "update own rsvp" on rsvp;
create policy "update own rsvp" on rsvp
  for update to authenticated
  using (participant_id in (select id from participant where auth_user_id = auth.uid()))
  with check (participant_id in (select id from participant where auth_user_id = auth.uid()));

drop policy if exists "delete own rsvp" on rsvp;
create policy "delete own rsvp" on rsvp
  for delete to authenticated
  using (participant_id in (select id from participant where auth_user_id = auth.uid()));

-- ─────────────────────────────────────────────────────────────
-- 12. event_message — In-Room Chat
-- ─────────────────────────────────────────────────────────────
drop policy if exists "read event messages" on event_message;
create policy "read event messages" on event_message
  for select to authenticated
  using (is_event_participant(event_id));

drop policy if exists "insert event message" on event_message;
create policy "insert event message" on event_message
  for insert to authenticated
  with check (
    is_event_participant(event_id)
    and participant_id in (select id from participant where auth_user_id = auth.uid())
  );

-- The author can delete their own message; the organizer can delete any
-- message in the event.
drop policy if exists "delete event message" on event_message;
create policy "delete event message" on event_message
  for delete to authenticated
  using (
    participant_id in (select id from participant where auth_user_id = auth.uid())
    or exists (
      select 1 from participant p
      where p.event_id = event_message.event_id
        and p.auth_user_id = auth.uid()
        and p.role = 'organizer'
    )
  );

-- ─────────────────────────────────────────────────────────────
-- 13. user_group — saved frequent circles
-- ─────────────────────────────────────────────────────────────
drop policy if exists "owner manages user_groups" on user_group;
create policy "owner manages user_groups" on user_group
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- 14. message_report
-- ─────────────────────────────────────────────────────────────
drop policy if exists "read event message reports" on message_report;
create policy "read event message reports" on message_report
  for select to authenticated
  using (
    exists (
      select 1 from event_message m
      where m.id = message_report.message_id and is_event_participant(m.event_id)
    )
  );

drop policy if exists "insert message report" on message_report;
create policy "insert message report" on message_report
  for insert to authenticated
  with check (
    reporter_id in (select id from participant where auth_user_id = auth.uid())
  );

-- ─────────────────────────────────────────────────────────────
-- 15. activity_log — READ ONLY
-- ─────────────────────────────────────────────────────────────
-- ★ APPEND-ONLY. There is deliberately NO update policy and NO delete
-- policy: the audit trail's value depends on it being immutable (FR-8.41).
-- Writes come from the server, which holds the service role.
drop policy if exists "read activity" on activity_log;
create policy "read activity" on activity_log
  for select to authenticated
  using (is_event_participant(event_id));

-- ─────────────────────────────────────────────────────────────
-- 16. travel_measurement — the shared cache
-- ─────────────────────────────────────────────────────────────
-- ★ NO CLIENT-READABLE POLICY, DELIBERATELY.
--
-- The cache is keyed by geography rather than by user, which is why it can
-- be shared across events (PRD-09 AS9.2). But its ORIGIN is a participant's
-- snapped start point — that is, an approximate home area — and its
-- destination is where that person travels. Reading the cache therefore
-- reveals, for every event on the system, who lives where and where they
-- go.
--
-- A `using (true)` policy would hand that to every authenticated caller
-- across every event, which is exactly the cross-event visibility FR-8.15
-- forbids ("Location is visible only to participants of that event. No
-- cross-event, public, or aggregate visibility exists").
--
-- The client does not need it: ranking is server-side (PRD-09 §5 —
-- "Everything that touches a provider, a secret, or the scoring engine goes
-- through the server"), and the cache is written by the routing adapter
-- through the service role. So the cache is read by the SERVER and by
-- nobody else.
--
-- RLS with no policy is a deny, which is the correct default here.
drop policy if exists "read travel cache" on travel_measurement;
