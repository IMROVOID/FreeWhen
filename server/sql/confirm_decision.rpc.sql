-- server/sql/confirm_decision.rpc.sql
-- Confirm one decision axis, atomically (Plan 40 T7).
--
-- ★ WHY THIS EXISTS.
--
-- `confirmDecision` (`server/lib/vote-service.ts:571-759`) locks the event row,
-- checks the organizer, looks for an existing live decision, computes the
-- outstanding voters, picks the winner, inserts the decision, marks the chosen
-- proposal CHOSEN, conditionally transitions the event to CONFIRMED and appends
-- activity. PostgREST cannot replay that as separate requests.
--
-- ★ THE LOCK AND THE PARTIAL UNIQUE INDEX ARE BOTH NEEDED.
--
-- `for update` on the event row makes two simultaneous confirms wait rather than
-- both find no live decision and both insert. The partial unique index is the
-- real guarantee; the lock is what turns a lost race into a wait instead of a
-- 23505 the organizer would see as a failure. A sequential replay loses the
-- lock's reach, so the second confirm gets the unique violation the lock exists
-- to prevent.
--
-- ★ THE EVENT IS CONFIRMED ONLY WHEN EVERY AXIS IS DECIDED.
--
-- Confirming the time must not declare the place decided. The check is against
-- `decision`, not against open proposals: setting the chosen proposal to CHOSEN
-- would otherwise make "no open proposals" true immediately and confirm the
-- event on the first of its two axes.
--
-- ★ IDENTITY COMES FROM `auth.uid()`, NEVER FROM A PARAMETER.
-- See `server/sql/join_event.sql:32-42`.

