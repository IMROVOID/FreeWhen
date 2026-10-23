/**
 * The PostgREST (Supabase REST) transport (Plan 40 T6).
 *
 * ★ THE POINT OF THIS MODULE.
 *
 * `server/lib/supabase.ts` reaches Postgres over a TCP socket with `pg`. Some
 * runtimes (and some operators) have no socket to give: a plan that forbids
 * egress on 5432, a function whose only credential is an HTTPS key, an edge
 * runtime with no `node:net`. This module satisfies the same `Queryable`
 * interface over `fetch`, so every route in `server/` works unchanged.
 *
 * ★ IT IS AN ENUMERATED TABLE, NOT A SQL PARSER.
 *
 * See `rest-units.ts` for the vocabulary and the load-time coverage guard. This
 * file is the wire: headers, URL construction, row decoding and the one place a
 * credential could reach a client.
 *
 * ★ THE REGISTRY IS NARROW ON PURPOSE, AND THAT IS A DOCUMENTED LIMIT.
 *
 * The `pg` transport remains the full-featured path and is the default (`D5`).
 * The REST transport covers the surface a serverless deployment actually needs:
 * health, identity, the join RPC and the transactional units. A multi-table
 * aggregate read with CTEs and correlated subqueries (`EVENT_SELECT` in
 * `event-service.ts:86-116`) is NOT expressible over PostgREST without a view or
 * an RPC per read, and this plan explicitly declines to create one per read —
 * that would be a schema change to serve a transport, not the other way round.
 *
 * ★ CREDENTIALS NEVER LEAVE THE SERVER.
 *
 * `SUPABASE_SECRET_KEY` is read by name from `process.env`, sent as both
 * `apikey` and `Authorization`, and never re-exported. `gate:secrets` scans
 * `server/` for exactly this pattern.
 *
 * ★ DEPLOYMENT PREREQUISITES ARE IN `server/runtime/REST_SETUP.md`.
 *
 * Two of them fail in ways that read like something else — a missing
 * `authenticator` → `service_role` membership, and a key that is not a signed
 * JWT. Both are recorded there with the exact error each produces.
 */

import type { Queryable } from './supabase';
import { RestRequestError, UnsupportedStatementError } from './rest-errors';

export {
  REST_RPCS,
  REST_TABLES,
  REST_UNITS,
  assertUnitsCovered,
  type RestRpc,
  type RestTable,
  type RestUnit,
  type RestUnitName,
} from './rest-units';

export {
  RestRequestError,
  RestTransactionUnavailableError,
  UnsupportedStatementError,
} from './rest-errors';

/**
 * A response row from PostgREST is arbitrary JSON; the `Queryable` contract
 * wants a `QueryResultRow`. Both are `Record<string, unknown>` to `pg`, so the
 * cast is structural rather than a lie.
 */
type RestRow = Record<string, unknown>;

