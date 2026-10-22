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

import { json } from './lib/http';
import { servicePool } from './lib/supabase';
import {
  createEventHandler,
  getEventHandler,
  listEventsHandler,
  revokeInviteHandler,
  rotateInviteHandler,
} from './routes/events';
import { joinInviteHandler, resolveInviteHandler } from './routes/invite';
import { placeSearchHandler } from './routes/place-search';
import {
  deleteStartPointHandler,
  patchParticipantHandler,
  setStartPointHandler,
} from './routes/participants';
import {
  createProposalHandler,
  listProposalsHandler,
  patchProposalHandler,
  withdrawProposalHandler,
} from './routes/proposals';

type Handler = (request: Request, params: Record<string, string>) => Promise<Response>;

interface Route {
  method: string;
  /** Segments; `:name` captures. */
  segments: string[];
  handler: Handler;
}

const ROUTES: Route[] = [
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
];

async function healthHandler(): Promise<Response> {
  try {
    await servicePool().query('select 1');
    return json({ ok: true });
  } catch {
    // The status, not the error: a health check that echoes a driver message
    // publishes the connection string's host and user to an anonymous caller.
    return json({ ok: false }, 503);
  }
}

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
