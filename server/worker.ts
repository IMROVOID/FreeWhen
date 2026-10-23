/**
 * The Cloudflare Workers entry point (Plan 39 T3).
 *
 * ★ THIS FILE IS THE ONLY WORKERS-SPECIFIC CODE.
 *
 * `server/app.ts` is already a pure `Request => Response` function, which is
 * exactly the Workers handler signature. All this adapter does is supply the
 * one thing a Worker has and a Node process does not: a per-request database
 * client (because Hyperdrive pools at the edge, and a Worker isolate cannot
 * hold a `pg.Pool` between requests).
 *
 * ★ ONE CLIENT PER REQUEST, ALWAYS CLOSED.
 *
 * Hyperdrive's own guidance is explicit: "Create a new client instance for each
 * request. Hyperdrive maintains the underlying database connection pool, so
 * creating a new client is fast." A leaked client on a Worker is a connection
 * the platform cannot reclaim, and enough of them exhaust the database's
 * `max_connections` in minutes.
 *
 * The `finally` is what makes that true for a thrown handler as well as a
 * successful one — and, because it is unconditional, for a client whose
 * handshake never completed.
 *
 * ★ WHAT DOES NOT RUN HERE.
 *
 * `server/realtime/` — the LISTEN/NOTIFY bridge and its WebSocket server. A
 * Worker has no long-lived socket and no session-level `LISTEN`. The platform
 * cannot host it, and pretending otherwise would be a silent partial deploy.
 * The decision screen polls every 10 s (`POLL_INTERVAL_MS`), so the product
 * degrades to "votes appear within 10 s" rather than breaking.
 *
 * `server/auth/` — the separate token service, a long-lived listener on its own
 * port. It is its own deployment; see `docs/RUNBOOK.md`.
 */

import { Client } from 'pg';

import { handleRequest } from './app';
import { withRequestQueryable } from './lib/db-scope';
import type { Queryable } from './lib/supabase';

/** The bindings this Worker expects from `wrangler.jsonc`. */
export interface Env {
  /**
   * The Hyperdrive binding.
   *
   * `connectionString` is generated dynamically by Hyperdrive per request; the
   * Worker never sees the underlying database credential.
   */
  HYPERDRIVE: { connectionString: string };

  /** Used to build invite links (FR-1.14), and as the CORS/websocket origin. */
  PUBLIC_BASE_URL?: string;
  APP_ORIGIN?: string;

  /** Server-side provider keys. Absent = the routing ladder degrades to straight-line. */
  NESHAN_MATRIX_API_KEY?: string;
  NESHAN_DIRECTION_API_KEY?: string;
  NESHAN_SEARCH_API_KEY?: string;
  ORS_API_KEY?: string;
}

/**
 * A hung handshake must not outlive the request.
 *
 * A Worker has no equivalent of a request timeout that closes sockets for you;
 * without a bound, a frozen database accept queue leaves the client waiting
 * until the platform kills the isolate, holding a connection the whole time.
 */
const CONNECT_TIMEOUT_MS = 10_000;
const QUERY_TIMEOUT_MS = 15_000;

/**
 * Every binding this adapter copies onto `process.env`.
 *
 * ★ THE LIST IS EXHAUSTIVE ON PURPOSE. See `bindEnvironment`.
 */
const ENV_KEYS = [
  'PUBLIC_BASE_URL',
  'APP_ORIGIN',
  'NESHAN_MATRIX_API_KEY',
  'NESHAN_DIRECTION_API_KEY',
  'NESHAN_SEARCH_API_KEY',
  'ORS_API_KEY',
] as const;

