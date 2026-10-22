/**
 * `POST /api/events/:id/nudge` (Plan 10 Task 12, FR-6.25, AC-6.5.1).
 *
 * ★ ONE-TAP, ORGANIZER-ONLY, AND RATE-LIMITED TO ONCE PER FOUR HOURS.
 *
 * A nudge is social pressure the organizer applies deliberately. Left unbounded
 * it becomes spam, the group mutes the app, and the one notification that mattered
 * — the decision — is lost with it. The cooldown is per participant, so nudging
 * one straggler does not block nudging a different one.
 *
 * ★ A REJECTED SECOND NUDGE EXPLAINS ITSELF (AC-6.5.1).
 *
 * It is a 429 carrying the catalogue key and the instant the next nudge is
 * allowed. A silent no-op would look like a broken button and the organizer would
 * tap again.
 *
 * ★ THE OUTSTANDING SET IS RE-CHECKED AT SEND TIME (E10).
 *
 * A nudge to someone who voted while the organizer was composing it feels like the
 * organizer is not paying attention. So the recipient list is recomputed from the
 * database at this moment — never taken from the request.
 */

import { NUDGE_COOLDOWN_MS, RSVP_VALIDATION } from '../../src/features/follow-through/services/rsvp';

import { callerIdFrom, isUuid, json, wireError } from '../lib/http';
import { limiters } from '../lib/rate-limit';
import { resolveCaller, servicePool, type Caller } from '../lib/supabase';

/** The cooldown, exported so the test and the UI share one number. */
export const NUDGE_COOLDOWN = NUDGE_COOLDOWN_MS;

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

/**
 * The participants who have not voted on anything yet.
 *
 * ★ "OUTSTANDING" MEANS NO VOTE AT ALL, NOT "NO `yes` VOTE".
 *
 * A person who answered "maybe" has answered. Nudging them re-asks a question
 * they already took the trouble to answer, which is exactly the fatigue FR-6.18
 * names.
 */
async function outstandingParticipants(eventId: string): Promise<ParticipantRow[]> {
  const result = await servicePool().query<ParticipantRow>(
    `select p.id, p.display_name, p.role
     from participant p
     where p.event_id = $1
       and not exists (
         select 1
           from vote v
           join proposal pr on pr.id = v.proposal_id
          where pr.event_id = p.event_id
            and v.participant_id = p.id
       )
     order by p.joined_at asc, p.id asc`,
    [eventId],
  );

  return result.rows;
}

/** The instant of the most recent nudge by this organizer, or `null`. */
async function lastNudgeAt(eventId: string, actorId: string): Promise<Date | null> {
  const result = await servicePool().query<{ created_at: Date }>(
    `select created_at
     from activity_log
     where event_id = $1
       and actor_id = $2
       and action = 'nudged'
     order by created_at desc
     limit 1`,
    [eventId, actorId],
  );

  return result.rows[0]?.created_at ?? null;
}

export async function nudgeHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return wireError('NOT_PARTICIPANT');

  const eventId = params.id ?? '';
  if (!isUuid(eventId)) return wireError('NOT_PARTICIPANT');

  const me = await participantIn(eventId, caller);
  if (!me) return wireError('NOT_PARTICIPANT');

  // Nudging is the organizer's act. A member nudging the group is harassment
  // with a nicer name.
  if (me.role !== 'organizer') return wireError('NOT_ORGANIZER');

  const budget = limiters.mutationByParticipant.check(`nudge:${caller.userId}`);
  if (!budget.allowed) return wireError('RATE_LIMITED');

  const previous = await lastNudgeAt(eventId, me.id);
  const now = new Date();

  if (previous && now.getTime() - previous.getTime() < NUDGE_COOLDOWN) {
    // ★ 429 WITH AN EXPLANATION, NOT A SILENT NO-OP (AC-6.5.1).
    const retryAt = new Date(previous.getTime() + NUDGE_COOLDOWN);

    return json(
      {
        error: 'RATE_LIMITED',
        messageKey: RSVP_VALIDATION.nudgeCooldown,
        // The UI renders "you can nudge again at …" from this instant rather
        // than counting down from a number the server made up.
        retry_at: retryAt.toISOString(),
        reason: RSVP_VALIDATION.nudgeCooldown,
      },
      429,
    );
  }

  const outstanding = await outstandingParticipants(eventId);

  // E10 — everyone answered while the organizer was composing it.
  if (outstanding.length === 0) {
    return json(
      {
        error: 'VALIDATION_FAILED',
        messageKey: RSVP_VALIDATION.nobodyOutstanding,
        recipients: [],
        reason: RSVP_VALIDATION.nobodyOutstanding,
      },
      422,
    );
  }

  await servicePool().query(
    `insert into activity_log (event_id, actor_id, action, subject_type, detail)
     values ($1, $2, 'nudged', 'event', $3::jsonb)`,
    [eventId, me.id, JSON.stringify({ recipients: outstanding.length })],
  );

  return json({
    // Ids and names, in join order, so the card can say who was nudged without a
    // second request.
    recipients: outstanding.map((participant) => participant.id),
    recipients_display: outstanding.map((participant) => participant.display_name),
    sent_at: now.toISOString(),
    // When the next nudge is allowed, so the button can disable itself honestly
    // rather than after a failed tap.
    next_allowed_at: new Date(now.getTime() + NUDGE_COOLDOWN).toISOString(),
  });
}
