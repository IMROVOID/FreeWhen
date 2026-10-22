/**
 * `GET /api/events/:id/decision-status` (Plan 07 Task 4).
 *
 * ★ ONE REQUEST FOR THE WHOLE STATUS AREA.
 *
 * The area shows the tally for every proposal, who has not answered, and what
 * is leading. A screen that fetched per card would issue one request per
 * proposal on every 10-second poll, and the poll is the guarantee the socket
 * cannot replace (REALTIME_FALLBACK).
 *
 * ★ THE PAYLOAD CARRIES NO DERIVED STATUS AND NO RENDERED TEXT.
 *
 * `LEADING` / `ELIMINATED` are computed on the client with `deriveStatus`, from
 * the tally and the ranking the same client already holds — storing or shipping
 * them would create the second source of truth the phase exists to prevent. And
 * every reason travels as `{templateId, params}` so the same response renders in
 * either language.
 */

import { track } from '../lib/funnel';
import { callerIdFrom, isUuid, json, wireError } from '../lib/http';
import { resolveCaller, type Caller } from '../lib/supabase';
import { loadDecisionStatus } from '../lib/vote-service';

async function callerFrom(request: Request): Promise<Caller | null> {
  const userId = callerIdFrom(request);
  if (!userId || !isUuid(userId)) return null;

  return resolveCaller(userId);
}

export async function decisionStatusHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return wireError('NOT_PARTICIPANT');

  const eventId = params.id ?? '';
  if (!isUuid(eventId)) return wireError('NOT_PARTICIPANT');

  const status = await loadDecisionStatus(caller, eventId);
  if (!status) return wireError('NOT_PARTICIPANT');

  const url = new URL(request.url);
  // The client sends the moment its status area mounted, so the metric
  // measures how fast the area became actionable rather than how long the app
  // had been warm.
  const openedAt = url.searchParams.get('opened_at');
  const opened = openedAt ? Date.parse(openedAt) : Number.NaN;

  track('decision_status_viewed', {
    event_id: eventId,
    proposal_count: status.proposals.length,
    unanswered_total: status.proposals.reduce(
      (sum, entry) => sum + entry.tally.unanswered,
      0,
    ),
    seconds_since_open: Number.isFinite(opened)
      ? Math.max(0, Math.round((Date.now() - opened) / 1000))
      : null,
  });

  return json(status);
}
