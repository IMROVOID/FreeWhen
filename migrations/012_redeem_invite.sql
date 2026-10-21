-- migrations/012_redeem_invite.sql
-- Idempotent and reversible. One concern. Named for what it creates.

-- ★ THE ONLY PATH THAT WORKS BEFORE A SESSION EXISTS.
--
-- Invite redemption must work before a session exists, so it is handled by a
-- server-side RPC and NEVER by an RLS policy — there is no auth.uid() yet.
--
-- ★ BYTE-IDENTICAL ERRORS ARE A SECURITY REQUIREMENT, NOT A NICETY.
-- Invalid, expired and revoked tokens all return the SAME value. Any
-- difference lets an attacker probe whether an event exists (FR-8.33).
--
-- The plaintext token is never stored: only its sha256 hash is, and the
-- lookup is by hash.

-- ★ `pg_temp` IS LISTED EXPLICITLY, AND `public` IS SCHEMA-QUALIFIED.
--
-- `set search_path = public` alone is NOT enough. `pg_temp` is searched
-- BEFORE `public` for unqualified names, and both `anon` and
-- `authenticated` hold TEMP privilege on the database. A caller could
-- therefore create a temp table named `event`, and this function — whose
-- body is re-parsed on every call — would read the CALLER'S table instead
-- of the real one. A forged `event` row would make an expired invite
-- redeem successfully, which breaks FR-8.33 in the dangerous direction.
--
-- `pg_temp` last puts the real schema ahead of the temporary one, and
-- `public.event` is qualified as well, so neither the search_path nor the
-- qualification can be subverted.
--
-- `extensions` is in the path because Supabase ships pgcrypto there, while
-- this project installs it into `public`. Listing both makes `digest()`
-- resolve on either backend.
create or replace function redeem_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash    text := encode(digest(p_token, 'sha256'), 'hex');
  v_event   public.event;
  v_count   int;
begin
  -- Lookup by hash only. `for update` takes a row lock on the event that is
  -- held until the caller's transaction ends, so the participant count read
  -- below cannot change underneath a concurrent join. This closes the cap
  -- race that a bare count(*) would leave open.
  select * into v_event from public.event where invite_token_hash = v_hash for update;

  -- Invalid, expired, and revoked all fall through to the SAME return value.
  -- A revoked or rotated token no longer has its hash in the table, so it
  -- arrives here as "no event" and is indistinguishable from a token that
  -- was never valid. Any difference here is an information leak.
  if v_event.id is null
     or v_event.invite_expires_at is null
     or v_event.invite_expires_at <= now() then
    return jsonb_build_object('error', 'INVITE_INVALID');
  end if;

  select count(*) into v_count from participant where event_id = v_event.id;

  -- Deliberately distinguishable: only reachable with a valid token.
  if v_count >= 10 then
    return jsonb_build_object('error', 'EVENT_FULL');
  end if;

  return jsonb_build_object(
    'event_id', v_event.id,
    'title',    v_event.title,
    'status',   v_event.status,
    'participant_count', v_count
  );
end;
$$;

-- The function is the only unauthenticated write path in the schema, so it
-- is executable by the anon role and by nothing else. It performs no write:
-- it resolves the invite and reports the participant count. The join itself
-- happens in Phase 5, inside the transaction that holds the row lock taken
-- above.
revoke all on function redeem_invite(text) from public;
grant execute on function redeem_invite(text) to anon, authenticated;
