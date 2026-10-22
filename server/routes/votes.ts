/**
 * `PUT /api/proposals/:id/vote` (Plan 07 Task 2).
 *
 * ★ THIS ROUTE IS AN UPSERT, NOT A CREATE-OR-UPDATE DECISION.
 *
 * The write itself lives in `castVote`, which issues a single
 * `insert ... on conflict do update`. Nothing here reads the old vote and then
 * decides what to write — two concurrent changes from one participant would
 * both read the same old row and the second write would silently double-count
 * (PRD-02 §13.3).
 *
 * ★ VOTING REQUIRES NO LOCATION AND NO TRAVEL DATA (FR-2.14, AC-2.1.1).
 *
 * Nothing on this path reads `start_point`. That is a property of the absence of
 * a query rather than of a conditional a later change could invert — a
 * participant who declined location still votes on everything.
 */

import { CastVoteSchema, VOTE_VALIDATION } from '@/src/types/vote';

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
import { castVote, eventForParticipant, proposalGuard } from '../lib/vote-service';

/** The caller, or `null` when the request carries no usable identity. */
async function callerFrom(request: Request): Promise<Caller | null> {
  const userId = callerIdFrom(request);
  if (!userId || !isUuid(userId)) return null;

  return resolveCaller(userId);
}

/** The `openedAt` hint the client sends, for `seconds_since_event_open`. */
function secondsSince(eventOpenedAt: unknown): number | null {
  if (typeof eventOpenedAt !== 'string') return null;

  const opened = Date.parse(eventOpenedAt);
  if (!Number.isFinite(opened)) return null;

  // Clamped at zero: a device clock ahead of the server would otherwise
  // average a negative duration into the metric.
  return Math.max(0, Math.round((Date.now() - opened) / 1000));
}

export async function castVoteHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return wireError('NOT_PARTICIPANT');

  const proposalId = params.id ?? '';
  if (!isUuid(proposalId)) return wireError('NOT_PARTICIPANT');

  const guard = await proposalGuard(proposalId);
  if (!guard) return wireError('NOT_PARTICIPANT');

  const event = await eventForParticipant(caller, guard.eventId);
  if (!event) return wireError('NOT_PARTICIPANT');

  const budget = limiters.mutationByParticipant.check(`vote:${caller.userId}`);
  if (!budget.allowed) return wireError('RATE_LIMITED');

  const body = await readJsonBody(request);
  if (!body) return validationFailed([{ path: [], message: 'errors.validationFailed' }]);

  const parsed = CastVoteSchema.safeParse(body);
  if (!parsed.success) return validationFailed(parsed.error.issues);

  // ★ A WITHDRAWN PROPOSAL REFUSES A VOTE (E7).
  //
  // The client reverted optimistically and refetches on this rejection, which
  // is what stops a phantom vote appearing on a card nobody can vote on any
  // more. Refusing here rather than filtering at tally time keeps the stored
  // history honest: the vote was never recorded, so nothing needs ignoring.
  if (guard.status === 'WITHDRAWN') {
    return validationFailed([{ path: ['value'], message: VOTE_VALIDATION.proposalWithdrawn }]);
  }

  // ★ A CONFIRMED EVENT IS LOCKED.
  //
  // The decision row already names a proposal; a vote arriving afterwards
  // could not change it and would make the tally disagree with the card.
  if (guard.eventStatus === 'CONFIRMED') {
    return validationFailed([{ path: ['value'], message: VOTE_VALIDATION.eventConfirmed }]);
  }

  const result = await castVote(
    caller,
    proposalId,
    parsed.data.value,
    parsed.data.is_dealbreaker ?? false,
  );
  if (!result) return wireError('NOT_PARTICIPANT');

  track('vote_cast', {
    event_id: guard.eventId,
    proposal_id: proposalId,
    value: parsed.data.value,
    is_change: result.isChange,
    seconds_since_event_open: secondsSince(body.opened_at),
  });

  return json({
    vote: result.vote,
    previous: result.previous,
    is_change: result.isChange,
  });
}
