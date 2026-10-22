/**
 * `/api/participants/me` — start point and profile (Task 11).
 *
 * Every endpoint here is scoped to ONE event, because a person is a
 * `participant` per event, not a global profile: the same user can have a
 * different name, travel budget and start point in two different events.
 *
 * ★ DELETING A START POINT LEAVES EVERYTHING ELSE ALONE (FR-8.21).
 *
 * Not a participant row, not a vote. The ranking later reports reduced coverage
 * instead. Cascading would punish the participant for using the privacy control
 * the product promised them.
 */

import { ParticipantPatchSchema, StartPointSchema } from '@/src/types/event';

import {
  callerIdFrom,
  isUuid,
  json,
  readJsonBody,
  validationFailed,
  wireError,
} from '../lib/http';
import {
  deleteStartPoint,
  patchParticipant,
  setStartPoint,
  startPointAudience,
} from '../lib/participant-service';
import { limiters } from '../lib/rate-limit';
import { resolveCaller, type Caller } from '../lib/supabase';

/** The caller, or `null` when the request carries no usable identity. */
async function callerFrom(request: Request): Promise<Caller | null> {
  const userId = callerIdFrom(request);
  if (!userId || !isUuid(userId)) return null;

  return resolveCaller(userId);
}

/**
 * Applies the mutating budgets, per participant and per event.
 *
 * Both are checked: one participant has a personal ceiling, and one event has a
 * ceiling that a single participant cannot consume on behalf of everyone.
 */
function withinMutationLimits(caller: Caller, eventId: string): boolean {
  const perParticipant = limiters.mutationByParticipant.check(`mutate:${caller.userId}`);
  const perEvent = limiters.mutationByEvent.check(`mutate:${eventId}`);

  return perParticipant.allowed && perEvent.allowed;
}

/** The `event_id` this write applies to — from the query string or the body. */
function eventIdFrom(request: Request, body: Record<string, unknown> | null): string | null {
  const fromQuery = new URL(request.url).searchParams.get('event_id');
  if (fromQuery && isUuid(fromQuery)) return fromQuery;

  const fromBody = body?.event_id;
  if (typeof fromBody === 'string' && isUuid(fromBody)) return fromBody;

  return null;
}

/** `PUT /api/participants/me/start-point` */
export async function setStartPointHandler(request: Request): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return wireError('NOT_PARTICIPANT');

  const body = await readJsonBody(request);
  if (!body) return validationFailed([{ path: [], message: 'errors.validationFailed' }]);

  const eventId = eventIdFrom(request, body);
  if (!eventId) return validationFailed([{ path: ['event_id'], message: 'errors.validationFailed' }]);

  if (!withinMutationLimits(caller, eventId)) return wireError('RATE_LIMITED');

  const parsed = StartPointSchema.safeParse(body);
  if (!parsed.success) return validationFailed(parsed.error.issues);

  const written = await setStartPoint(caller, eventId, parsed.data);
  if (!written.ok) return wireError(written.reason);

  // The audience and expiry shown after adding (FR-8.9). Read after the write,
  // so the count includes this participant.
  const audience = await startPointAudience(caller, eventId);

  return json({
    start_point: written.start_point,
    audience: audience
      ? { participant_count: audience.participant_count, expires_at: audience.event_end }
      : null,
  });
}

/** `DELETE /api/participants/me/start-point?event_id=` */
export async function deleteStartPointHandler(request: Request): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return wireError('NOT_PARTICIPANT');

  const eventId = eventIdFrom(request, null);
  if (!eventId) return validationFailed([{ path: ['event_id'], message: 'errors.validationFailed' }]);

  if (!withinMutationLimits(caller, eventId)) return wireError('RATE_LIMITED');

  const removed = await deleteStartPoint(caller, eventId);
  if (!removed.ok) return wireError(removed.reason);

  return json({ deleted: true });
}

/** `PATCH /api/participants/me` */
export async function patchParticipantHandler(request: Request): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return wireError('NOT_PARTICIPANT');

  const body = await readJsonBody(request);
  if (!body) return validationFailed([{ path: [], message: 'errors.validationFailed' }]);

  const eventId = eventIdFrom(request, body);
  if (!eventId) return validationFailed([{ path: ['event_id'], message: 'errors.validationFailed' }]);

  if (!withinMutationLimits(caller, eventId)) return wireError('RATE_LIMITED');

  const parsed = ParticipantPatchSchema.safeParse(body);
  if (!parsed.success) return validationFailed(parsed.error.issues);

  const patched = await patchParticipant(caller, eventId, parsed.data);
  if (!patched.ok) return wireError(patched.reason);

  return json({ participant: patched.participant });
}
