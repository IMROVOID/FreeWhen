/**
 * Start point and profile writes (Plan 05 Task 11).
 *
 * ★ THE CLIENT ROUNDS; THE SERVER RE-VALIDATES.
 *
 * Rounding on the device is what keeps the precise fix off the network, out of
 * the logs and away from any third party (FR-8.11). But a client is not a trust
 * boundary, so the server checks the same 2-decimal contract on the way in
 * (OQ-9.2 — "both"). Rounding here as a REPAIR would quietly accept a 6-decimal
 * payload, which is the one thing this endpoint must never do — so precision is
 * rejected, not corrected.
 */

import {
  ParticipantPatchSchema,
  StartPointSchema,
  type ParticipantPatchInput,
  type ParticipantSummary,
  type StartPointInput,
} from '@/src/types/event';

import { servicePool, type Caller } from './supabase';

/** The caller's participant row for one event, or `null` when they are not in it. */
async function participantFor(
  caller: Caller,
  eventId: string,
): Promise<{ id: string } | null> {
  const result = await servicePool().query<{ id: string }>(
    `select id from participant where event_id = $1 and auth_user_id = $2`,
    [eventId, caller.userId],
  );

  return result.rows[0] ?? null;
}

export type ParticipantFailure = 'NOT_PARTICIPANT';

export type StartPointOutcome =
  | { ok: true; start_point: { lat: number; lng: number; accuracy_m: number; label: string | null } }
  | { ok: false; reason: ParticipantFailure };

/**
 * Writes (or replaces) the caller's start point.
 *
 * One row per participant: `start_point.participant_id` is UNIQUE, so the
 * upsert cannot accumulate a history of where someone has been. Storing the
 * previous location would be a location history by accident.
 */
export async function setStartPoint(
  caller: Caller,
  eventId: string,
  input: StartPointInput,
): Promise<StartPointOutcome> {
  const member = await participantFor(caller, eventId);
  if (!member) return { ok: false, reason: 'NOT_PARTICIPANT' };

  const parsed = StartPointSchema.parse(input);

  const result = await servicePool().query<{
    lat_rounded: string;
    lng_rounded: string;
    accuracy_m: number;
    label: string | null;
  }>(
    `insert into start_point (
       participant_id, lat_rounded, lng_rounded, accuracy_m, source, label
     ) values ($1, $2, $3, $4, $5, $6)
     on conflict (participant_id) do update
        set lat_rounded = excluded.lat_rounded,
            lng_rounded = excluded.lng_rounded,
            accuracy_m = excluded.accuracy_m,
            source      = excluded.source,
            label       = excluded.label
     returning lat_rounded, lng_rounded, accuracy_m, label`,
    [
      member.id,
      parsed.lat,
      parsed.lng,
      parsed.accuracy_m,
      parsed.source,
      parsed.label ?? null,
    ],
  );

  const row = result.rows[0];
  if (!row) throw new Error('start point upsert returned no row');

  return {
    ok: true,
    start_point: {
      // `numeric(5,2)` arrives as a string from `pg`; the client wants a number.
      lat: Number(row.lat_rounded),
      lng: Number(row.lng_rounded),
      accuracy_m: row.accuracy_m,
      label: row.label,
    },
  };
}

/**
 * Removes the caller's start point (FR-8.21).
 *
 * It touches `start_point` and nothing else. A participant who deletes their
 * location is still a participant, still a voter, and still counted — the
 * ranking reports reduced coverage instead of dropping them (Phase 8).
 */
export async function deleteStartPoint(
  caller: Caller,
  eventId: string,
): Promise<{ ok: true } | { ok: false; reason: ParticipantFailure }> {
  const member = await participantFor(caller, eventId);
  if (!member) return { ok: false, reason: 'NOT_PARTICIPANT' };

  await servicePool().query(`delete from start_point where participant_id = $1`, [member.id]);

  return { ok: true };
}

/**
 * Updates the caller's own profile (FR-1.21).
 *
 * `role`, `event_id` and `auth_user_id` are deliberately not writable here: a
 * member promoting themselves to organizer is the privilege-escalation hole
 * Phase 2 closed at the column-grant level, and this endpoint must not reopen
 * it from above.
 */
export async function patchParticipant(
  caller: Caller,
  eventId: string,
  input: ParticipantPatchInput,
): Promise<{ ok: true; participant: ParticipantSummary } | { ok: false; reason: ParticipantFailure }> {
  const member = await participantFor(caller, eventId);
  if (!member) return { ok: false, reason: 'NOT_PARTICIPANT' };

  const parsed = ParticipantPatchSchema.parse(input);

  const result = await servicePool().query<{
    id: string;
    event_id: string;
    display_name: string;
    role: ParticipantSummary['role'];
    visibility: ParticipantSummary['visibility'];
    max_travel_minutes: number;
    modes: string[] | null;
    has_start_point: boolean;
  }>(
    `update participant set
       display_name       = coalesce($2, display_name),
       modes              = coalesce($3::text[], modes),
       has_car            = coalesce($4, has_car),
       max_travel_minutes = coalesce($5, max_travel_minutes),
       access_needs       = coalesce($6::jsonb, access_needs),
       visibility         = coalesce($7, visibility)
     where id = $1
     returning id, event_id, display_name, role, visibility,
               max_travel_minutes, modes,
               exists (select 1 from start_point sp where sp.participant_id = participant.id) as has_start_point`,
    [
      member.id,
      parsed.display_name ?? null,
      parsed.modes ?? null,
      parsed.has_car ?? null,
      parsed.max_travel_minutes ?? null,
      parsed.access_needs ? JSON.stringify(parsed.access_needs) : null,
      parsed.visibility ?? null,
    ],
  );

  const row = result.rows[0];
  if (!row) throw new Error('participant update returned no row');

  return {
    ok: true,
    participant: {
      id: row.id,
      event_id: row.event_id,
      display_name: row.display_name,
      role: row.role,
      has_start_point: row.has_start_point,
      max_travel_minutes: row.max_travel_minutes,
      modes: (row.modes ?? []) as ParticipantSummary['modes'],
      visibility: row.visibility,
    },
  };
}

/**
 * The audience and expiry shown after a start point is added (FR-8.9).
 *
 * Computed rather than stored: the audience is whoever is a participant now, so
 * a cached count would be wrong the moment somebody joins.
 */
export async function startPointAudience(
  caller: Caller,
  eventId: string,
): Promise<{ participant_count: number; event_end: string } | null> {
  const member = await participantFor(caller, eventId);
  if (!member) return null;

  const result = await servicePool().query<{ participant_count: string; date_window_end: Date }>(
    `select
       (select count(*) from participant where event_id = $1) as participant_count,
       date_window_end
     from event where id = $1`,
    [eventId],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    participant_count: Number(row.participant_count),
    event_end: new Date(row.date_window_end).toISOString(),
  };
}
