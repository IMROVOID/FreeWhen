/**
 * `/api/events/:id/proposals` and `/api/proposals/:id` (Plan 06 Tasks 5, 6).
 *
 * ★ SLOT VALIDATION RUNS HERE, AGAINST THE SERVER'S CLOCK.
 *
 * A client clock set back a day would otherwise let a slot that has already
 * passed be stored as future — and the participant who arrives for it finds an
 * empty room. `validateSlot` is given `new Date()` from this process, never a
 * timestamp the request carried.
 *
 * ★ ERRORS ARE FIELD-SPECIFIC CATALOGUE KEYS.
 *
 * Each rejection names the field and the key, so the screen renders «این زمان
 * گذشته است» inline under the picker, in whichever language the user chose.
 * A generic 422 body is a message the user cannot act on.
 */

import { ProposalCreateSchema, ProposalPatchSchema, VALIDATION } from '@/src/types/proposal';
import { findDuplicatePlace } from '@/src/features/proposals/services/duplicates';
import { validateSlot } from '@/src/features/proposals/services/slot-validation';

import { track } from '../lib/funnel';
import {
  callerIdFrom,
  isUuid,
  json,
  readJsonBody,
  validationFailed,
  wireError,
} from '../lib/http';
import {
  createProposal,
  editProposal,
  eventForParticipant,
  listProposals,
  proposalForEdit,
  withdrawProposal,
} from '../lib/proposal-service';
import { limiters } from '../lib/rate-limit';
import { resolveCaller, type Caller } from '../lib/supabase';

/** The caller, or `null` when the request carries no usable identity. */
async function callerFrom(request: Request): Promise<Caller | null> {
  const userId = callerIdFrom(request);
  if (!userId || !isUuid(userId)) return null;

  return resolveCaller(userId);
}

/** `GET /api/events/:id/proposals` */
export async function listProposalsHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return wireError('NOT_PARTICIPANT');

  const eventId = params.id ?? '';
  if (!isUuid(eventId)) return wireError('NOT_PARTICIPANT');

  const event = await eventForParticipant(caller, eventId);
  if (!event) return wireError('NOT_PARTICIPANT');

  return json({ proposals: await listProposals(eventId), event });
}

/**
 * `POST /api/events/:id/proposals`
 *
 * Returns the created proposal plus a `duplicate` hint. The hint is data: the
 * response is a 201 whatever it holds, because duplicate detection never blocks
 * (FR-2.7).
 */
export async function createProposalHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return wireError('NOT_PARTICIPANT');

  const eventId = params.id ?? '';
  if (!isUuid(eventId)) return wireError('NOT_PARTICIPANT');

  const event = await eventForParticipant(caller, eventId);
  if (!event) return wireError('NOT_PARTICIPANT');

  const perParticipant = limiters.mutationByParticipant.check(`proposal:${caller.userId}`);
  const perEvent = limiters.mutationByEvent.check(`proposal:${eventId}`);
  if (!perParticipant.allowed || !perEvent.allowed) return wireError('RATE_LIMITED');

  const body = await readJsonBody(request);
  if (!body) return validationFailed([{ path: [], message: 'errors.validationFailed' }]);

  const parsed = ProposalCreateSchema.safeParse(body);
  if (!parsed.success) return validationFailed(parsed.error.issues);

  // Server-side, against server UTC, in the event's own zone.
  const slotErrors = validateSlot(
    parsed.data.start_utc ?? null,
    parsed.data.end_utc ?? null,
    { start: event.window_start, end: event.window_end },
    new Date(),
    event.home_tz,
  );
  if (slotErrors.length > 0) {
    return validationFailed(
      slotErrors.map((error) => ({ path: [error.field], message: error.messageKey })),
    );
  }

  const { proposal, isLate } = await createProposal(caller, eventId, parsed.data);

  // The hint is computed AFTER the insert so it can see the row just written;
  // the proposal's own id is excluded so it never matches itself.
  const others = (await listProposals(eventId)).filter((item) => item.id !== proposal.id);
  const duplicate = proposal.venue
    ? findDuplicatePlace(
        {
          name: proposal.venue.name,
          lat: proposal.venue.lat,
          lng: proposal.venue.lng,
          providerPlaceId: proposal.venue.provider_place_id,
        },
        others,
      )
    : null;

  const countAfter = others.length + 1;

  track('proposal_created', {
    event_id: eventId,
    type: proposal.type,
    is_after_voting_started: isLate,
    proposal_count_after: countAfter,
  });

  if (proposal.start_utc !== null) {
    track('time_proposal_created', {
      event_id: eventId,
      home_tz: event.home_tz,
      is_after_voting_started: isLate,
    });
  }

  return json({ proposal, duplicate, is_late: isLate }, 201);
}

