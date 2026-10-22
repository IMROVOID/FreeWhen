/**
 * `POST /api/events/:id/status-update` (Plan 10 Task 11, FR-6.21–FR-6.22).
 *
 * ★ RUNNING LATE IS ALLOWED FOR TWO HOURS AFTER THE EVENT TIME, THEN HIDDEN (E7).
 *
 * A permanent "running late" badge is noise that outlives its meaning: the event
 * it referred to is over, and the status stops saying anything true. The window
 * is measured from the reported instant, so a status set the day before does not
 * resurface at the event.
 *
 * ★ THE BROADCAST GOES TO `going` PARTICIPANTS ONLY (FR-6.22).
 *
 * Someone who answered "cannot" does not need to know that Ali is fifteen minutes
 * behind. Telling them is the kind of notification that makes a person mute the
 * app, and it is the same fatigue rule that keeps N3 on non-voters.
 *
 * ★ "CAN'T MAKE IT" IS AN RSVP WRITE, NOT A SEPARATE STATE.
 *
 * It sets `rsvp = 'cannot'`, so the attendee counts on the card and the record of
 * who said what can never disagree. A parallel `status` column would be a second
 * source of truth for the same fact.
 */

import {
  RUNNING_LATE_OPTIONS,
  RUNNING_LATE_VISIBLE_MS,
  RSVP_VALIDATION,
} from '../../src/features/follow-through/services/contract';

import {
  callerIdFrom,
  isUuid,
  json,
  readJsonBody,
  validationFailed,
  wireError,
} from '../lib/http';
import { limiters } from '../lib/rate-limit';
import { resolveCaller, servicePool, withTransaction, type Caller } from '../lib/supabase';

/** The `status-update` actions this endpoint accepts. */
const ACTIONS = ['running_late', 'cannot_make_it'] as const;

interface ParticipantRow {
  id: string;
  display_name: string;
  role: string;
}

async function callerFrom(request: Request): Promise<Caller | null> {
  const userId = callerIdFrom(request);
  if (!userId || !isUuid(userId)) return null;
  return resolveCaller(userId);
}

async function participantIn(eventId: string, caller: Caller): Promise<ParticipantRow | null> {
  const result = await servicePool().query<ParticipantRow>(
    `select id, display_name, role
     from participant
     where event_id = $1 and auth_user_id = $2`,
    [eventId, caller.userId],
  );

  return result.rows[0] ?? null;
}

/** The event's status and home timezone, or `null`. */
async function eventContext(
  eventId: string,
): Promise<{ status: string; home_tz: string } | null> {
  const result = await servicePool().query<{ status: string; home_tz: string }>(
    `select status, home_tz from event where id = $1`,
    [eventId],
  );

  return result.rows[0] ?? null;
}

/** The participants who answered `going`, in join order. */
async function goingParticipants(eventId: string): Promise<ParticipantRow[]> {
  const result = await servicePool().query<ParticipantRow>(
    `select p.id, p.display_name, p.role
     from participant p
     join rsvp r on r.participant_id = p.id
     where p.event_id = $1 and r.value = 'going'
     order by p.joined_at asc, p.id asc`,
    [eventId],
  );

  return result.rows;
}

/**
 * One running-late status, as the card renders it.
 *
 * ★ THE ACTIVITY LOG IS THE STORE.
 *
 * Running-late is transient by design — it is meaningful for two hours and then
 * it is not — so it lives in the append-only `activity_log` the schema already
 * has, with `subject_type = 'participant'` and token-only `detail`. Adding a
 * table for a value with a two-hour life would be a migration for a cache.
 */
export interface RunningLateEntry {
  participant_id: string;
  display_name: string;
  minutes: number;
  reported_at: string;
}

/**
 * The running-late statuses still worth showing.
 *
 * Anything older than the window is dropped rather than returned with a flag:
 * `isRunningLateVisible` is the rule, and this is where it is applied.
 */
