/**
 * `POST /api/events/:id/reopen` (Plan 14 Task 2, PRD-02 FR-2.22, AC-2.6.1).
 *
 * ★ THE REASON IS THE POINT OF THIS ENDPOINT (AC-2.6.1).
 *
 * An empty reason is rejected here and re-checked in the service, because the
 * reason is what separates a legitimate reopening — the wrong night was
 * confirmed, the venue closed — from chaos. The banner then shows it to every
 * participant, so the group learns why their decision moved rather than just
 * watching it move.
 *
 * ★ REOPENING PRESERVES HISTORY (FR-2.22).
 *
 * The decision row survives with `reopened_at` set. The partial unique index
 * allows a new live decision beside it, so the group can see that a decision was
 * made and then revisited.
 */

import { REASON_MAX_CHARS, REASON_MIN_CHARS, reopenEvent } from '../lib/reopen-service';
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
import { eventForParticipant } from '../lib/proposal-service';
import { resolveCaller, type Caller } from '../lib/supabase';

/** The catalogue keys the screen renders under the reason field. */
export const REASON_EMPTY_KEY = 'reopen.validation.reasonRequired';
export const REASON_TOO_LONG_KEY = 'reopen.validation.reasonTooLong';

async function callerFrom(request: Request): Promise<Caller | null> {
  const userId = callerIdFrom(request);
  if (!userId || !isUuid(userId)) return null;

  return resolveCaller(userId);
}

/**
 * `POST /api/events/:id/reopen`
 *
 * Body: `{ reason: string }`. Response: `{ event_status, reopened_proposals }`.
 */
export async function reopenHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return wireError('NOT_PARTICIPANT');

  const eventId = params.id ?? '';
  if (!isUuid(eventId)) return wireError('NOT_PARTICIPANT');

  const event = await eventForParticipant(caller, eventId);
  if (!event) return wireError('NOT_PARTICIPANT');

  const budget = limiters.mutationByParticipant.check(`reopen:${caller.userId}`);
  if (!budget.allowed) return wireError('RATE_LIMITED');

  const body = await readJsonBody(request);
  if (!body) return validationFailed([{ path: [], message: 'errors.validationFailed' }]);

  const reason = body.reason;
  if (typeof reason !== 'string') {
    return validationFailed([{ path: ['reason'], message: REASON_EMPTY_KEY }]);
  }

  // ★ BOTH BOUNDS ARE CHECKED BEFORE THE SERVICE, SO THE FIELD EXPLAINS ITSELF.
  //
  // The service refuses too — it has to, because it is also reachable from a job
  // later — but a 422 carrying the catalogue key is what lets the sheet put the
  // message under the textarea instead of showing a generic failure.
  if (reason.trim().length < REASON_MIN_CHARS) {
    return validationFailed([{ path: ['reason'], message: REASON_EMPTY_KEY }]);
  }
  if (reason.length > REASON_MAX_CHARS) {
    return validationFailed([{ path: ['reason'], message: REASON_TOO_LONG_KEY }]);
  }

  const outcome = await reopenEvent(caller, eventId, reason);

  switch (outcome.status) {
    case 'NOT_PARTICIPANT':
      return wireError('NOT_PARTICIPANT');
    case 'NOT_ORGANIZER':
      return wireError('NOT_ORGANIZER');
    case 'EMPTY_REASON':
      return validationFailed([{ path: ['reason'], message: REASON_EMPTY_KEY }]);
    case 'NO_LIVE_DECISION':
      // ★ NOTHING TO REOPEN IS A STATE, NOT A FAILURE.
      //
      // The organizer arrived after somebody else reopened, or the event was
      // never confirmed. The screen already shows the current status, so a 409
      // here would report a failure for a situation that is already correct.
      return json({ event_status: 'DECIDING', reopened_proposals: [], already_reopened: true });
    case 'REOPENED':
      track('decision_reopened', {
        event_id: eventId,
        reopened_count: outcome.reopenedProposals.length,
      });

      return json({
        event_status: 'DECIDING',
        reopened_proposals: outcome.reopenedProposals,
        already_reopened: false,
      });
  }
}
