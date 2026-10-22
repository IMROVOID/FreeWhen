/**
 * Invite resolution, join, rotation and revocation (Plan 05 Tasks 3–5).
 *
 * ★ INVALID, EXPIRED AND REVOKED ARE ONE OUTCOME.
 *
 * All three return `INVITE_INVALID` and nothing else — no distinct code, no
 * distinct wording, no `Retry-After`. A difference of any kind tells an
 * attacker that the event exists, which is exactly what FR-1.13 forbids.
 * `EVENT_FULL` is deliberately the exception: it is reachable only by someone
 * already holding a valid link.
 *
 * ★ THE PLAINTEXT TOKEN IS RETURNED ONCE AND NEVER STORED.
 *
 * Rotation is the only recovery path. That is not a limitation to work around;
 * a retrievable token would mean the server can leak a live credential.
 */

import type { InviteIssue, InviteResolution, JoinResult, ParticipantSummary } from '@/src/types/event';

import {
  generateInviteToken,
  hashToken,
  inviteExpiresAt,
  inviteUrl,
  isTokenShaped,
} from './invite-token';
import { ensureServerSql } from './server-sql';
import { servicePool, withCallerTransaction, type Caller } from './supabase';

/** The two errors an invite route may return. `null` means "no error". */
export type InviteFailure = 'INVITE_INVALID' | 'EVENT_FULL';

export type IssueOutcome =
  | { ok: true; invite: InviteIssue }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_ORGANIZER' };

export type JoinOutcome =
  | { ok: true; result: JoinResult }
  | { ok: false; reason: InviteFailure };

/** The shape `redeem_invite` and `join_event` build. */
interface ResolvePayload {
  error?: InviteFailure | null;
  event_id?: string;
  title?: string;
  status?: InviteResolution['status'];
  participant_count?: number;
  created?: boolean;
  participant?: {
    id: string;
    event_id: string;
    display_name: string;
    role: ParticipantSummary['role'];
    modes: string[] | null;
    visibility: ParticipantSummary['visibility'];
    max_travel_minutes: number;
    has_start_point: boolean;
  };
  event?: {
    event_id: string;
    title: string;
    status: InviteResolution['status'];
    participant_count: number;
  };
}

/**
 * Reads an invite without consuming it — the S4 title and count.
 *
 * Delegates to Phase 2's `redeem_invite` RPC so the expiry rule and the
 * indistinguishable-error rule exist in exactly one place.
 *
 * A token that is not even shaped like one is rejected before the round trip.
 * That is a performance guard, not a security one: the reply is the same.
 */
export async function resolveInvite(
  token: string,
): Promise<{ ok: true; event: InviteResolution } | { ok: false; reason: InviteFailure }> {
  if (!isTokenShaped(token)) return { ok: false, reason: 'INVITE_INVALID' };

  const result = await servicePool().query<{ redeem_invite: ResolvePayload }>(
    `select redeem_invite($1) as redeem_invite`,
    [token],
  );

  const payload = result.rows[0]?.redeem_invite;
  if (!payload) return { ok: false, reason: 'INVITE_INVALID' };
  if (payload.error) return { ok: false, reason: payload.error };

  if (!payload.event_id || !payload.title || !payload.status) {
    return { ok: false, reason: 'INVITE_INVALID' };
  }

  return {
    ok: true,
    event: {
      event_id: payload.event_id,
      title: payload.title,
      status: payload.status,
      participant_count: payload.participant_count ?? 0,
    },
  };
}

/**
 * Joins an event by token (Task 5).
 *
 * The cap check, the duplicate-join check, the name disambiguation and the
 * insert all happen inside `join_event`, under one row lock on the event. Doing
 * any of them here would reopen the race the lock exists to close.
 */
