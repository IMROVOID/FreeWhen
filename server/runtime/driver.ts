/**
 * The runtime-neutral core every serverless adapter delegates to (Plan 40 T1).
 *
 * ★ THIS FILE HOLDS THE LIFECYCLE. THE ADAPTERS HOLD THE CALLING CONVENTION.
 *
 * Plan 39 shipped one adapter, `server/worker.ts`, and it mixed two unrelated
 * concerns: translating one host's `fetch(request, env, ctx)` into a plain
 * `Request`, and the per-request client lifecycle (create → connect → bind →
 * handle → close). The first concern differs for every platform; the second is
 * identical for all of them and is the only part with a bug worth having.
 *
 * Splitting them means eleven adapters share one lifecycle instead of eleven
 * copies of it, and the lifecycle is proven once by `worker-entry.test.ts`.
 *
 * ★ `server/app.ts` IS NOT TOUCHED BY ANY OF THIS.
 *
 * `handleRequest` is already a pure `Request => Response`. An adapter's whole
 * job is to produce one `Request`, hand it over, and turn the `Response` back
 * into whatever the platform expects. Anything here that knew about routing,
 * validation or error shapes would mean the seam had moved.
 *
 * ★ WHERE THIS CANNOT BE USED.
 *
 * `server/realtime/` — the LISTEN/NOTIFY bridge and its WebSocket server. No
 * FaaS platform offers a session that outlives a request, so the bridge stays a
 * Node-only, always-on process. Every target that imports this file degrades to
 * the 10-second poll (`POLL_INTERVAL_MS`), which is the documented floor.
 */

import { Client } from 'pg';

import { connectionOptions } from '@/server/lib/connection-options';

import { handleRequest } from '../app';
import { withRequestQueryable } from '../lib/db-scope';
import type { Queryable } from '../lib/supabase';
import { withConnectRetry } from './connect-retry';

/**
 * A hung handshake must not outlive the request.
 *
 * A serverless target has no equivalent of a request timeout that closes
 * sockets for you; without a bound, a frozen database accept queue leaves the
 * client waiting until the platform kills the invocation, holding a connection
 * the whole time.
 */
export const CONNECT_TIMEOUT_MS = 10_000;
export const QUERY_TIMEOUT_MS = 15_000;

/**
 * Every binding an adapter copies onto `process.env`.
 *
 * ★ THE LIST IS EXHAUSTIVE ON PURPOSE. See `bindEnvironment`.
 */
export const ENV_KEYS = [
  'PUBLIC_BASE_URL',
  'APP_ORIGIN',
  'NESHAN_MATRIX_API_KEY',
  'NESHAN_DIRECTION_API_KEY',
  'NESHAN_SEARCH_API_KEY',
  'ORS_API_KEY',
] as const;

/**
 * The credentials `runWithClient` needs, by name.
 *
 * ★ THE SAME SIX KEYS, PLUS THE DATABASE. See `bindEnvironment`.
 */
const DATABASE_ENV_KEYS = ['DATABASE_URL', 'SUPABASE_DB_URL', 'DATABASE_BACKEND'] as const;

/**
 * The bindings an adapter may hand to `bindEnvironment`.
 *
 * Deliberately `object` rather than `Record<string, unknown>`: a platform's own
 * `Env` is normally an `interface`, and TypeScript does not consider an
 * interface assignable to an index-signature type (only a type alias is). Every
 * adapter would otherwise have to declare an index signature it never uses, or
 * cast at the call site and lose the check entirely.
 *
 * The read below is therefore an explicit string-value guard rather than a
 * typed lookup — which is what the guard has to be anyway, since some bindings
 * are objects rather than strings.
 */
export type RuntimeEnv = object;

