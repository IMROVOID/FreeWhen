-- server/sql/cast_vote.rpc.sql
-- Cast or change one vote, atomically (Plan 40 T7).
--
-- ★ WHY THIS EXISTS.
--
-- `castVote` (`server/lib/vote-service.ts:160-250`) runs five statements inside
-- one transaction: read the proposal, resolve the voter, read the previous
-- value, upsert the vote, append an activity row. PostgREST executes one HTTP
-- request as ONE transaction and offers no begin/commit across requests
-- (postgrest.org/…/transactions), so there is no way to replay that sequence
-- over REST without it becoming non-atomic.
--
-- The upsert is the reason atomicity matters here. `insert ... on conflict do
-- update` is safe on its own, but the ACTIVITY ROW it decides to write depends
-- on the value read two statements earlier. Splitting them across requests
-- means a vote can be committed while its history row is lost — and the history
-- is what the decision screen renders as "who answered".
--
-- ★ IDENTITY COMES FROM `auth.uid()`, NEVER FROM A PARAMETER.
--
-- `server/sql/join_event.sql:32-42` documents why at length: a caller-supplied
-- user id plus `security definer` plus an executable grant is an impersonation
-- oracle. The same rule applies to every RPC in this directory, without
-- exception. There is no `p_user_id` argument anywhere below.
--
-- ★ `pg_temp` FIRST-PARTY, `public` QUALIFIED.
--
-- The body is re-parsed on every call, so an unqualified name could resolve to
-- a caller-created temp table. `pg_temp` last puts the real schema first.
-- `extensions` is in the path because Supabase ships pgcrypto there.

create or replace function cast_vote(
  p_event_id     uuid,
  p_proposal_id  uuid,
  p_choice       text,
  p_dealbreaker  boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_caller     uuid := auth.uid();
  v_voter      public.participant;
  v_previous   text;
  v_written    public.vote;
  v_is_change  boolean;
begin
  -- No session, no vote. `auth.uid()` is NULL when the caller's JWT did not
  -- reach PostgREST (see the callerJwt note in server/lib/supabase-rest.ts).
  if v_caller is null then
    return jsonb_build_object('error', 'NOT_PARTICIPANT');
  end if;

  -- ★ THE VOTER IS RESOLVED FROM THE CLAIMS, NOT FROM THE REQUEST.
  --
  -- A non-participant gets the same answer as a caller who is not the
  -- event's member: NOT_PARTICIPANT. That is deliberate — distinguishing
  -- "you are not in this event" from "this event does not exist" would let a
  -- stranger probe which event ids are real.
  select * into v_voter
  from public.participant
  where event_id = p_event_id
    and auth_user_id = v_caller;

  if v_voter.id is null then
    return jsonb_build_object('error', 'NOT_PARTICIPANT');
  end if;

  -- The proposal must belong to this event AND still be open. Checked here as
  -- well as by RLS because the function runs with the definer's rights, so the
  -- policy alone is not a gate.
  if not exists (
    select 1
    from public.proposal pr
    join public.event e on e.id = pr.event_id
    where pr.id = p_proposal_id
      and pr.event_id = p_event_id
      and pr.status = 'OPEN'
      and e.status in ('DRAFT', 'OPEN', 'VOTING')
  ) then
    return jsonb_build_object('error', 'VALIDATION_FAILED');
  end if;

  select value into v_previous
  from public.vote
  where proposal_id = p_proposal_id
    and participant_id = v_voter.id;

  insert into public.vote (proposal_id, participant_id, value, is_dealbreaker)
  values (p_proposal_id, v_voter.id, p_choice, p_dealbreaker)
  on conflict (proposal_id, participant_id)
  do update set value          = excluded.value,
                is_dealbreaker = excluded.is_dealbreaker,
                updated_at     = now()
  returning * into v_written;

  v_is_change := v_previous is not null and v_previous <> p_choice;

  -- ★ THE LOG RECORDS A CHANGE, NOT A REPEAT.
  --
  -- Same rule as the TypeScript path (`server/lib/vote-service.ts:210-215`):
  -- re-tapping the selected value is invisible in history, but the FIRST vote
  -- is always logged because "who has answered" is the fact that matters.
  if v_previous is null then
    insert into public.activity (event_id, actor_id, action, subject_type, subject_id, detail)
    values (p_event_id, v_voter.id, 'vote_cast', 'proposal', p_proposal_id,
            jsonb_build_object('to', p_choice));
  elsif v_is_change then
    insert into public.activity (event_id, actor_id, action, subject_type, subject_id, detail)
    values (p_event_id, v_voter.id, 'vote_changed', 'proposal', p_proposal_id,
            jsonb_build_object('from', v_previous, 'to', p_choice));
  end if;

  return jsonb_build_object(
    'error', null,
    'vote', jsonb_build_object(
      'proposal_id', v_written.proposal_id,
      'participant_id', v_written.participant_id,
      'display_name', v_voter.display_name,
      'value', v_written.value,
      'is_dealbreaker', v_written.is_dealbreaker,
      'created_at', v_written.created_at,
      'updated_at', v_written.updated_at
    ),
    'is_change', (v_previous is not null),
    'changed_value', v_is_change
  );
end;
$$;

-- ★ EXECUTE IS GRANTED TO `service_role` ONLY.
--
-- The same reasoning as `join_event` (`server/sql/join_event.sql:55-64`): the
-- route is the only caller, and it applies validation the function does not
-- repeat. Granting `authenticated` would expose a write path that bypasses the
-- route entirely, with `security definer` rights.
revoke all on function cast_vote(uuid, uuid, text, boolean) from public;
grant execute on function cast_vote(uuid, uuid, text, boolean) to service_role;
