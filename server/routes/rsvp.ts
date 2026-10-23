/**
 * `PUT /api/events/:id/rsvp` and `GET /api/events/:id/rsvp` (Plan 10 Task 1).
 *
 * ★ RSVP IS REFUSED UNTIL THE EVENT IS `CONFIRMED` (FR-6.1, AC-6.1.1).
 *
 * Before the decision the honest signal is the vote. Two competing signals make
 * the group read the wrong one, and the cheaper of the two to fake — "yes I'm
 * coming" costs nothing to say before a place exists — is the one they would
 * read. So the refusal is here, on the server, and not only in the component
 * that forgets to hide the control.
 *
 * ★ NOTHING HERE CHECKS WHETHER THE CALLER VOTED (FR-6.6, OQ-6.2).
 *
 * Requiring a vote would punish exactly the busy person the product exists for,
 * and it breaks "nothing blocks participation". There is deliberately no vote
 * read on this path, so the rule cannot be added by accident later.
 *
 * ★ THE WRITE IS ONE UPSERT (PRD-02 §13.3).
 *
 * The schema keys `rsvp` on `participant_id`, so `insert ... on conflict do
 * update` compiles to a single statement. A read-then-write would let two
 * concurrent taps both see the old value and the last one would win silently —
 * which looks exactly like a user who changed their mind.
 */

import { RSVP_VALIDATION, RSVP_VALUES, type RsvpValue } from '../../src/features/follow-through/services/contract';

import {
  callerIdFrom,
  isUuid,
  json,
  readJsonBody,
  validationFailed,
  wireError,
} from '../lib/http';
import { limiters } from '../lib/rate-limit';
import { resolveCaller, scopedQueryable, type Caller } from '../lib/supabase';

/** Attendance counts plus names, matching `Attendance` in the client service. */
export interface AttendancePayload {
  going: number;
  maybe: number;
  cannot: number;
  noResponse: number;
  names: { going: string[]; maybe: string[]; cannot: string[] };
}

async function callerFrom(request: Request): Promise<Caller | null> {
  const userId = callerIdFrom(request);
  if (!userId || !isUuid(userId)) return null;
  return resolveCaller(userId);
}

/** The caller's participant row, or `null` when they are not in the event. */
async function participantIn(
  eventId: string,
  caller: Caller,
): Promise<{ id: string; display_name: string; role: string } | null> {
  const result = await scopedQueryable().query<{ id: string; display_name: string; role: string }>(
    `select id, display_name, role
     from participant
     where event_id = $1 and auth_user_id = $2`,
    [eventId, caller.userId],
  );

  return result.rows[0] ?? null;
}

/** The event's status, or `null` when it does not exist. */
async function eventStatus(eventId: string): Promise<string | null> {
  const result = await scopedQueryable().query<{ status: string }>(
    `select status from event where id = $1`,
    [eventId],
  );

  return result.rows[0]?.status ?? null;
}

/**
 * Attendance, counted in join order.
 *
 * Participants with no RSVP are counted as `noResponse` rather than assumed
 * absent: "has not answered" and "is not coming" are different facts and the
 * organizer acts on them differently. The ordering is `joined_at`, which every
 * device shares, so two participants see the same names in the same order.
 */
async function attendanceFor(eventId: string): Promise<AttendancePayload> {
  const result = await scopedQueryable().query<{ display_name: string; value: RsvpValue | null }>(
    `select p.display_name, r.value
     from participant p
     left join rsvp r on r.participant_id = p.id
     where p.event_id = $1
     order by p.joined_at asc, p.id asc`,
    [eventId],
  );

  const names: AttendancePayload['names'] = { going: [], maybe: [], cannot: [] };
  let noResponse = 0;

  for (const row of result.rows) {
    if (row.value === null) {
      noResponse += 1;
      continue;
    }
    names[row.value].push(row.display_name);
  }

  return {
    going: names.going.length,
    maybe: names.maybe.length,
    cannot: names.cannot.length,
    noResponse,
    names,
  };
}

/**
 * `GET /api/events/:id/rsvp`
 *
 * Returns every RSVP plus the counts, so the card renders from one request.
 */
export async function getRsvpHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return wireError('NOT_PARTICIPANT');

  const eventId = params.id ?? '';
  if (!isUuid(eventId)) return wireError('NOT_PARTICIPANT');

  const me = await participantIn(eventId, caller);
  if (!me) return wireError('NOT_PARTICIPANT');

  const rows = await scopedQueryable().query<{ participant_id: string; value: RsvpValue }>(
    `select participant_id, value from rsvp where event_id = $1`,
    [eventId],
  );

  const rsvps: Record<string, RsvpValue> = {};
  for (const row of rows.rows) rsvps[row.participant_id] = row.value;

  return json({
    rsvps,
    attendance: await attendanceFor(eventId),
    mine: rsvps[me.id] ?? null,
  });
}

/**
 * `PUT /api/events/:id/rsvp`
 *
 * `PUT` because the operation is idempotent: sending `going` twice is one RSVP.
 * A `POST` would suggest a second call creates a second answer, and a client
 * retrying on a timeout would be leaning on the constraint rather than the verb.
 */
export async function putRsvpHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return wireError('NOT_PARTICIPANT');

  const eventId = params.id ?? '';
  if (!isUuid(eventId)) return wireError('NOT_PARTICIPANT');

  const me = await participantIn(eventId, caller);
  if (!me) return wireError('NOT_PARTICIPANT');

  const budget = limiters.mutationByParticipant.check(`rsvp:${caller.userId}`);
  if (!budget.allowed) return wireError('RATE_LIMITED');

  const body = await readJsonBody(request);
  if (!body) return validationFailed([{ path: [], message: 'errors.validationFailed' }]);

  const value = body.value;
  if (typeof value !== 'string' || !(RSVP_VALUES as readonly string[]).includes(value)) {
    return validationFailed([{ path: ['value'], message: RSVP_VALIDATION.unknownValue }]);
  }

  // ★ THE POST-CONFIRMATION RULE, ENFORCED SERVER-SIDE (FR-6.1).
  const status = await eventStatus(eventId);
  if (status === null) return wireError('NOT_PARTICIPANT');

  if (status !== 'CONFIRMED') {
    return validationFailed([{ path: ['value'], message: RSVP_VALIDATION.eventNotConfirmed }]);
  }

  const written = await scopedQueryable().query<{ updated_at: Date }>(
    `insert into rsvp (participant_id, event_id, value)
     values ($1, $2, $3)
     on conflict (participant_id)
     do update set value = excluded.value, updated_at = now()
     returning updated_at`,
    [me.id, eventId, value],
  );


  return json({
    rsvp: {
      participant_id: me.id,
      event_id: eventId,
      value: value as RsvpValue,
      updated_at: (written.rows[0]?.updated_at ?? new Date()).toISOString(),
    },
    attendance: await attendanceFor(eventId),
  });
}
