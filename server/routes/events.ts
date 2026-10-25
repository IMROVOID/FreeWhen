/**
 * `/api/events` — creation, the S1 list, and the invite lifecycle (Tasks 3, 6, 8).
 *
 * ★ THE PLAINTEXT INVITE URL IS RETURNED EXACTLY ONCE.
 *
 * It is not persisted, not re-derivable and not retrievable. A lost response
 * means the organizer rotates — which is the designed recovery, not a
 * limitation: a server that can hand the link back is a server that can leak a
 * live credential to anyone who asks as the organizer.
 *
 * ★ CREATING AN EVENT NEEDS NO ACCOUNT (FR-1.3).
 *
 * A request with no identity gets an anonymous one minted on the spot. The only
 * reason this is rate-limited per address is that identity creation is a write,
 * and an unmetered write is an abuse surface (FR-8.35).
 */

import { EventCreateSchema } from '@/src/types/event';

import {
  createEvent,
  deleteEvent,
  getEventFor,
  leaveEvent,
  listMyEvents,
  removeParticipant,
  renameEvent,
} from '../lib/event-service';
import { track } from '../lib/funnel';
import {
  callerIdFrom,
  isUuid,
  json,
  publicBaseUrl,
  readJsonBody,
  validationFailed,
  wireError,
} from '../lib/http';
import { issueInvite, revokeInvite } from '../lib/invite-service';
import { clientIp, limiters } from '../lib/rate-limit';
import { createAnonymousUser, resolveCaller, type Caller } from '../lib/supabase';

/** Echoes the effective identity, so a client that minted one can store it. */
function withIdentity(response: Response, userId: string): Response {
  const headers = new Headers(response.headers);
  headers.set('x-user-id', userId);

  return new Response(response.body, { status: response.status, headers });
}

/**
 * The caller, minting an anonymous identity when there is none.
 *
 * Returns `null` only when the address has exhausted its identity budget — in
 * which case the caller is told nothing about why, because the bucket is an
 * anti-abuse control and not a status the client can act on.
 */
async function callerOrCreate(request: Request): Promise<Caller | null> {
  const existing = callerIdFrom(request);
  if (existing && isUuid(existing)) {
    const caller = await resolveCaller(existing);
    if (caller) return caller;
  }

  const limited = limiters.signInByIp.check(`signin:${clientIp(request.headers)}`);
  if (!limited.allowed) return null;

  const userId = await createAnonymousUser();
  const caller = await resolveCaller(userId);
  if (!caller) throw new Error('a freshly created identity could not be resolved');

  return caller;
}

/** `POST /api/events` */
export async function createEventHandler(request: Request): Promise<Response> {
  const caller = await callerOrCreate(request);
  if (!caller) return wireError('RATE_LIMITED');

  const body = await readJsonBody(request);
  if (!body) return validationFailed([{ path: [], message: 'errors.validationFailed' }]);

  const parsed = EventCreateSchema.safeParse(body);
  if (!parsed.success) return validationFailed(parsed.error.issues);

  const created = await createEvent(caller, parsed.data);

  const issued = await issueInvite(caller, created.event.id, publicBaseUrl(request));
  if (!issued.ok) {
    // `createEvent` just wrote the event as `created_by = caller`, so a
    // non-organizer outcome here is impossible unless the row vanished.
    return wireError('NOT_ORGANIZER');
  }

  // Re-read so the returned status reflects the DRAFT → OPEN transition.
  const event = (await getEventFor(caller, created.event.id)) ?? created.event;

  track('event_created', {
    activity_type: event.activity_type,
    has_deadline: event.voting_deadline !== null,
    participant_count: event.participant_count,
  });
  // Event id only — the URL that follows is never logged (FR-1.8).
  track('invite_link_generated', { event_id: event.id });

  return withIdentity(
    json(
      {
        event,
        participant: created.participant,
        invite: issued.invite,
        user_id: caller.userId,
      },
      201,
    ),
    caller.userId,
  );
}

/** `GET /api/events` — S1. */
export async function listEventsHandler(request: Request): Promise<Response> {  const userId = callerIdFrom(request);

  const caller = userId && isUuid(userId) ? await resolveCaller(userId) : null;
  if (!caller) return wireError('NOT_PARTICIPANT');

  const events = await listMyEvents(caller);

  return withIdentity(json({ events }), caller.userId);
}

/** `POST /api/events/:id/invite/rotate` */
export async function rotateInviteHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const userId = callerIdFrom(request);
  const caller = userId && isUuid(userId) ? await resolveCaller(userId) : null;
  if (!caller) return wireError('NOT_PARTICIPANT');

  const eventId = params.id ?? '';
  if (!isUuid(eventId)) return wireError('NOT_ORGANIZER');

  const issued = await issueInvite(caller, eventId, publicBaseUrl(request));
  // An unknown event and an event owned by someone else answer identically:
  // `NOT_ORGANIZER` for both. Telling a stranger that an id exists is the
  // first half of an enumeration.
  if (!issued.ok) return wireError('NOT_ORGANIZER');

  track('invite_link_generated', { event_id: eventId });

  return withIdentity(json({ invite: issued.invite }), caller.userId);
}