/** A string-valued binding, or `undefined` for absent and non-string values. */
function bindingValue(env: RuntimeEnv | undefined, key: string): string | undefined {
  const value = (env as Record<string, unknown> | undefined)?.[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Copies the platform's bindings onto `process.env`.
 *
 * ★ THE ROUTES READ `process.env`, AND THAT IS NOT GOING TO CHANGE.
 *
 * `server/app.ts:194` reads `APP_ORIGIN`, `server/lib/http.ts:117` reads
 * `PUBLIC_BASE_URL`, and `server/lib/provider-secrets.ts:83` reads provider keys
 * by dynamic name. `process.env` exists on every runtime this core targets, so the
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
 * ★ THE DATABASE NAMES ARE HANDLED SEPARATELY, AND STILL SYMMETRICALLY.
 *
 * `DATABASE_URL` is what `server/lib/supabase.ts:32` reads, so a runtime whose
 * only database handle is a binding object must be able to set it here. Those
 * three keys are NOT copied from `env` blindly: an operator may legitimately have
 * `DATABASE_URL` set in `process.env` (a local `.env`, or the host's own
 * injection) and no matching binding on `env`.
 * Deleting them there would erase the one credential the request needs.
 *
 * So the rule is "copied when present, never deleted" for those three, and
 * "copied when present, deleted when absent" for `ENV_KEYS`. The asymmetry is
 * the whole reason these are two lists.
 *
 * Per request, not at module scope: `env` is request-scoped by contract.
 */
export function bindEnvironment(env: RuntimeEnv | undefined): void {
  for (const key of ENV_KEYS) {
    const value = bindingValue(env, key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  for (const key of DATABASE_ENV_KEYS) {
    const value = bindingValue(env, key);
    if (value !== undefined) process.env[key] = value;
  }
}

/**
 * Creates the per-request client.
 *
 * ★ INJECTABLE SO THE LIFECYCLE CAN BE TESTED HONESTLY.
 *
 * The property that matters most in this module is not "a query ran" — it is
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

/**
 * The per-request client.
 *
 * ★ IT USES THE SAME CONNECTION OPTIONS AS THE POOL.
 *
 * This used to set a connect timeout and a query timeout of its own and nothing
 * else — no TLS. On Vercel this is the ONLY connection path, so every cold
 * request paid a cleartext-attempt handshake against a database that requires
 * TLS, failed outside the request scope, and answered a bare 500 that the
 * client's poller retried ten seconds later. `connectionOptions` is the single
 * place that decides TLS and the timeouts now, so the two paths cannot drift
 * again.
 */
export const defaultClientFactory: ClientFactory = (connectionString) => {
  const options = connectionOptions(connectionString);

  // `PoolConfig['statement_timeout']` also allows `false` (disable it); the
  // builder never sets that, and `Client` takes a plain number.
  const queryTimeout = typeof options.statement_timeout === 'number' ? options.statement_timeout : QUERY_TIMEOUT_MS;

  return new Client({
    connectionString: options.connectionString,
    ssl: options.ssl,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? CONNECT_TIMEOUT_MS,
    query_timeout: queryTimeout,
    keepAlive: options.keepAlive,
  });
};

/**
 * Runs one request against a per-request client: connect → bind → handle → close.
 *
 * ★ ONE CLIENT PER REQUEST, ALWAYS CLOSED.
 *
 * The documented model for pooled edge drivers is explicit: "Create a new client instance for each
 * request. The platform maintains the underlying database connection pool, so`n * creating a new client is fast." A leaked client is a connection the platform
 * cannot reclaim, and enough of them exhaust the database's `max_connections`
 * in minutes.
 *
 * The `finally` is what makes that true for a thrown handler as well as a
 * successful one — and, because it is unconditional, for a client whose
 * handshake never completed.
 *
 * ★ THE CALLER OWNS `connectionString` VALIDATION.
 *
 * This function assumes the string is present. An adapter whose platform
 * supplies it through a binding checks for it first and answers 500
 * `misconfigured` (`server/worker.ts`) rather than letting `pg` throw
 * "connection string is empty" on every request.
 */
export async function runWithClient(
  connectionString: string,
  createClient: ClientFactory,
  request: Request,
): Promise<Response> {
  try {
    // ★ THE COLD HANDSHAKE IS THE ONLY PART THAT IS RETRIED.
    //
    // A page occasionally loaded as a 500 from `GET /api/events/:id/messages`
    // and always worked on a second try: the first attempt from a cold isolate
    // loses its TCP/TLS handshake, and nothing had run yet. `withConnectRetry`
    // repeats ONLY that failure and hands back a client that connected; the
    // handler below is invoked exactly once either way, so no work is replayed.
    return await withConnectRetry(async () => {
      const client = createClient(connectionString);

      try {
        await client.connect();
        // ★ The scope is opened only AFTER connect() succeeds: binding a client
        // that failed its handshake would let a route query it first and fail
        // with a driver error instead of the 500 below.
        return await withRequestQueryable(client, () => handleRequest(request));
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
    });
  } catch (error) {
    // The message is deliberately generic: an error string from `pg` can
    // carry a host, a role, or a fragment of SQL. The redaction rule that
    // governs logs applies to a response body too.
    const detail = error instanceof Error ? error.message : 'unknown error';
    process.stderr.write(`serverless: request failed: ${detail}\n`);
    return Response.json({ error: 'internal' }, { status: 500 });
  }
}
