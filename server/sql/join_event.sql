-- server/sql/join_event.sql
-- The atomic guest join (PRD-01 FR-1.16–FR-1.22, §13.3).
--
-- ★ ROW-LOCKED, NOT READ-THEN-WRITE.
--
-- The participant cap of 10 is a security bound, so a count followed by an
-- insert is not good enough: two concurrent joins can both read 9 and both
-- insert, producing an 11th participant. `select ... for update` on the event
-- row serialises every join for that event and holds the lock for the whole
-- transaction, so the count cannot change underneath the insert.
--
-- ★ THE SAME LOCK MAKES NAME DISAMBIGUATION SAFE.
--
-- `Ali (2)` is chosen by reading the names already present. Without the lock,
-- two people named Ali arriving at once would both see no `Ali (2)` and both
-- claim it — a unique-violation the user would experience as "join failed".
--
-- ★ ERRORS ARE TOKENS, NEVER PROSE.
--
-- `INVITE_INVALID` and `EVENT_FULL` are the two the route turns into a wire
-- error. Invalid, expired and revoked all collapse into `INVITE_INVALID`: any
-- distinction between them is an information leak (FR-1.13).
--
-- ★ `pg_temp` IS LISTED EXPLICITLY AND `public` IS QUALIFIED.
--
-- The body is re-parsed on every call, so an unqualified name could resolve to
-- a caller-created temp table. `pg_temp` last puts the real schema first.
--
-- `extensions` is in the path because Supabase ships pgcrypto there while this
-- project installs it into `public`.

-- ★ IDENTITY COMES FROM THE SESSION, NEVER FROM A PARAMETER.
--
-- The first draft of this function took the caller's identity as an ARGUMENT
-- and was executable by `anon`. That is an impersonation oracle: `anon`
-- execute plus a caller-supplied user id means any caller could join an event
-- AS ANY USER — including an organizer — and the definer's elevated rights
-- made that row's creation legitimate.
--
-- The identity now comes from `auth.uid()`, which reads the JWT claims the
-- SERVER set for this request. There is no argument to forge, and the row the
-- function writes is the caller's own.
--
-- ★ WHY IT IS STILL `security definer`.
--
-- Because the RLS "join event" policy requires the joiner to ALREADY be a
-- participant (`is_event_participant(event_id)`), a first-time join cannot
-- insert under its own rights — the policy is what stops a member from
-- forging an organizer row, and it must not be weakened to let a join in.
--
-- The definer's rights are therefore what makes the insert possible, and the
-- same pattern Phase 2's `redeem_invite` uses: the function is a narrow,
-- server-only write path, and what it writes is bound to `auth.uid()`.
--
-- ★ EXECUTE IS GRANTED TO `service_role` ONLY.
--
-- `authenticated` is NOT granted, deliberately. The route rate-limits
-- redemption per IP and per token (FR-1.15); a direct PostgREST call to this
-- function would bypass that limiter and turn it into a token-enumeration
-- oracle. The server is the only caller, and it always goes through the
-- rate-limited route.
--
-- `anon` is not granted either — it has no `auth.uid()`, and a function that
-- creates a participant row must never be reachable without a session.