/**
 * Copies the Worker's bindings onto `process.env`.
 *
 * ★ THE ROUTES READ `process.env`, AND THAT IS NOT GOING TO CHANGE.
 *
 * `server/app.ts:194` reads `APP_ORIGIN`, `server/lib/http.ts:117` reads
 * `PUBLIC_BASE_URL`, and `server/lib/provider-secrets.ts:83` reads provider keys
 * by dynamic name. `process.env` exists on Workers under `nodejs_compat`, so the
 * cheapest correct adapter is to populate it once per request from `env` rather
 * than thread an `env` parameter through every route.
 *
 * ★ ABSENT KEYS ARE DELETED, NOT SKIPPED.
 *
 * An isolate outlives the request that ran in it, and `process.env` is shared by
 * both deployments' requests during a rolling deploy. Copying only the keys that
 * are present would leave a rotated-away key in place: a secret removed from the
 * dashboard in an emergency would keep working until the isolate was recycled.
 * Deleting makes each request observe exactly the bindings it was given.
 *
 * Per request, not at module scope: `env` is request-scoped by contract.
 */
function bindEnvironment(env: Env): void {
  for (const key of ENV_KEYS) {
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/**
 * Creates the per-request client.
 *
 * ★ INJECTABLE SO THE LIFECYCLE CAN BE TESTED HONESTLY.
 *
 * The property that matters most in this file is not "a query ran" — it is
 * "exactly one client was created and it was always closed". Proving that needs
 * a fake, and a fake needs a seam. The default is the real `pg.Client`.
 *
 * `connect` returns `Promise<unknown>` rather than `Promise<void>` because
 * `pg.Client.connect()` resolves to the client itself; narrowing it to `void`
 * would make the real client structurally incompatible with its own interface.
 */
export type ClientFactory = (connectionString: string) => Queryable & {
  connect(): Promise<unknown>;
  end(): Promise<void>;
};

const defaultClientFactory: ClientFactory = (connectionString) =>
  new Client({ connectionString, connectionTimeoutMillis: CONNECT_TIMEOUT_MS, query_timeout: QUERY_TIMEOUT_MS });

/**
 * The Worker's fetch handler, with the client factory lifted out.
 *
 * `createWorkerHandler()` is what `wrangler` loads (via the default export
 * below); `createWorkerHandler({ createClient })` is what the tests drive.
 */
export function createWorkerHandler(options: { createClient?: ClientFactory } = {}) {
  const createClient = options.createClient ?? defaultClientFactory;

  return async function fetch(request: Request, env: Env): Promise<Response> {
    bindEnvironment(env);

    if (!env.HYPERDRIVE?.connectionString) {
      // A missing binding is a deployment error, not a request error. Say so
      // plainly rather than letting `pg` throw "connection string is empty".
      return Response.json(
        { error: 'misconfigured', detail: 'HYPERDRIVE binding is missing' },
        { status: 500 },
      );
    }

    // ★ A NEW CLIENT PER REQUEST. See the header comment — this is Hyperdrive's
    // documented model, not a shortcut.
    const client = createClient(env.HYPERDRIVE.connectionString);

    try {
      await client.connect();
      // ★ The scope is opened only AFTER connect() succeeds: binding a client
      // that failed its handshake would let a route query it first and fail with
      // a driver error instead of the 500 below.
      return await withRequestQueryable(client, () => handleRequest(request));
    } catch (error) {
      // The message is deliberately generic: an error string from `pg` can
      // carry a host, a role, or a fragment of SQL. The redaction rule that
      // governs logs applies to a response body too.
      const detail = error instanceof Error ? error.message : 'unknown error';
      process.stderr.write(`worker: request failed: ${detail}\n`);
      return Response.json({ error: 'internal' }, { status: 500 });
    } finally {
      // ★ Unconditional, including on a failed or half-open connect.
      //
      // A `Client` whose handshake threw can still hold a TCP socket in
      // `pg`'s internal queue; `end()` on a never-connected client resolves
      // without touching the network, so there is no case where skipping this
      // is better than calling it.
      try {
        await client.end();
      } catch {
        // A close that fails on an already-broken connection is not actionable
        // and must not mask the original error.
      }
    }
  };
}

export default {
  fetch: createWorkerHandler(),
};
