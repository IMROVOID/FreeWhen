-- server/sql/reopen_event.rpc.sql
-- Reopen the event's live decisions, atomically (Plan 40 T7).
--
-- ★ WHY THIS EXISTS.
--
-- `reopenEvent` (`server/lib/reopen-service.ts:84-160`) locks the event row,
-- checks the caller is the organizer, reads the live decisions, marks them
-- reopened with the reason, resets the chosen proposals and inserts activity.
-- PostgREST cannot replay that as separate requests (one request = one
-- transaction), so it is one RPC.
--
-- ★ THE LOCK IS LOAD-BEARING, AND IT IS WHY A SEQUENTIAL REPLAY IS WRONG.
--
-- Two organizers tapping reopen at the same moment must not both find a live
-- decision and both insert activity rows. `for update` on the event row
-- serialises them, so the second call sees `reopened_at` already set and answers
-- NO_LIVE_DECISION instead of duplicating the work. Firing the same statements
-- as separate round trips gives each of them its own transaction, so the lock is
-- released between the read and the write — reopening exactly the race the lock
-- was added to close.
--
-- ★ IDENTITY COMES FROM `auth.uid()`, NEVER FROM A PARAMETER.
-- See `server/sql/join_event.sql:32-42`.

create or replace function reopen_event(
  p_event_id  uuid,
  p_reason    text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_caller      uuid := auth.uid();
  v_event       public.event;
  v_me          public.participant;
  v_reason      text;
  v_live_ids    uuid[];
  v_reopened    int;
begin
  if v_caller is null then
    return jsonb_build_object('error', 'NOT_PARTICIPANT');
  end if;

  -- Normalised the same way `normaliseReason` does it, so an all-whitespace
  -- reason is EMPTY_REASON rather than a decision row with a blank justification.
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    return jsonb_build_object('error', 'VALIDATION_FAILED');
  end if;

  -- The lock that serialises two simultaneous reopens.
  select * into v_event
  from public.event
  where id = p_event_id
  for update;

  if v_event.id is null then
    return jsonb_build_object('error', 'NOT_PARTICIPANT');
  end if;

  select * into v_me
  from public.participant
  where event_id = p_event_id
    and auth_user_id = v_caller;

  if v_me.id is null then
    return jsonb_build_object('error', 'NOT_PARTICIPANT');
  end if;

  -- Only the organizer may restart the vote, enforced here as well as in the
  -- route: a function that trusted only its caller would be one refactor away
  -- from letting a participant reopen a decision they lost.
  if v_me.role <> 'organizer' or v_event.created_by <> v_caller then
    return jsonb_build_object('error', 'NOT_ORGANIZER');
  end if;

  select array_agg(id) into v_live_ids
  from public.decision
  where event_id = p_event_id
    and reopened_at is null;

  if v_live_ids is null or array_length(v_live_ids, 1) = 0 then
    return jsonb_build_object('error', 'VALIDATION_FAILED', 'reason', 'NO_LIVE_DECISION');
  end if;

  -- Both columns in one statement, so a decision can never be marked reopened
  -- without the reason that justifies it.
  update public.decision
     set reopened_at = now(),
         reopen_reason = v_reason
   where event_id = p_event_id
     and reopened_at is null;
  get diagnostics v_reopened = row_count;

  -- A reopened proposal goes back to REOPENED so it is votable again; CHOSEN
  -- would leave it unelectable, and OPEN would lose the fact that it was
  -- decided once and reopened.
  update public.proposal
     set status = 'REOPENED'
   where event_id = p_event_id
     and status = 'CHOSEN';

  insert into public.activity (event_id, actor_id, action, subject_type, subject_id, detail)
  values (p_event_id, v_me.id, 'reopened', 'event', p_event_id,
          jsonb_build_object('reason', v_reason, 'decisions', v_reopened));

  return jsonb_build_object(
    'error', null,
    'reopened', v_reopened,
    'reason', v_reason
  );
end;
$$;

revoke all on function reopen_event(uuid, text) from public;
grant execute on function reopen_event(uuid, text) to service_role;
