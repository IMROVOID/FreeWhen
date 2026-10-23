/**
 * Test support for the Phase 5 HTTP surface.
 *
 * Three jobs, all of them about making the tests exercise the REAL server:
 *
 *  1. **Point the server at the test database.** `server/lib/supabase.ts` reads
 *     `DATABASE_URL` lazily, so setting it here — before the first query — is
 *     enough, and no import order trickery is needed.
 *  2. **Give every request its own client address.** The invite limiter allows
 *     ten redemptions per address per hour; a suite that sent one header-less
 *     address would start failing at the eleventh request for reasons that look
 *     like a token bug.
 *  3. **Call `handleRequest` directly.** No HTTP client, no port, no server
 *     process — the routing, validation, SQL and error envelopes under test are
 *     the ones that ship.
 */

import { randomUUID } from 'node:crypto';

import { ensureServerSql } from '@/server/lib/server-sql';

import { databaseUrl, loadDotEnv } from './support';

/** Must run before the first server query. Idempotent. */
export function prepareServerEnv(): void {
  loadDotEnv();
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = databaseUrl();
  }
}

/**
 * Applies this phase's `server/sql/`.
 *
 * ★ THE SUITE APPLIES IT ITSELF, AND RE-APPLIES IT.
 *
 * `server/sql/` is applied at runtime rather than through `migrations/`, so
 * anything that rebuilds the schema — another phase's `--fresh` migration run
 * in the same database — drops the `public` schema and takes these functions
 * with it. A suite that assumed its functions were still there would fail with
 * "function does not exist", and the failure would point at the join rather
 * than at the wiped schema.
 *
 * `ensureServerSql` verifies the functions it created and re-applies when they
 * are missing, so calling it in `before` is enough.
 */
export async function prepareServerSql(): Promise<void> {
  await ensureServerSql();
}

/**
 * A distinct address per call, so no bucket is shared.
 *
 * ★ A COUNTER, NOT A RANDOM VALUE.
 *
 * The first version drew from `Math.random()` over the 198.18.0.0/15
 * benchmarking space — about 131 000 addresses. A suite that makes thirty
 * calls has a birthday-collision chance of roughly 3%, and a collision puts two
 * calls in the SAME rate-limit bucket. Two calls per bucket is harmless; ten is
 * not, and the tenth call is refused with a 404 that reads as a broken invite
 * rather than as an exhausted budget.
 *
 * The flakiness was worse than 3% because the collision rate compounds across
 * the suite: the tenth collision exhausts a bucket, and the failure appears in
 * a DIFFERENT test each run, which is the signature of a shared counter rather
 * than of a logic bug.
 *
 * A monotonic counter is deterministic and collision-free by construction. The
 * third and fourth octets encode the counter, so a reader can see which call
 * used which address.
 */
let addressCounter = 0;

export function uniqueIp(): string {
  addressCounter += 1;

  // 198.18.0.0/15 is RFC 2544 benchmarking space — never a real client.
  const a = 198;
  const b = 18 + (addressCounter % 2);
  const c = Math.floor(addressCounter / 2) % 256;
  const d = 1 + (addressCounter % 254);

  return `${a}.${b}.${c}.${d}`;
}

export interface CallOptions {
  method?: string;
  /** Sent as JSON. */
  body?: unknown;
  /** The caller's identity. Omit for an anonymous caller. */
  userId?: string | null;
  /** Overrides the generated address, for the rate-limit cases. */
  ip?: string;
  platform?: 'web' | 'app';
}

/** One API call against the real handler. */
export async function call(path: string, options: CallOptions = {}): Promise<Response> {
  const { method = 'GET', body, userId, ip, platform } = options;

  const headers: Record<string, string> = {
    'x-forwarded-for': ip ?? uniqueIp(),
  };

  if (body !== undefined) headers['content-type'] = 'application/json';
  if (userId) headers['x-user-id'] = userId;
  if (platform) headers['x-platform'] = platform;

  const request = new Request(`http://test.local${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const { handleRequest } = await import('@/server/app');
  const { withRequestQueryable } = await import('@/server/lib/db-scope');
  const { servicePool } = await import('@/server/lib/supabase');

  // ★ THE HARNESS BINDS THE SCOPE, SO EVERY DB TEST RUNS THE WORKER'S PATH.
  //
  // There is no per-request client on Node, so the shared pool is bound
  // explicitly. That makes `scopedQueryable()` resolve through the same switch
  // the Worker uses, and it means `withTransaction` / `withCallerTransaction`
  // exercise the scoped branch in all ~380 tests rather than only in the
  // handful that drive `createWorkerHandler`.
  //
  // The binding must be established HERE, around the whole handler: routes call
  // service functions that resolve their queryable per call, and a binding made
  // anywhere looser would be released before those calls run.
  return withRequestQueryable(servicePool(), () => handleRequest(request));
}

/** The parsed JSON body, for assertions. */
export async function bodyOf<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.clone().json()) as T;
}

/** The raw response text — the byte-identity assertions need the exact string. */
export async function rawBodyOf(response: Response): Promise<string> {
  return response.clone().text();
}

export interface CreatedEvent {
  eventId: string;
  userId: string;
  token: string;
  url: string;
  organizerParticipantId: string;
  title: string;
}

const DAY = 86_400_000;

/**
 * Creates an event through the API and returns its invite.
 *
 * Going through `POST /api/events` rather than inserting rows is deliberate: it
 * proves creation, organizer membership and link issuance together, which is
 * what an organizer actually does.
 */
export async function createEventViaApi(
  options: { title?: string; windowStart?: string; windowEnd?: string } = {},
): Promise<CreatedEvent> {
  const start = options.windowStart ?? new Date(Date.now() + DAY).toISOString();
  const end = options.windowEnd ?? new Date(Date.now() + 4 * DAY).toISOString();

  const response = await call('/api/events', {
    method: 'POST',
    body: {
      title: options.title ?? `Event ${randomUUID().slice(0, 8)}`,
      activity_type: 'dinner',
      date_window_start: start,
      date_window_end: end,
    },
  });

  if (response.status !== 201) {
    throw new Error(`event creation failed with ${response.status}: ${await response.text()}`);
  }

  const body = await bodyOf<{
    user_id: string;
    event: { id: string; title: string };
    participant: { id: string };
    invite: { url: string };
  }>(response);

  return {
    eventId: body.event.id,
    userId: body.user_id,
    token: tokenFromUrl(body.invite.url),
    url: body.invite.url,
    organizerParticipantId: body.participant.id,
    title: body.event.title,
  };
}

/** The token out of an invite URL, for the rotation case. */
export function tokenFromUrl(url: string): string {
  const segments = url.split('/');
  return segments[segments.length - 1] ?? '';
}
