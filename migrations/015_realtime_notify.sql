-- migrations/015_realtime_notify.sql
-- Idempotent and reversible. One concern. Named for what it creates.
--
-- ★ THE LOCAL-POSTGRES REALTIME SIGNAL.
--
-- Supabase Realtime is a service this deployment does not always have. On
-- plain PostgreSQL (D22) the same job is done by a bridge: a trigger
-- notifies, and the bridge re-checks authorization per subscriber before
-- pushing anything.
--
-- ★★★ THE PAYLOAD IS A SIGNAL, NOT A ROW ★★★
--
-- The notification carries `{table, id, op, event_id}` and NOTHING ELSE.
-- The bridge then fetches the row AS the subscriber, so the database's RLS
-- policies decide whether that subscriber may see it.
--
-- Two reasons, and the first is fatal if ignored:
--
--  1. SECURITY. A payload that carried the row would be broadcast to
--     whoever is connected, bypassing RLS entirely. The bridge would BE
--     the leak. Fetch-as-subscriber is the security boundary.
--  2. THE 8000-BYTE LIMIT. `pg_notify` truncates its payload at 8000
--     bytes, and a truncated payload is not an error — it is a silent,
--     corrupt one. A `decision` row can exceed the limit. A uuid and a
--     two-letter opcode cannot.
--
-- ★ THE EVENT ID IS READ FROM THE ROW ITSELF.
--
-- Four of the five published tables carry `event_id` on the row, so the
-- event is known without a join. `vote` is the exception: it reaches its
-- event through its proposal, so one lookup is needed — and it is done
-- from the row's own `proposal_id`.
--
-- Reading the event from the row rather than re-querying the table is what
-- makes DELETE work. On a delete the row is already gone, so a resolver
-- that looked the row up by id would find nothing and the notification
-- would carry no event — the change would be undeliverable.
--
-- ★ THE TRIGGERS ARE INSTALLED ON THE FIVE PUBLISHED TABLES ONLY.
--
-- `start_point` (a location leak), `travel_measurement` (a high-churn
-- shared cache) and `activity_log` (the audit trail) are deliberately
-- absent — PRD-09 §3.5. Do not add them.
--
-- ★ THE SAME TRIGGERS RUN ON BOTH BACKENDS.
--
-- On Supabase the notifications are simply not read — Supabase Realtime
-- consumes the publication instead. The schema stays byte-identical across
-- the two backends, which is the property D22 depends on, and a trigger
-- that only existed on one of them would make the schemas differ.
--
-- ★ THE FUNCTIONS ARE NOT `security definer`.
--
-- They read a row the writer could already see and raise a notification.
-- A definer function would be a privilege-escalation surface, and this one
-- needs no elevated privilege: `pg_notify` is available to every role.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The routing context of a changed row
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Returns `{id, event_id}` — the row's key, and the event it belongs to.
--
-- ★ `rsvp` is the exception on the KEY, and it matters.
--
-- Four of the five published tables have an `id uuid primary key`. `rsvp`
-- does not: its primary key IS `participant_id`, because one participant
-- has one RSVP and a second one is a primary-key violation rather than a
-- silent overwrite. A trigger that read `new.id` would notify a NULL for
-- every RSVP change, and the bridge would fetch nothing.
--
-- The function is `stable`, not `immutable`, because the `vote` case reads
-- `public.proposal`.
create or replace function freewhen_change_context(p_table text, p_row jsonb)
returns jsonb
language sql
stable
as $$
  select case p_table
    when 'event' then
      jsonb_build_object('id', p_row->>'id', 'event_id', p_row->>'id')
    when 'proposal' then
      jsonb_build_object('id', p_row->>'id', 'event_id', p_row->>'event_id')
    when 'rsvp' then
      jsonb_build_object('id', p_row->>'participant_id', 'event_id', p_row->>'event_id')
    when 'event_message' then
      jsonb_build_object('id', p_row->>'id', 'event_id', p_row->>'event_id')
    when 'vote' then
      -- ★ THE PARTICIPANT, NOT THE PROPOSAL.
      --
      -- A vote reaches its event through its proposal, and the proposal
      -- lookup is the obvious choice — but it FAILS ON THE CASCADE PATH.
      -- Deleting a proposal cascade-deletes its votes, and by the time
      -- the vote's AFTER-DELETE trigger fires the proposal row is
      -- already gone: the notification carried `event_id: null`, and the
      -- bridge dropped the change. The client never learned its vote was
      -- withdrawn.
      --
      -- The participant row is the reliable path: `participant.event_id`
      -- is ON the row, and a participant outlives a proposal (deleting a
      -- proposal does not delete the people). So the event is read from
      -- the participant, which is still there when the vote's trigger
      -- fires.
      jsonb_build_object(
        'id', p_row->>'id',
        'event_id', (
          select pt.event_id
          from public.participant pt
          where pt.id = (p_row->>'participant_id')::uuid
        )
      )
    else null
  end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The trigger function
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function freewhen_notify_change()
returns trigger
language plpgsql
as $$
declare
  v_context jsonb;
  v_table   text;
