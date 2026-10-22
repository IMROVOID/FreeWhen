/**
 * `GET /api/events/:id/activity` (Plan 07 Task 11).
 *
 * ★ ACTIONS ONLY, NEVER COORDINATES (FR-8.44).
 *
 * The log is participant-visible, so a coordinate written here would be a
 * privacy leak with an audit trail behind it. Every `detail` payload is enum
 * tokens and numbers — `{"from":"maybe","to":"yes"}` — which is also what lets
 * the screen render a line in either language instead of replaying whichever
 * one it happened to be written in.
 *
 * ★ IT ANSWERS PAIN POINTS 2 AND 4 DIRECTLY.
 *
 * "Nobody knows who agreed to what" and "old decisions get reopened with no
 * clear record" are both questions about history. An append-only list of who
 * proposed, who changed their vote, and who confirmed is the whole answer.
 */

import { callerIdFrom, isUuid, json, wireError } from '../lib/http';
import { resolveCaller, type Caller } from '../lib/supabase';
import { eventForParticipant, listActivity } from '../lib/vote-service';

/** The page size ceiling, so one request cannot ask for the whole trail. */
const MAX_LIMIT = 200;

async function callerFrom(request: Request): Promise<Caller | null> {
  const userId = callerIdFrom(request);
  if (!userId || !isUuid(userId)) return null;

  return resolveCaller(userId);
}

export async function activityHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return wireError('NOT_PARTICIPANT');

  const eventId = params.id ?? '';
  if (!isUuid(eventId)) return wireError('NOT_PARTICIPANT');

  const event = await eventForParticipant(caller, eventId);
  if (!event) return wireError('NOT_PARTICIPANT');

  const requested = Number(new URL(request.url).searchParams.get('limit') ?? 100);
  const limit = Number.isFinite(requested)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(requested)))
    : 100;

  return json({ activity: await listActivity(eventId, limit) });
}