/** `DELETE /api/events/:id/invite` */
export async function revokeInviteHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const userId = callerIdFrom(request);
  const caller = userId && isUuid(userId) ? await resolveCaller(userId) : null;
  if (!caller) return wireError('NOT_PARTICIPANT');

  const eventId = params.id ?? '';
  if (!isUuid(eventId)) return wireError('NOT_ORGANIZER');

  const revoked = await revokeInvite(caller, eventId);
  if (!revoked.ok) return wireError('NOT_ORGANIZER');

  return withIdentity(json({ revoked: true }), caller.userId);
}

/** `GET /api/events/:id` — the event shell (Phase 6 fills the body). */
export async function getEventHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const userId = callerIdFrom(request);
  const caller = userId && isUuid(userId) ? await resolveCaller(userId) : null;
  if (!caller) return wireError('NOT_PARTICIPANT');

  const eventId = params.id ?? '';
  if (!isUuid(eventId)) return wireError('NOT_PARTICIPANT');

  const event = await getEventFor(caller, eventId, publicBaseUrl(request));

  // A non-participant and a nonexistent event answer identically: the read
  // policy is `is_event_participant()`, so an id that is not yours does not
  // exist as far as this endpoint is concerned.
  if (!event) return wireError('NOT_PARTICIPANT');

  return withIdentity(json({ event }), caller.userId);
}

/** `PATCH /api/events/:id` — rename the event */
export async function patchEventHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const userId = callerIdFrom(request);
  const caller = userId && isUuid(userId) ? await resolveCaller(userId) : null;
  if (!caller) return wireError('NOT_PARTICIPANT');

  const eventId = params.id ?? '';
  if (!isUuid(eventId)) return wireError('NOT_PARTICIPANT');

  const body = await readJsonBody(request);
  if (!body || typeof body.title !== 'string') {
    return validationFailed([{ path: ['title'], message: 'events.validation.titleRequired' }]);
  }

  const title = body.title.trim();
  if (title.length === 0) {
    return validationFailed([{ path: ['title'], message: 'events.validation.titleRequired' }]);
  }
  if (title.length > 80) {
    return validationFailed([{ path: ['title'], message: 'events.validation.titleTooLong' }]);
  }

  const updated = await renameEvent(caller, eventId, title, publicBaseUrl(request));
  if (!updated) return wireError('NOT_ORGANIZER');

  return withIdentity(json({ event: updated }), caller.userId);
}

/** `DELETE /api/events/:id` — delete event */
export async function deleteEventHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const userId = callerIdFrom(request);
  const caller = userId && isUuid(userId) ? await resolveCaller(userId) : null;
  if (!caller) return wireError('NOT_PARTICIPANT');

  const eventId = params.id ?? '';
  if (!isUuid(eventId)) return wireError('NOT_PARTICIPANT');

  const deleted = await deleteEvent(caller, eventId);
  if (!deleted) return wireError('NOT_ORGANIZER');

  return withIdentity(json({ deleted: true }), caller.userId);
}

/** `DELETE /api/events/:id/participants/:participantId` */
export async function removeParticipantHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const userId = callerIdFrom(request);
  const caller = userId && isUuid(userId) ? await resolveCaller(userId) : null;
  if (!caller) return wireError('NOT_PARTICIPANT');

  const eventId = params.id ?? '';
  const participantId = params.participantId ?? '';
  if (!isUuid(eventId) || !isUuid(participantId)) return wireError('NOT_PARTICIPANT');

  const outcome = await removeParticipant(caller, eventId, participantId);
  if (!outcome.ok) {
    if (outcome.reason === 'NOT_ORGANIZER') return wireError('NOT_ORGANIZER');
    return validationFailed([{ path: ['participantId'], message: 'errors.cannotRemoveSelf' }]);
  }

  return withIdentity(json({ removed: true }), caller.userId);
}

/** `POST /api/events/:id/leave` */
export async function leaveEventHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const userId = callerIdFrom(request);
  const caller = userId && isUuid(userId) ? await resolveCaller(userId) : null;
  if (!caller) return wireError('NOT_PARTICIPANT');

  const eventId = params.id ?? '';
  if (!isUuid(eventId)) return wireError('NOT_PARTICIPANT');

  const outcome = await leaveEvent(caller, eventId);
  if (!outcome.ok) {
    if (outcome.reason === 'IS_ORGANIZER') {
      return validationFailed([{ path: ['role'], message: 'errors.organizerCannotLeave' }]);
    }
    return wireError('NOT_PARTICIPANT');
  }

  return withIdentity(json({ left: true }), caller.userId);
}