/**
 * `PATCH /api/proposals/:id`
 *
 * The author or the organizer may edit, and only while the event is not
 * `CONFIRMED`. A confirmed decision references a proposal row, so silently
 * changing its time would make the Decision Card describe something that is no
 * longer on offer.
 */
export async function patchProposalHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return wireError('NOT_PARTICIPANT');

  const proposalId = params.id ?? '';
  if (!isUuid(proposalId)) return wireError('NOT_PARTICIPANT');

  const found = await proposalForEdit(caller, proposalId);
  if (!found) return wireError('NOT_PARTICIPANT');

  if (!found.isAuthor && !found.isOrganizer) return wireError('NOT_ORGANIZER');

  // ★ A CONFIRMED DECISION LOCKS ITS PROPOSALS.
  //
  // The decision row references this proposal by id. Allowing an edit now would
  // leave the Decision Card describing a time or a place that is no longer what
  // the group agreed to — the card would be lying, and quietly.
  if (found.eventStatus === 'CONFIRMED') {
    return wireError('VALIDATION_FAILED', { fields: { _: VALIDATION.lockedConfirmed } });
  }

  const body = await readJsonBody(request);
  if (!body) return validationFailed([{ path: [], message: 'errors.validationFailed' }]);

  const parsed = ProposalPatchSchema.safeParse(body);
  if (!parsed.success) return validationFailed(parsed.error.issues);

  const event = await eventForParticipant(caller, found.proposal.event_id);
  if (!event) return wireError('NOT_PARTICIPANT');

  // The slot may have moved, so it is re-validated against the server clock.
  const slotErrors = validateSlot(
    parsed.data.start_utc ?? null,
    parsed.data.end_utc ?? null,
    { start: event.window_start, end: event.window_end },
    new Date(),
    event.home_tz,
  );
  if (slotErrors.length > 0) {
    return validationFailed(
      slotErrors.map((error) => ({ path: [error.field], message: error.messageKey })),
    );
  }

  return json({ proposal: await editProposal(proposalId, parsed.data) });
}

/**
 * `DELETE /api/proposals/:id` — withdraw.
 *
 * A status change, not a row delete. The response is a 200 carrying the
 * withdrawn proposal, because the row still exists and the client needs it to
 * render the struck-through card.
 */
export async function withdrawProposalHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return wireError('NOT_PARTICIPANT');

  const proposalId = params.id ?? '';
  if (!isUuid(proposalId)) return wireError('NOT_PARTICIPANT');

  const found = await proposalForEdit(caller, proposalId);
  if (!found) return wireError('NOT_PARTICIPANT');

  // Author or organizer only. Anyone else gets the same answer as a stranger.
  if (!found.isAuthor && !found.isOrganizer) return wireError('NOT_ORGANIZER');

  if (found.eventStatus === 'CONFIRMED') {
    return wireError('VALIDATION_FAILED', { fields: { _: VALIDATION.lockedConfirmed } });
  }

  return json({ proposal: await withdrawProposal(proposalId) });
}
