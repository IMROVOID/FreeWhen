/**
 * The route table (Plan 05 Tasks 3–5, 11).
 *
 * ★ HANDLERS ARE `Request => Response`.
 *
 * No framework, no server object. The whole API is a pure function of a
 * standard `Request`, which means the database tests exercise the REAL routing,
 * validation and error envelopes in-process — not a copy of them behind a
 * hand-built HTTP client that could pass while the server is broken.
 *
 * `server/index.ts` adapts `node:http` to this function and does nothing else.
 */

import { healthHandler } from './routes/health';
import {
  createEventHandler,
  getEventHandler,
  listEventsHandler,
  revokeInviteHandler,
  rotateInviteHandler,
} from './routes/events';
import { deleteAccountHandler } from './routes/account';
import { joinInviteHandler, resolveInviteHandler } from './routes/invite';
import { placeSearchHandler } from './routes/place-search';
import {
  deleteStartPointHandler,
  listParticipantsHandler,
  patchParticipantHandler,
  setStartPointHandler,
  setVisibilityHandler,
} from './routes/participants';
import {
  createProposalHandler,
  listProposalsHandler,
  patchProposalHandler,
  withdrawProposalHandler,
} from './routes/proposals';
// Phase 7 — voting and the decision (PRD-02 §4.2–§4.6).
import { activityHandler } from './routes/activity';
import { confirmHandler } from './routes/confirm';
import { decisionStatusHandler } from './routes/decision-status';
import { castVoteHandler } from './routes/votes';
// Phase 10 — follow-through (PRD-06 §3, §6).
import { getRsvpHandler, putRsvpHandler } from './routes/rsvp';
import { notificationsHandler } from './routes/notifications';
import { statusUpdateHandler } from './routes/status-update';
import { nudgeHandler } from './routes/nudge';
// Phase 14 — the P1 backlog (PRD-07 chat parser, PRD-02 reopening).
import { parseHandler } from './routes/parse';
import { reopenHandler } from './routes/reopen';
// Phase 14 — per-proposal comments (PRD-02 §4.3). Scoped to a proposal on
// purpose: an event-wide sibling would trigger Apple §1.2's UGC obligations.
import {
  createCommentHandler,
  deleteCommentHandler,
  listCommentsHandler,
} from './routes/comments';
// D23 — the in-room chat surface (PRD-06 FR-6.7b).
import {
  listMessagesHandler,
  postMessageHandler,
  reportMessageHandler,
} from './routes/messages';

type Handler = (request: Request, params: Record<string, string>) => Promise<Response>;

interface Route {
  method: string;
  /** Segments; `:name` captures. */
  segments: string[];
  handler: Handler;
}