export async function visibleRunningLate(
  eventId: string,
  now: Date = new Date(),
): Promise<RunningLateEntry[]> {
  const result = await servicePool().query<{
    subject_id: string | null;
    display_name: string | null;
    detail: { minutes?: number } | null;
    created_at: Date;
  }>(
    `select a.subject_id, p.display_name, a.detail, a.created_at
     from activity_log a
     left join participant p on p.id = a.subject_id
     where a.event_id = $1
       and a.action = 'running_late'
       and a.created_at > $2
     order by a.created_at desc
     limit 20`,
    [eventId, new Date(now.getTime() - RUNNING_LATE_VISIBLE_MS)],
  );

  // ★ ONE LINE PER PERSON, THE MOST RECENT.
  //
  // Reporting late twice updates the number rather than stacking a second badge:
  // "Alī is 20 minutes late" replaces "Alī is 10 minutes late", it does not sit
  // beside it.
  const seen = new Set<string>();
  const entries: RunningLateEntry[] = [];

  for (const row of result.rows) {
    if (!row.subject_id || seen.has(row.subject_id)) continue;
    seen.add(row.subject_id);

    entries.push({
      participant_id: row.subject_id,
      display_name: row.display_name ?? '',
      minutes: Number(row.detail?.minutes ?? 0),
      reported_at: row.created_at.toISOString(),
    });
  }

  return entries;
}

export async function statusUpdateHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return wireError('NOT_PARTICIPANT');

  const eventId = params.id ?? '';
  if (!isUuid(eventId)) return wireError('NOT_PARTICIPANT');

  const me = await participantIn(eventId, caller);
  if (!me) return wireError('NOT_PARTICIPANT');

  const budget = limiters.mutationByParticipant.check(`status:${caller.userId}`);
  if (!budget.allowed) return wireError('RATE_LIMITED');

  const body = await readJsonBody(request);
  if (!body) return validationFailed([{ path: [], message: 'errors.validationFailed' }]);

  const action = body.action;
  if (typeof action !== 'string' || !(ACTIONS as readonly string[]).includes(action)) {
    return validationFailed([{ path: ['action'], message: 'errors.validationFailed' }]);
  }

  const event = await eventContext(eventId);
  if (!event) return wireError('NOT_PARTICIPANT');

  // Both actions describe attendance at a decided plan, so both need one.
  if (event.status !== 'CONFIRMED') {
    return validationFailed([{ path: ['action'], message: RSVP_VALIDATION.eventNotConfirmed }]);
  }

  if (action === 'cannot_make_it') {
    await servicePool().query(
      `insert into rsvp (participant_id, event_id, value)
       values ($1, $2, 'cannot')
       on conflict (participant_id)
       do update set value = 'cannot', updated_at = now()`,
      [me.id, eventId],
    );

    return json({ action, rsvp: 'cannot', running_late: await visibleRunningLate(eventId) });
  }

  return recordRunningLate(eventId, me, body);
}

/**
 * Records a running-late status.
 *
 * The minutes are constrained to the offered increments: an arbitrary number from
 * the client would let a caller broadcast "۴۰۰۰ دقیقه" to the whole group, which
 * is a poke at every `going` participant's phone for no reason.
 */
async function recordRunningLate(
  eventId: string,
  me: ParticipantRow,
  body: Record<string, unknown>,
): Promise<Response> {
  const minutes = Number(body.minutes);

  if (!(RUNNING_LATE_OPTIONS as readonly number[]).includes(minutes)) {
    return validationFailed([{ path: ['minutes'], message: 'errors.validationFailed' }]);
  }

  const going = await goingParticipants(eventId);

  await withTransaction(async (client) => {
    await client.query(
      `insert into activity_log (event_id, actor_id, action, subject_type, subject_id, detail)
       values ($1, $2, 'running_late', 'participant', $3, $4::jsonb)`,
      [eventId, me.id, me.id, JSON.stringify({ minutes })],
    );
  });

  return json({
    action: 'running_late',
    minutes,
    // The recipients the broadcast reaches, as ids. The client turns these into
    // in-app notifications; a participant who answered `cannot` is absent by
    // construction (FR-6.22).
    recipients: going.map((participant) => participant.id),
    running_late: await visibleRunningLate(eventId),
  });
}
