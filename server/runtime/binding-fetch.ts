/**
 * The binding-object `fetch` entry (Plan 39 T3, refactored by Plan 40 T1).
 *
 * ★ THE CONVENTION, NOT THE HOST.
 *
 * This adapter serves any runtime whose entry signature is
 *
 * ```ts
 * fetch(request: Request, env: { BINDING: … }, ctx) => Promise<Response>
 * ```
 *
 * where the database credential arrives as a **binding object** supplied by the
 * platform per request, rather than as a plain environment variable. Such a
 * runtime cannot hold a socket pool between requests, so the client is created
 * per request and closed unconditionally.
 *
 * ★ THE CREDENTIAL IS READ FROM `connectionString`, AND ITS ABSENCE IS A 500.
 *
 * A missing binding is a deploy-time configuration error, not a request error.
 * Saying so plainly is better than letting the driver throw "connection string is
 * empty" on every request, and better than a crash — a health check should get a
 * diagnosable answer even when the deployment is wrong.
 *
 * ★ THE LIFECYCLE LIVES IN `server/runtime/driver.ts`.
 *
 * The create → connect → bind → handle → close sequence is identical on every
 * serverless runtime, so it moved to `runWithClient` and every adapter shares it.
 * What is left here is the two things only a binding-object runtime has: reading
 * the binding and the deploy-time check that it exists.
 *
 * ★ WHAT DOES NOT RUN HERE.
 *
 * `server/realtime/` — the LISTEN/NOTIFY bridge and its WebSocket server. A
 * request-scoped runtime has no long-lived socket and no session-level `LISTEN`.
 * The platform cannot host it, and pretending otherwise would be a silent partial
 * deploy. The decision screen polls every 10 s (`POLL_INTERVAL_MS`), so the
 * product degrades to "votes appear within 10 s" rather than breaking.
 *
 * `server/auth/` — the separate token service, a long-lived listener on its own
 * port. It is its own deployment; see `docs/RUNBOOK.md`.
 */

import {
  bindEnvironment,
  defaultClientFactory,
  runWithClient,
  type ClientFactory,
} from './driver';

/** The bindings this entry expects. */
export interface Env {
  /**
   * The database binding.
   *
   * `connectionString` is generated per request by the platform's connection
   * pooler; the function never sees the underlying long-lived credential.
   */
  DB: { connectionString: string };

  /** Used to build invite links (FR-1.14), and as the CORS/websocket origin. */
  PUBLIC_BASE_URL?: string;
  APP_ORIGIN?: string;

  /** Server-side provider keys. Absent = the routing ladder degrades to straight-line. */
  NESHAN_MATRIX_API_KEY?: string;
  NESHAN_DIRECTION_API_KEY?: string;
  NESHAN_SEARCH_API_KEY?: string;
  ORS_API_KEY?: string;
}

export type { ClientFactory };

/**
 * The fetch handler, with the client factory lifted out.
 *
 * `createBindingFetchHandler()` is what the runtime loads (via the default export
 * below); `createBindingFetchHandler({ createClient })` is what the tests drive.
 */
export function createBindingFetchHandler(options: { createClient?: ClientFactory } = {}) {
  const createClient = options.createClient ?? defaultClientFactory;

  return async function fetch(request: Request, env: Env): Promise<Response> {
    bindEnvironment(env);

    if (!env.DB?.connectionString) {
      // A missing binding is a deployment error, not a request error. Say so
      // plainly rather than letting the driver throw "connection string is
      // empty" on every request.
      return Response.json(
        { error: 'misconfigured', detail: 'DB binding is missing' },
        { status: 500 },
      );
    }

    return runWithClient(env.DB.connectionString, createClient, request);
  };
}

export default {
  fetch: createBindingFetchHandler(),
};