export interface RestQueryableOptions {
  /** The Supabase (or self-hosted PostgREST) base URL, e.g. `https://x.supabase.co`. */
  url: string;
  /** The service key. Sent as BOTH `apikey` and `Authorization`. */
  key: string;
  /**
   * The path prefix the RPC endpoints live under.
   *
   * ★ THE TWO HOSTS MOUNT POSTGREST AT DIFFERENT PATHS, AND IT IS NOT COSMETIC.
   *
   * | Host | RPC URL |
   * |---|---|
   * | Supabase | `<url>/rest/v1/rpc/<fn>` |
   * | A bare PostgREST (the local compose stack) | `<url>/rpc/<fn>` |
   *
   * A self-hosted PostgREST behind Caddy at `/rest/v1` uses the first form. The
   * default matches what Supabase publishes, because that is what the
   * `supabase_rest` mode of `D2` targets; a bare PostgREST deployment passes
   * `''` explicitly.
   *
   * Getting it wrong is a 404 on every RPC — which reads as "the function does
   * not exist" rather than "the path is wrong", so it is worth naming here.
   */
  prefix?: string;
  /**
   * The caller's JWT, when the request has one.
   *
   * ★ THIS IS WHAT MAKES `auth.uid()` WORK OVER REST.
   *
   * PostgREST connects as `authenticator` and switches to the JWT's `role`
   * claim. The claims GUC — `request.jwt.claims`, which the `auth.uid()` shim
   * reads (`migrations/000_portability.sql:126-134`) — is populated by PostgREST
   * FROM THAT JWT. There is no way to `set_config` it from `pg` over HTTP, so
   * the caller's identity must travel here or every `auth.uid()` is `NULL`.
   *
   * ★ A RAW STRING HERE IS NOT ENOUGH.
   *
   * PostgREST validates the bearer as a JWT it can verify and rejects an opaque
   * key with 401. The `key` above is therefore also a JWT in practice —
   * Supabase's `service_role` key is one — and this field only overrides whose
   * claims the request carries.
   */
  callerJwt?: string;
  /** Injected for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/** The path prefix Supabase publishes. */
export const DEFAULT_REST_PREFIX = '/rest/v1';

/** The `Queryable` this module produces, plus the hooks the transport needs. */
export interface RestQueryable extends Queryable {
  /** Calls one RPC by name and returns its raw `jsonb` payload. */
  rpc<T = RestRow>(name: string, args?: Readonly<Record<string, unknown>>): Promise<T>;
  /** The base URL, so callers can log which host was used without the key. */
  readonly url: string;
}

/** Strips a trailing slash so URL joins never double it. */
function baseOf(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * The headers every PostgREST call needs.
 *
 * ★ `apikey` IS MANDATORY AND IS NOT THE SAME AS THE BEARER.
 *
 * Supabase's gateway rejects a request that carries only `Authorization`, with a
 * 401 that reads like a bad token. Both must be present on every call.
 */
function baseHeaders(options: RestQueryableOptions): Record<string, string> {
  const bearer = options.callerJwt ?? options.key;

  return {
    apikey: options.key,
    authorization: `Bearer ${bearer}`,
    'content-type': 'application/json',
    // Without this PostgREST answers with an empty body on a write, which the
    // `pg` contract would read as `rowCount: 0` and callers treat as "nothing
    // was written".
    prefer: 'return=representation',
  };
}

/** PostgREST's error body, as much of it as is safe to surface. */
async function failureOf(response: Response): Promise<RestRequestError> {
  let detail = '';

  try {
    const body = (await response.json()) as { message?: unknown; code?: unknown };
    if (typeof body.message === 'string') detail = body.message;
    else if (typeof body.code === 'string') detail = `code ${body.code}`;
  } catch {
    // A body that is not JSON carries nothing safe to quote.
  }

  return new RestRequestError(response.status, detail);
}

/** Flattens a PostgREST body into the row set `Queryable` promises. */
async function asRows(response: Response): Promise<{ rows: RestRow[]; rowCount: number }> {
  const text = await response.text();
  if (text.trim() === '') return { rows: [], rowCount: 0 };

  const parsed: unknown = JSON.parse(text);

  // A table read is always a JSON array; a single object means the gateway
  // answered something unexpected, so it is wrapped rather than dropped.
  const rows = Array.isArray(parsed) ? (parsed as RestRow[]) : [parsed as RestRow];

  // ★ `rowCount` IS A NUMBER, NEVER `null`.
  //
  // `server/lib/supabase.ts:121-126` documents why: `PoolClient.query` reports
  // `number | null` and every caller treats it as a count. A `null` here would
  // make a zero-row read indistinguishable from "the driver did not count".
  return { rows, rowCount: rows.length };
}

/**
 * A `Queryable` backed by PostgREST.
 *
 * ★ `query()` IS THE FALLBACK, NOT THE MAIN ENTRY POINT.
 *
 * Routes on the REST transport call `rpc()`. `query()` exists so the handful of
 * simple single-table statements in the codebase can run through the same
 * `Queryable` seam without a special case. Anything more complex throws
 * `UnsupportedStatementError` rather than guessing.
 */
export function createRestQueryable(options: RestQueryableOptions): RestQueryable {
  const base = baseOf(options.url);
  const prefix = baseOf(options.prefix ?? DEFAULT_REST_PREFIX);
  const doFetch = options.fetchImpl ?? fetch;

  async function call(path: string, init: RequestInit): Promise<Response> {
    const response = await doFetch(`${base}${path}`, {
      ...init,
      headers: { ...baseHeaders(options), ...(init.headers as Record<string, string> | undefined) },
    });

    if (!response.ok) throw await failureOf(response);
    return response;
  }

  return {
    url: base,

    async query<T = RestRow>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number }> {
      const statement = text.trim();

      // ★ THE SIMPLE STATEMENTS, MATCHED EXACTLY.
      //
      // Deliberately not a regex-shaped parser: both are literals in the
      // codebase, and matching them exactly means an edit to either one fails
      // here loudly instead of being half-translated.
      if (/^select\s+1$/i.test(statement)) {
        // A health probe. PostgREST's root returns the OpenAPI document, which
        // proves the gateway, the JWT and the pool in one call. The document is
        // discarded: the STATUS is the assertion.
        const response = await call('/', { method: 'GET' });
        await response.text();
        return { rows: [{ '?column?': 1 }] as unknown as T[], rowCount: 1 };
      }

      const isAnonymousRead = /^select\s+is_anonymous\s+from\s+auth\.users\s+where\s+id\s*=\s*\$1$/i.test(
        statement.replace(/\s+/g, ' '),
      );

      if (isAnonymousRead) {
        const id = values?.[0];
        if (typeof id !== 'string') throw new UnsupportedStatementError(statement);

        // `auth.users` is not exposed by PostgREST (`db-schemas=public`), so
        // this goes through an RPC. `resolve_caller` returns the same shape the
        // statement does — see `server/sql/resolve_caller.rpc.sql`.
        //
        // ★ THE RPC IS CALLED, THEN RE-WRAPPED AS ROWS.
        //
        // `query()`'s contract is `{ rows, rowCount }`, so a scalar `jsonb`
        // result has to become a one-row result set. Returning the object
        // directly would make `result.rows[0]` undefined at every call site.
        const payload = await call(`${prefix}/rpc/resolve_caller`, {
          method: 'POST',
          body: JSON.stringify({ p_user_id: id }),
        });

        const body = await payload.text();
        if (body.trim() === '' || body.trim() === 'null') {
          return { rows: [], rowCount: 0 };
        }

        return asRows(new Response(body, { headers: { 'content-type': 'application/json' } })) as Promise<{
          rows: T[];
          rowCount: number;
        }>;
      }

      throw new UnsupportedStatementError(statement);
    },

    async rpc<T = RestRow>(name: string, args: Readonly<Record<string, unknown>> = {}) {
      const response = await call(`${prefix}/rpc/${name}`, {
        method: 'POST',
        body: JSON.stringify(args),
      });

      const text = await response.text();
      if (text.trim() === '') return null as T;

      const parsed: unknown = JSON.parse(text);

      // ★ AN RPC'S `jsonb` RETURN IS THE RAW VALUE, NOT AN ARRAY.
      //
      // PostgREST unwraps a `returns jsonb` scalar, so `join_event` answers
      // `{ "error": null, "created": true, ... }` and not `[{ ... }]`. The
      // caller wants that object, so the array-flattening is used only for the
      // `setof`-shaped case — which is a table read, not an RPC.
      return (Array.isArray(parsed) ? parsed[0] : parsed) as T;
    },
  };
}

/** Whether a handle came from this module. The discriminator the transaction path uses. */
export function isRestQueryable(handle: unknown): handle is RestQueryable {
  return typeof handle === 'object' && handle !== null && 'rpc' in handle && 'url' in handle;
}