create or replace function confirm_decision(
  p_event_id      uuid,
  p_axis          text,
  p_proposal_id   uuid default null,
  p_lens          text default 'balanced',
  p_reason        jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_caller        uuid := auth.uid();
  v_event         public.event;
  v_me            public.participant;
  v_existing      public.decision;
  v_chosen        uuid;
  v_decision      public.decision;
  v_outstanding   text[];
  v_votes_total   int;
  v_template      text;
  v_params        jsonb;
begin
  if v_caller is null then
    return jsonb_build_object('error', 'NOT_PARTICIPANT');
  end if;

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

  if v_me.role <> 'organizer' or v_event.created_by <> v_caller then
    return jsonb_build_object('error', 'NOT_ORGANIZER');
  end if;

  -- ★ THE ALREADY-CONFIRMED SHORT CIRCUIT.
  --
  -- A second Confirm tap must return the existing decision rather than a
  -- conflict, so the screen can say "already confirmed" with the same numbers.
  select * into v_existing
  from public.decision
  where event_id = p_event_id
    and axis = p_axis
    and reopened_at is null
  limit 1;

  if v_existing.id is not null then
    select array_agg(p.display_name) into v_outstanding
    from public.participant p
    where p.event_id = p_event_id
      and not exists (
        select 1 from public.vote v
        where v.proposal_id = v_existing.proposal_id
          and v.participant_id = p.id
      );

    select count(*) into v_votes_total
    from public.vote v
    where v.proposal_id = v_existing.proposal_id;

    return jsonb_build_object(
      'error', null,
      'already_existed', true,
      'decision', jsonb_build_object(
        'id', v_existing.id,
        'event_id', v_existing.event_id,
        'axis', v_existing.axis,
        'proposal_id', v_existing.proposal_id,
        'lens', v_existing.lens,
        'reason_template', v_existing.reason_template,
        'reason_params', v_existing.reason_params,
        'confirmed_by', v_existing.confirmed_by,
        'confirmed_at', v_existing.confirmed_at
      ),
      'outstanding', coalesce(to_jsonb(v_outstanding), '[]'::jsonb),
      'votes_total', v_votes_total
    );
  end if;

  -- ★ THE ORGANIZER'S CHOICE WINS; ITS ABSENCE MEANS THE LEADER.
  --
  -- Without an explicit pick the confirmation must choose the same winner every
  -- participant sees from the ranking, which is the engine's first place with
  -- its creation-order tiebreak (AC-2.4.1). The tiebreak is spelled out here
  -- rather than delegated to the TypeScript engine because this function is the
  -- only decision-maker on the REST transport.
  if p_proposal_id is not null then
    if not exists (
      select 1 from public.proposal
      where id = p_proposal_id
        and event_id = p_event_id
        and status in ('OPEN', 'REOPENED')
    ) then
      return jsonb_build_object('error', 'VALIDATION_FAILED', 'reason', 'NO_PROPOSAL');
    end if;
    v_chosen := p_proposal_id;
  else
    select pr.id into v_chosen
    from public.proposal pr
    where pr.event_id = p_event_id
      and pr.status in ('OPEN', 'REOPENED')
    order by
      (select count(*) from public.vote v where v.proposal_id = pr.id and v.value = 'YES') desc,
      (select count(*) from public.vote v where v.proposal_id = pr.id and v.value = 'MAYBE') desc,
      (select count(*) from public.vote v where v.proposal_id = pr.id and v.value = 'NO') asc,
      pr.created_at asc,
      pr.id asc
    limit 1;

    if v_chosen is null then
      return jsonb_build_object('error', 'VALIDATION_FAILED', 'reason', 'NO_PROPOSAL');
    end if;
  end if;

  v_template := coalesce(p_reason->>'templateId', 'decision.confirmed');
  v_params   := coalesce(p_reason->'params', '{}'::jsonb);

  insert into public.decision (
    event_id, axis, proposal_id, lens, reason_template, reason_params, confirmed_by
  ) values (
    p_event_id, p_axis, v_chosen, coalesce(p_lens, 'balanced'), v_template, v_params, v_me.id
  )
  returning * into v_decision;

  update public.proposal
     set status = 'CHOSEN'
   where id = v_chosen;

  -- ★ CONFIRMED ONLY WHEN EVERY AXIS WITH A PROPOSAL IS DECIDED.
  --
  -- The inner `not exists` is the whole point: an axis whose proposal is still
  -- open and has no live decision blocks the transition.
  update public.event e
     set status = 'CONFIRMED',
         updated_at = now()
   where e.id = p_event_id
     and e.status <> 'CONFIRMED'
     and not exists (
       select 1
       from public.proposal pr
       where pr.event_id = e.id
         and pr.status in ('OPEN', 'REOPENED')
         and not exists (
           select 1 from public.decision d
           where d.event_id = e.id
             and d.proposal_id = pr.id
             and d.reopened_at is null
         )
     );

  select array_agg(p.display_name) into v_outstanding
  from public.participant p
  where p.event_id = p_event_id
    and not exists (
      select 1 from public.vote v
      where v.proposal_id = v_chosen
        and v.participant_id = p.id
    );

  select count(*) into v_votes_total
  from public.vote v
  where v.proposal_id = v_chosen;

  insert into public.activity (event_id, actor_id, action, subject_type, subject_id, detail)
  values (p_event_id, v_me.id, 'confirmed', 'proposal', v_chosen,
          jsonb_build_object(
            'axis', p_axis,
            'votes_total', v_votes_total,
            'outstanding', coalesce(to_jsonb(v_outstanding), '[]'::jsonb)
          ));

  return jsonb_build_object(
    'error', null,
    'already_existed', false,
    'decision', jsonb_build_object(
      'id', v_decision.id,
      'event_id', v_decision.event_id,
      'axis', v_decision.axis,
      'proposal_id', v_decision.proposal_id,
      'lens', v_decision.lens,
      'reason_template', v_decision.reason_template,
      'reason_params', v_decision.reason_params,
      'confirmed_by', v_decision.confirmed_by,
      'confirmed_at', v_decision.confirmed_at
    ),
    'outstanding', coalesce(to_jsonb(v_outstanding), '[]'::jsonb),
    'votes_total', v_votes_total
  );
end;
$$;

revoke all on function confirm_decision(uuid, text, uuid, text, jsonb) from public;
grant execute on function confirm_decision(uuid, text, uuid, text, jsonb) to service_role;