const ROUTES: Route[] = [
  // Two paths, one handler. Caddy routes the bare `/health` (a proxy's probe
  // wants a short path); the API routes `/api/health` (an operator curls what
  // the app calls). A deployment where those two disagree is a deployment
  // whose uptime check and proxy health check are measuring different things.
  { method: 'GET', segments: ['health'], handler: healthHandler },
  { method: 'GET', segments: ['api', 'health'], handler: healthHandler },
  { method: 'POST', segments: ['api', 'events'], handler: createEventHandler },
  { method: 'GET', segments: ['api', 'events'], handler: listEventsHandler },
  { method: 'GET', segments: ['api', 'events', ':id'], handler: getEventHandler },
  { method: 'POST', segments: ['api', 'events', ':id', 'invite', 'rotate'], handler: rotateInviteHandler },
  { method: 'DELETE', segments: ['api', 'events', ':id', 'invite'], handler: revokeInviteHandler },
  { method: 'GET', segments: ['api', 'invite', ':token'], handler: resolveInviteHandler },
  { method: 'POST', segments: ['api', 'invite', ':token', 'join'], handler: joinInviteHandler },
  {
    method: 'PUT',
    segments: ['api', 'participants', 'me', 'start-point'],
    handler: setStartPointHandler,
  },
  {
    method: 'DELETE',
    segments: ['api', 'participants', 'me', 'start-point'],
    handler: deleteStartPointHandler,
  },
  { method: 'PATCH', segments: ['api', 'participants', 'me'], handler: patchParticipantHandler },
  // Phase 6 — proposals (PRD-02 §4.1).
  { method: 'GET', segments: ['api', 'events', ':id', 'proposals'], handler: listProposalsHandler },
  { method: 'POST', segments: ['api', 'events', ':id', 'proposals'], handler: createProposalHandler },
  { method: 'PATCH', segments: ['api', 'proposals', ':id'], handler: patchProposalHandler },
  // Withdrawal is a status change, but DELETE is the verb a client expects and
  // the handler documents why the row survives.
  { method: 'DELETE', segments: ['api', 'proposals', ':id'], handler: withdrawProposalHandler },
  // Phase 6 — server-mediated place search (PRD-04 §4.5, PRD-10 D9).
  { method: 'GET', segments: ['api', 'place-search'], handler: placeSearchHandler },
  // Phase 7 — voting, the Decision Status area, confirmation and the log.
  { method: 'PUT', segments: ['api', 'proposals', ':id', 'vote'], handler: castVoteHandler },
  {
    method: 'GET',
    segments: ['api', 'events', ':id', 'decision-status'],
    handler: decisionStatusHandler,
  },
  { method: 'POST', segments: ['api', 'events', ':id', 'confirm'], handler: confirmHandler },
  { method: 'GET', segments: ['api', 'events', ':id', 'activity'], handler: activityHandler },
  // Phase 9 — in-app account deletion (Apple §5.1.1(v), PRD-08 B5).
  { method: 'DELETE', segments: ['api', 'account'], handler: deleteAccountHandler },
  // Phase 9 — per-participant visibility and the S13 audience list (FR-8.18).
  {
    method: 'PUT',
    segments: ['api', 'participants', ':id', 'visibility'],
    handler: setVisibilityHandler,
  },
  {
    method: 'GET',
    segments: ['api', 'events', ':id', 'participants'],
    handler: listParticipantsHandler,
  },
  // Phase 10 — RSVP after confirmation, the notification gate, running late
  // and the organizer's nudge.
  { method: 'GET', segments: ['api', 'events', ':id', 'rsvp'], handler: getRsvpHandler },
  { method: 'PUT', segments: ['api', 'events', ':id', 'rsvp'], handler: putRsvpHandler },
  {
    method: 'POST',
    segments: ['api', 'events', ':id', 'notifications'],
    handler: notificationsHandler,
  },
  {
    method: 'POST',
    segments: ['api', 'events', ':id', 'status-update'],
    handler: statusUpdateHandler,
  },
  { method: 'POST', segments: ['api', 'events', ':id', 'nudge'], handler: nudgeHandler },
  // Phase 14 — the chat parser reads and returns; it writes nothing (G1), and
  // reopening restarts a decision while keeping its history (FR-2.22).
  { method: 'POST', segments: ['api', 'events', ':id', 'parse'], handler: parseHandler },
  { method: 'POST', segments: ['api', 'events', ':id', 'reopen'], handler: reopenHandler },
  // D23 — the in-room chat. Reads and writes are participant-scoped; the report
  // path exists for Apple §1.2 and is keyed on the message, not the event.
  { method: 'GET', segments: ['api', 'events', ':id', 'messages'], handler: listMessagesHandler },
  { method: 'POST', segments: ['api', 'events', ':id', 'messages'], handler: postMessageHandler },
  { method: 'POST', segments: ['api', 'messages', ':id', 'report'], handler: reportMessageHandler },
  // Phase 14 — per-proposal comments. There is deliberately no
  // `/api/events/:id/comments`.
  {
    method: 'GET',
    segments: ['api', 'proposals', ':id', 'comments'],
    handler: listCommentsHandler,
  },
  {
    method: 'POST',
    segments: ['api', 'proposals', ':id', 'comments'],
    handler: createCommentHandler,
  },
  { method: 'DELETE', segments: ['api', 'comments', ':id'], handler: deleteCommentHandler },
];

/** Matches one route's segments, returning the captured params. */
function match(segments: string[], path: string[]): Record<string, string> | null {
  if (segments.length !== path.length) return null;

  const params: Record<string, string> = {};

  for (let index = 0; index < segments.length; index++) {
    const expected = segments[index];
    const actual = path[index];

    if (expected === undefined || actual === undefined) return null;

    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }

    if (expected !== actual) return null;
  }

  return params;
}

/** The CORS origin, when one is configured. Never `*` — see below. */
function corsHeaders(request: Request): Record<string, string> {
  const allowed = process.env.APP_ORIGIN;
  if (!allowed) return {};

  const origin = request.headers.get('origin');
  if (!origin || origin !== allowed) return {};

  return {
    'access-control-allow-origin': allowed,
    'access-control-allow-headers': 'content-type, x-user-id, x-platform',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    vary: 'origin',
  };
}

/**
 * Dispatches one request.
 *
 * An unmatched route is a bare 404. It is safe to be honest here: the invite
 * routes match on segment COUNT, so `/api/invite/<anything>` reaches its own
 * handler and answers with the generic error. A wrong-shaped path therefore
 * reveals nothing about whether a token exists.
 */
export async function handleRequest(request: Request): Promise<Response> {
  const cors = corsHeaders(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  const path = new URL(request.url).pathname.split('/').filter(Boolean);

  for (const route of ROUTES) {
    if (route.method !== request.method) continue;

    const params = match(route.segments, path);
    if (!params) continue;

    const response = await route.handler(request, params);
    return withHeaders(response, cors);
  }

  return withHeaders(new Response(null, { status: 404 }), cors);
}

function withHeaders(response: Response, extra: Record<string, string>): Response {
  if (Object.keys(extra).length === 0) return response;

  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);

  return new Response(response.body, { status: response.status, headers });
}