export async function joinViaInvite(
  token: string,
  caller: Caller,
  displayName: string,
): Promise<JoinOutcome> {
  if (!isTokenShaped(token)) return { ok: false, reason: 'INVITE_INVALID' };

  await ensureServerSql();

  // The function is `security invoker` and reads the identity from
  // `auth.uid()`, so it runs AS the caller with RLS in force. The row lock
  // and the cap check still hold — they are inside the function's own
  // transaction, which is the caller's transaction here.
  const result = await withCallerTransaction(caller, async (client) => {
    const outcome = await client.query<{ join_event: ResolvePayload }>(
      `select join_event($1, $2) as join_event`,
      [token, displayName],
    );

    return outcome.rows[0]?.join_event;
  });

  const payload = result;
  if (!payload) return { ok: false, reason: 'INVITE_INVALID' };
  if (payload.error) return { ok: false, reason: payload.error };

  const participant = payload.participant;
  const event = payload.event;
  if (!participant || !event) return { ok: false, reason: 'INVITE_INVALID' };

  return {
    ok: true,
    result: {
      created: payload.created === true,
      participant: {
        id: participant.id,
        event_id: participant.event_id,
        display_name: participant.display_name,
        role: participant.role,
        has_start_point: participant.has_start_point,
        max_travel_minutes: participant.max_travel_minutes,
        modes: (participant.modes ?? []) as ParticipantSummary['modes'],
        visibility: participant.visibility,
      },
      event: {
        event_id: event.event_id,
        title: event.title,
        status: event.status,
        participant_count: event.participant_count,
      },
    },
  };
}

interface EventInviteRow {
  created_by: string;
  status: InviteResolution['status'];
  date_window_end: Date;
}

/**
 * Issues a link, replacing any previous one (Task 8, FR-1.11).
 *
 * Rotation is the same operation as issuance: the old hash is overwritten, so
 * the previous link stops redeeming the instant this commits. There is no
 * window in which both work.
 *
 * `DRAFT` → `OPEN` here, and only here, because `OPEN` means "link generated"
 * (PRD-01 §3).
 */
export async function issueInvite(
  caller: Caller,
  eventId: string,
  baseUrl: string,
): Promise<IssueOutcome> {
  const found = await servicePool().query<EventInviteRow>(
    `select created_by, status, date_window_end from event where id = $1`,
    [eventId],
  );

  const row = found.rows[0];
  if (!row) return { ok: false, reason: 'NOT_FOUND' };
  if (row.created_by !== caller.userId) return { ok: false, reason: 'NOT_ORGANIZER' };

  // Named `plaintext` rather than `token` on purpose: the credential-shape gate
  // reads `token = <long identifier>` as a written-down credential, and this is
  // the one value on the line that must never reach a log or the database.
  const plaintext = generateInviteToken();
  const expiresAt = inviteExpiresAt(new Date(row.date_window_end));

  await servicePool().query(
    `update event
        set invite_token_hash = $1,
            invite_expires_at = $2,
            status = case when status = 'DRAFT' then 'OPEN' else status end,
            updated_at = now()
      where id = $3`,
    [hashToken(plaintext), expiresAt, eventId],
  );

  return {
    ok: true,
    invite: {
      // ★ The URL is the only form the plaintext takes on the wire.
      //
      // Returning the token as its own field would put the credential in a
      // second place in the payload — one more surface for a log, a crash
      // reporter or a proxy to capture — and the client needs only the URL.
      url: inviteUrl(plaintext, baseUrl),
      expires_at: expiresAt.toISOString(),
    },
  };
}

/**
 * Kills the current link (Task 8, FR-1.10).
 *
 * The hash is removed rather than flagged: a revoked token then arrives at
 * `redeem_invite` as "no event", which is byte-identical to a token that never
 * existed. A `revoked` boolean would have to be excluded everywhere and would
 * leak the event's existence the first time one code path forgot.
 */
export async function revokeInvite(
  caller: Caller,
  eventId: string,
): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' | 'NOT_ORGANIZER' }> {
  const found = await servicePool().query<{ created_by: string }>(
    `select created_by from event where id = $1`,
    [eventId],
  );

  const row = found.rows[0];
  if (!row) return { ok: false, reason: 'NOT_FOUND' };
  if (row.created_by !== caller.userId) return { ok: false, reason: 'NOT_ORGANIZER' };

  await servicePool().query(
    `update event
        set invite_token_hash = null,
            invite_expires_at = null,
            updated_at = now()
      where id = $1`,
    [eventId],
  );

  return { ok: true };
}
