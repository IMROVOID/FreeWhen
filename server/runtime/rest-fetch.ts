/**
 * The `fetch` entry for the PostgREST transport (Plan 40 T9).
 *
 * ★ THIS ENTRY NEEDS NO BINDING OBJECT AND NO SOCKET.
 *
 * That is its entire reason for existing. The `pg` entries require a database
 * binding object and a Node-compatible socket layer (`node:net`, which `pg`
 * needs); this one talks to the database over HTTPS with two headers and nothing
 * else. It is the deployment for:
 *
 *  - an operator whose network policy forbids egress on the Postgres port;
 *  - an operator whose only database credential is an HTTPS service key;
 *  - a runtime without a Node compatibility layer at all.
 *
 * ★ DEGRADATION IS THE POLL, AS ON EVERY SERVERLESS TARGET.
 *
 * `server/realtime/` — the LISTEN/NOTIFY bridge and its WebSocket server — cannot
 * run here: no long-lived socket, no session-level `LISTEN`. The decision screen
 * polls every 10 s (`POLL_INTERVAL_MS`), which `docs/RUNBOOK.md` records as the
 * floor for every request-scoped runtime.
 *
 * ★ THE CALLER'S IDENTITY MUST REACH POSTGREST AS A JWT.
 *
 * The RPCs read `auth.uid()`, which resolves from `request.jwt.claims`. On the
 * `pg` transport that GUC is set with `set_config(..., true)` inside the
 * transaction (`server/lib/supabase.ts:241-256`). Over HTTP there is no such call,
 * so the claims have to arrive as the bearer token. `callerJwtFrom` below is where
 * a deployment supplies that.
 *
 * ★ THE SECRET IS READ BY NAME AND NEVER RE-EXPORTED.
 *
 * `gate:secrets` scans `server/` for exactly this pattern.
 * `SUPABASE_SECRET_KEY` is injected by the host's secret mechanism and never
 * appears in a committed config file.
 */

import { handleRequest } from '../app';
import { withRequestQueryable } from '../lib/db-scope';
import { bindEnvironment } from './driver';
import { createRestQueryable, type RestQueryable } from '../lib/supabase-rest';

/** The bindings this entry expects. */
export interface RestEnv {
  /** The PostgREST (or managed PostgREST) base URL, e.g. `https://db.example.test`. */
  SUPABASE_URL?: string;
  /** The service key. Sent as both `apikey` and `Authorization`. */
  SUPABASE_SECRET_KEY?: string;

  /** Used to build invite links (FR-1.14), and as the CORS origin. */
  PUBLIC_BASE_URL?: string;
  APP_ORIGIN?: string;

  /** Server-side provider keys. Absent = the routing ladder degrades to straight-line. */
  NESHAN_MATRIX_API_KEY?: string;
  NESHAN_DIRECTION_API_KEY?: string;
  NESHAN_SEARCH_API_KEY?: string;
  ORS_API_KEY?: string;
}

/** A seam so the transport can be swapped in a test without a live gateway. */
export type RestQueryableFactory = (options: {
  url: string;
  key: string;
  callerJwt?: string;
}) => RestQueryable;

const defaultFactory: RestQueryableFactory = (options) => createRestQueryable(options);

/**
 * The caller JWT for this request, when the deployment can supply one.
 *
 * ★ THIS IS THE ONE PLACE A DEPLOYMENT MUST MAKE A DECISION.
 *
 * The RPCs take identity from claims. Two honest options:
 *
 *  1. **Trust the platform's own identity.** If the request carries a signed
 *     token this deployment issued, forward it. Nothing in this repo issues one
 *     for the serverless path today, so this returns `undefined`.
 *
 *  2. **Mint one.** A deployment with `JWT_SECRET` can sign
 *     `{ sub, role: 'authenticated', is_anonymous }` from the `x-user-id` header
 *     the routes already use. That is what the local backend's auth service does
 *     (`server/auth/`).
 *
 * Returning `undefined` is safe rather than silent: the service key remains the
 * bearer, so the ROLE is `service_role` — which is what the RPCs are granted to —
 * and `auth.uid()` resolves to NULL, so every identity-dependent RPC refuses with
 * `NOT_PARTICIPANT` rather than acting as the wrong user.
 *
 * ★ THE FAILURE MODE IS REFUSAL, NEVER AN IMPERSONATION.
 *
 * That is the property worth keeping: an unconfigured JWT path loses the join and
 * the vote, but cannot write a row as somebody else.
 */
function callerJwtFrom(_request: Request): string | undefined {
  return undefined;
}

/**
 * The fetch handler, with the transport injectable.
 *
 * `createRestHandler()` is what the default export uses;
 * `createRestHandler({ createQueryable })` is what the tests drive.
 */
export function createRestHandler(
  options: { createQueryable?: RestQueryableFactory } = {},
) {
  const createQueryable = options.createQueryable ?? defaultFactory;

  return async function fetch(request: Request, env: RestEnv): Promise<Response> {
    // The provider keys and origins are copied onto `process.env` exactly as the
    // binding-object entry does; absent keys are deleted, not skipped.
    bindEnvironment(env);

    const url = env.SUPABASE_URL;
    const key = env.SUPABASE_SECRET_KEY;

    if (!url || !key) {
      // A missing configuration value is a deployment error, not a request
      // error — the same shape every other entry answers for a missing
      // credential, so an operator sees one message across all of them.
      return Response.json(
        {
          error: 'misconfigured',
          detail: 'SUPABASE_URL and SUPABASE_SECRET_KEY are both required for the REST transport',
        },
        { status: 500 },
      );
    }

    const queryable = createQueryable({ url, key, callerJwt: callerJwtFrom(request) });

    try {
      // No connect and no client to close: there is no socket. The scope still
      // has to be bound around the WHOLE request — `withRequestQueryable`
      // requires it to be fully awaited (`server/lib/db-scope.ts:80-84`).
      return await withRequestQueryable(queryable, () => handleRequest(request));
    } catch (error) {
      // Generic on purpose: a PostgREST error can carry a table name, a
      // constraint and occasionally a row. Same rule as the `pg` path.
      const detail = error instanceof Error ? error.message : 'unknown error';
      process.stderr.write(`rest-fetch: request failed: ${detail}\n`);
      return Response.json({ error: 'internal' }, { status: 500 });
    }
  };
}

export default {
  fetch: createRestHandler(),
};