begin
  v_table := tg_table_name;

  -- `coalesce(new, old)` is what makes DELETE work: on a delete there is
  -- no NEW row, and on an insert there is no OLD row.
  v_context := freewhen_change_context(v_table, to_jsonb(coalesce(new, old)));

  if v_context is null then
    return coalesce(new, old);
  end if;

  -- The payload is a SIGNAL. The bridge fetches the row as the
  -- subscriber; the row is never in the notification.
  perform pg_notify(
    'freewhen_realtime',
    json_build_object(
      'table', v_table,
      'id', v_context->>'id',
      'op', upper(tg_op),
      'event_id', v_context->>'event_id'
    )::text
  );

  return coalesce(new, old);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The triggers
-- ─────────────────────────────────────────────────────────────────────────────
--
-- AFTER, not BEFORE: the row must already be committed-visible for the
-- bridge's fetch to find it. A BEFORE trigger would notify before the
-- write happened, and the bridge's fetch would find nothing.
--
-- `drop trigger if exists` first, so the migration is re-runnable
-- (AC-9.7.1).
--
-- The trigger fires on UPDATE as well as INSERT, because a vote CHANGED
-- is the case realtime exists for. DELETE is included so a client that
-- polls does not see a row the websocket already reported as gone.
do $$
declare
  t text;
begin
  foreach t in array array['vote','proposal','rsvp','event','event_message'] loop
    -- ★ A MISSING TABLE IS SKIPPED, NOT FATAL.
    --
    -- `drop trigger if exists` on a table that does not exist only
    -- emits a NOTICE, but the `create trigger` that follows would raise
    -- `relation "public.<table>" does not exist` and abort the whole
    -- block — rolling back the migration.
    --
    -- The five tables are created by migrations 002, 006, 007 and 009,
    -- so this only bites on a partially-migrated database. But the
    -- migration's own header claims it is robust, and a trigger that
    -- cannot be installed because its table is absent is a trigger that
    -- should wait rather than abort the run.
    if to_regclass('public.' || quote_ident(t)) is null then
      continue;
    end if;

    execute format('drop trigger if exists freewhen_notify_%s on public.%I', t, t);
    execute format(
      'create trigger freewhen_notify_%s
         after insert or update or delete on public.%I
         for each row execute function freewhen_notify_change()',
      t, t
    );
  end loop;
end
$$;

-- The functions are executable only by the roles that write these tables.
-- They are not `security definer`, so there is no privilege escalation to
-- guard against — but leaving them executable by `public` would let any
-- role call them directly and forge a notification.
revoke all on function freewhen_notify_change() from public;
revoke all on function freewhen_change_context(text, jsonb) from public;

grant execute on function freewhen_notify_change() to authenticated, service_role;
grant execute on function freewhen_change_context(text, jsonb) to authenticated, service_role;