create or replace function join_event(
  p_token        text,
  p_display_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash          text := encode(digest(p_token, 'sha256'), 'hex');
  v_caller        uuid := auth.uid();
  v_anonymous     boolean := coalesce(auth.is_anonymous(), true);
  v_event         public.event;
  v_existing      public.participant;
  v_participant   public.participant;
  v_count         int;
  v_base          text;
  v_candidate     text;
  v_suffix        text;
  v_attempt       int;
  v_result        jsonb;
begin
  -- The lock that closes the cap race and the name race together.
  select * into v_event
  from public.event
  where invite_token_hash = v_hash
  for update;

  -- Unknown, expired and revoked are indistinguishable here: a rotated or
  -- revoked token no longer has its hash in the table, so it arrives as
  -- "no event". One return value for all three.
  if v_event.id is null
     or v_event.invite_expires_at is null
     or v_event.invite_expires_at <= now() then
    return jsonb_build_object('error', 'INVITE_INVALID');
  end if;

  -- FR-1.20 — the same identity re-joining is routed to the existing row.
  -- `created: false` lets the client tell a fresh join from a return visit
  -- without creating a spurious analytics event.
  select * into v_existing
  from public.participant
  where event_id = v_event.id
    and auth_user_id = v_caller;

  if v_existing.id is not null then
    return jsonb_build_object(
      'error', null,
      'created', false,
      'participant', jsonb_build_object(
        'id', v_existing.id,
        'event_id', v_existing.event_id,
        'display_name', v_existing.display_name,
        'role', v_existing.role,
        'modes', to_jsonb(v_existing.modes),
        'visibility', v_existing.visibility,
        'max_travel_minutes', v_existing.max_travel_minutes,
        'notifications_muted', v_existing.notifications_muted,
        'has_start_point', exists (
          select 1 from public.start_point where participant_id = v_existing.id
        )
      ),
      'event', jsonb_build_object(
        'event_id', v_event.id,
        'title', v_event.title,
        'status', v_event.status,
        'participant_count', (
          select count(*) from public.participant where event_id = v_event.id
        )
      )
    );
  end if;

  select count(*) into v_count
  from public.participant
  where event_id = v_event.id;

  -- Deliberately distinguishable from INVITE_INVALID: reachable only by a
  -- holder of a valid link, so naming it leaks nothing and helps the user.
  if v_count >= 10 then
    return jsonb_build_object('error', 'EVENT_FULL');
  end if;

  -- FR-1.19 — a collision never fails the join, it renames.
  --
  -- The base is truncated so the suffix still fits the column's 30-character
  -- bound: `left(base, 30 - len(' (2)'))` for a full-length name. A plain
  -- `base || ' (2)'` would violate the constraint for a 30-character name and
  -- turn a supportable case into an error.
  v_base := left(btrim(p_display_name), 30);
  v_candidate := v_base;
  v_attempt := 2;

  while exists (
    select 1 from public.participant
    where event_id = v_event.id
      and display_name = v_candidate
  ) loop
    if v_attempt > 999 then
      -- Pathological density. Still must not fail: a short random tail is
      -- unique in practice and the user is never blocked from voting.
      v_candidate := left(v_base, 20) || ' ' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
      exit;
    end if;

    v_suffix := ' (' || v_attempt || ')';
    v_candidate := left(v_base, greatest(1, 30 - char_length(v_suffix))) || v_suffix;
    v_attempt := v_attempt + 1;
  end loop;

  -- The cap trigger is authoritative. It is checked above, under the same
  -- lock, so this handler exists only so a defensive `EVENT_FULL` from the
  -- trigger becomes the same jsonb error rather than an aborted transaction.
  begin
    insert into public.participant (
      event_id, auth_user_id, display_name, role, is_anonymous
    ) values (
      v_event.id, v_caller, v_candidate, 'member', v_anonymous
    )
    returning * into v_participant;
  exception
    when check_violation then
      return jsonb_build_object('error', 'EVENT_FULL');
  end;

  select count(*) into v_count
  from public.participant
  where event_id = v_event.id;

  v_result := jsonb_build_object(
    'error', null,
    'created', true,
    'participant', jsonb_build_object(
      'id', v_participant.id,
      'event_id', v_participant.event_id,
      'display_name', v_participant.display_name,
      'role', v_participant.role,
      'modes', to_jsonb(v_participant.modes),
      'visibility', v_participant.visibility,
      'max_travel_minutes', v_participant.max_travel_minutes,
      'notifications_muted', v_participant.notifications_muted,
      'has_start_point', false
    ),
    'event', jsonb_build_object(
      'event_id', v_event.id,
      'title', v_event.title,
      'status', v_event.status,
      'participant_count', v_count
    )
  );

  return v_result;
end;
$$;

-- ★ EXECUTE IS GRANTED TO `service_role` ONLY.
--
-- `authenticated` is NOT granted, deliberately. The route rate-limits
-- redemption per IP and per token (FR-1.15); a direct PostgREST call to this
-- function would bypass that limiter and turn it into a token-enumeration
-- oracle. The server is the only caller, and it always goes through the
-- rate-limited route.
--
-- `anon` is not granted either — it has no `auth.uid()`, and a function that
-- creates a participant row must never be reachable without a session.
--
-- The function still READS `auth.uid()`, so the server must set the caller's
-- JWT claims for the duration of the call (see `withCallerTransaction`).
revoke all on function join_event(text, text) from public;
grant execute on function join_event(text, text) to service_role;

-- ★ THE OLD SIGNATURE IS DROPPED, NOT LEFT BEHIND.
--
-- `create or replace` only replaces a function with the SAME argument types.
-- The four-argument version — which took the caller's identity as a parameter
-- and was executable by `anon` — therefore SURVIVED the rewrite as a second,
-- still-callable function. It had to be dropped explicitly.
--
-- Leaving it would have been the worst outcome: the impersonation path would
-- have stayed open, invisible to every test that only called the new
-- signature.
drop function if exists join_event(text, uuid, boolean, text);
