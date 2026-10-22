/**
 * `POST /api/events/:id/confirm` (Plan 07 Task 8).
 *
 * ★ CONFIRMATION PROCEEDS WITH OUTSTANDING VOTERS (FR-2.20, AC-2.3.1).
 *
 * The three people who have not answered are a warning the sheet names, never a
 * gate. A route that refused would let one absent person hold the whole group
 * hostage — the failure mode the outstanding-voter list exists to reveal rather
 * than to enforce.
 *
 * ★ IDEMPOTENT (E1).
 *
 * A second confirm answers with the decision that already exists, not a 409.
 * Two taps on a slow connection are one confirmation, and a conflict body would
 * report a failure for an action that succeeded.
 */

import type { Reason } from '@/src/engine/types';
import { ConfirmSchema } from '@/src/types/vote';

import { track } from '../lib/funnel';
import {
  callerIdFrom,
  isUuid,
  json,
  readJsonBody,
  validationFailed,
  wireError,
} from '../lib/http';
import { limiters } from '../lib/rate-limit';
import { resolveCaller, type Caller } from '../lib/supabase';
import { confirmDecision, eventForParticipant } from '../lib/vote-service';

async function callerFrom(request: Request): Promise<Caller | null> {
  const userId = callerIdFrom(request);
  if (!userId || !isUuid(userId)) return null;

  return resolveCaller(userId);
}

/** The engine's reason, when the client sends one back. */
function reasonFrom(body: Record<string, unknown>): Reason | null {
  const reason = body.reason;
  if (reason === null || typeof reason !== 'object') return null;

  const { templateId, params } = reason as { templateId?: unknown; params?: unknown };
  if (typeof templateId !== 'string') return null;

  return {
    templateId: templateId as Reason['templateId'],
    params: (params ?? {}) as Reason['params'],
  };
}

export async function confirmHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return wireError('NOT_PARTICIPANT');

  const eventId = params.id ?? '';
  if (!isUuid(eventId)) return wireError('NOT_PARTICIPANT');

  const event = await eventForParticipant(caller, eventId);
  if (!event) return wireError('NOT_PARTICIPANT');

  const budget = limiters.mutationByParticipant.check(`confirm:${caller.userId}`);
  if (!budget.allowed) return wireError('RATE_LIMITED');

  const body = await readJsonBody(request);
  if (!body) return validationFailed([{ path: [], message: 'errors.validationFailed' }]);

  const parsed = ConfirmSchema.safeParse(body);
  if (!parsed.success) return validationFailed(parsed.error.issues);

  const result = await confirmDecision(caller, eventId, {
    axis: parsed.data.axis,
    preferredProposalId: parsed.data.preferred_proposal_id ?? null,
    lens: typeof body.lens === 'string' ? body.lens : undefined,
    reason: reasonFrom(body),
  });

  if (result === 'NOT_PARTICIPANT') return wireError('NOT_PARTICIPANT');
  if (result === 'NOT_ORGANIZER') return wireError('NOT_ORGANIZER');

  // ★ NO PROPOSAL IS A STATE, NOT AN ERROR.
  //
  // Confirming an event that has nothing left to confirm is an organizer who
  // arrived at the wrong moment, and the area already shows them how to add an
  // option. A 422 here would be a red banner over a screen that is working.
  if (result === 'NO_PROPOSAL') {
    return json({ decision: null, outstanding: [], already_confirmed: false }, 200);
  }

  track('decision_confirmed', {
    event_id: eventId,
    axis: parsed.data.axis,
    // The two numbers the user test needs (PRD-02 §9): how long the group took,
    // and how many people had not answered when it was decided anyway.
    outstanding_voters: result.outstanding.length,
    votes_total: result.votesTotal,
    elapsed_since_open_s:
      typeof body.opened_at === 'string' && Number.isFinite(Date.parse(body.opened_at))
        ? Math.max(0, Math.round((Date.now() - Date.parse(body.opened_at)) / 1000))
        : null,
    already_existed: result.alreadyExisted,
  });

  return json({
    decision: result.decision,
    outstanding: result.outstanding,
    already_confirmed: result.alreadyExisted,
  });
}
