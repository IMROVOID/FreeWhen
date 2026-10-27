/**
 * The server's database client — the service-role equivalent (PRD-09 §4.0).
 *
 * ★ SERVER ONLY. Nothing under `src/` or `app/` may import this module.
 *
 * The connection it holds is privileged: it creates `auth.users` rows and reads
 * across every event. The client bundle is served to strangers, so a single
 * import from a screen would ship the ability to mint identities. Two gates
 * enforce the boundary — `gate:secrets` fails when a server-only variable name
 * appears in client code, and the module has no client-safe export at all.
 *
 * ★ The connection string is REQUIRED, never defaulted.
 *
 * A written-down default is a credential in the source tree, and a default that
 * points at `localhost` silently connects to the wrong database when the
 * variable is mistyped. Missing configuration must fail loudly at start-up.
 *
 * Supabase's `signInAnonymously()` is what this replaces on the self-hosted /
 * local backend (D20/D21/D22): the minted identity carries exactly the two
 * claims the RLS policies read — `sub` and `is_anonymous` — so every policy
 * behaves identically whichever backend minted it.
 */

import { Pool, type PoolClient, type QueryResultRow } from 'pg';

import { connectionOptions } from './connection-options';

import { currentQueryable } from './db-scope';
import {
  RestTransactionUnavailableError,
  isRestQueryable,
  type RestRpc,
} from './supabase-rest';

/**
 * The RPC-backed units. A subset of `RestRpc`: only the names that implement a
 * transactional unit or an identity read the server needs.
 */
export type RestUnitName = Extract<
  RestRpc,
  | 'join_event'
  | 'cast_vote'
  | 'confirm_decision'
  | 'reopen_event'
  | 'resolve_caller'
  | 'create_anonymous_user'
>;

let pool: Pool | undefined;

/** The configured connection string, or a named failure. */
export function connectionString(): string {
  const url = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;

  if (!url) {
    throw new Error(
      'DATABASE_URL is not set — the server cannot start without a database connection',
    );
  }

  return url;
}

/**
 * The shared pool. One per process; the server is stateless otherwise.
 *
 * ★ `connectionOptions` OWNS TLS AND THE TIMEOUTS.
 *
 * This used to be `new Pool({ connectionString, max: 10 })`, which had no TLS at
 * all — while the migration script appended `sslmode=require` for every managed
 * provider. A connection refused for that reason reads as an authentication
 * failure, so the pool failed its handshake and the request answered a bare 500.
 * See `server/lib/connection-options.ts` for the full account.
 */
export function servicePool(): Pool {
  if (!pool) {
    pool = new Pool({ ...connectionOptions(connectionString()), max: 10 });
  }
  return pool;
}

/** Releases the pool. Tests call this; a running server holds it until exit. */
export async function closeServicePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

/**
 * The database handle for the current request — the entry point every caller uses.
 *
 * ★ THIS IS THE WHOLE PORT.
 *
 * On Node nothing is ever bound, so this returns the shared `servicePool()` and
 * behaviour is byte-identical to before the Workers port existed. On Workers the
 * adapter binds a per-request `pg.Client` around `handleRequest`, and every call
 * site in `server/` resolves to it without knowing the difference. A `Pool` and
 * a `Client` both satisfy `Queryable` structurally, which is why no call site's
 * type had to change.
 *
 * ★ THE LOOKUP IS PER CALL, NEVER CACHED.
 *
 * `query: Queryable = scopedQueryable()` is a default parameter evaluated at each
 * invocation, so it picks up whatever is bound at that moment. Caching the result
 * at module scope would pin the first request's client for the isolate's lifetime.
 */
export function scopedQueryable(): Queryable {
  return currentQueryable() ?? servicePool();
}

export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number }>;
}

/** The exclusive unit a transaction can run on: a pooled connection, or a bound client. */
interface Exclusive extends Queryable {
  release(): void;
}

/**
 * Acquires exclusive use of the current handle.
 *
 * ★ THIS IS THE ONLY RUNTIME DIFFERENCE IN THE TRANSACTION PATH.
 *
 * A `Pool` lends one connection for the duration of the work and takes it back
 * afterwards, so a transaction cannot interleave with another borrower's. A
 * per-request `pg.Client` is ALREADY exclusive — the Worker owns it and closes
 * it at the end of the request — so there is nothing to acquire.
 *
 * ★ DISCRIMINATE ON `Pool`, NOT ON THE PRESENCE OF `connect()`.
 *
 * This is the bug that made the first Workers request fail with "Client has
 * already been connected": `pg.Client` HAS a `connect()` method — the adapter
 * calls it — so duck-typing on `connect` matched the client and then called
 * `connect()` a second time on it. `instanceof` is unambiguous because both
 * handles come from the same `pg` module.
 *
 * `release` is a no-op on the client path: the Worker's `finally` closes it, and
 * closing a request's only connection mid-transaction would abort the work the
 * transaction exists to protect.
 */
async function acquireExclusive(): Promise<Exclusive> {
  const handle = scopedQueryable();

  if (handle instanceof Pool) {
    const client: PoolClient = await handle.connect();
    return {
      async query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) {
        // `PoolClient.query` reports `rowCount: number | null`; `Queryable`
        // promises a number, and every caller here treats it as a count.
        const outcome = await client.query<T>(text, values ?? []);
        return { rows: outcome.rows, rowCount: outcome.rowCount ?? 0 };
      },
      release: () => client.release(),
    };
  }

  return {
    query: (text, values) => handle.query(text, values),
    release: () => {
      // The handle is owned by the request scope; see the comment above.
    },
  };
}

/**
 * Runs `fn` in a transaction on an exclusive handle, rolling back on any throw.
 *
 * The invite join needs this: the cap check and the insert must commit or fail
 * together, and the row lock taken by `join_event` only means anything for the
 * length of the transaction that holds it.
 */
async function withExclusiveTransaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
  const client = await acquireExclusive();

  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // A connection that cannot roll back is discarded by `release` below.
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Runs `fn` inside one transaction, rolling back on any throw. */
export async function withTransaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
  return withExclusiveTransaction(fn);
}

/**
 * Mints an anonymous identity and returns its id.
 *
 * `is_anonymous: true` is the claim FR-8.36's restrictive policy reads. A row
 * written here without it would look like an account-holder to the schema.
 *
 * This is the server-side stand-in for `supabase.auth.signInAnonymously()`.
 * The 30-per-hour per-address budget that Supabase applies in its dashboard is
 * applied by the caller (`server/routes/invite.ts`) so the limit exists on both
 * backends.
 */
export async function createAnonymousUser(): Promise<string> {
  const result = await scopedQueryable().query<{ id: string }>(
    `insert into auth.users (is_anonymous) values (true) returning id`,
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('anonymous identity could not be created');
  }

  return row.id;
}

/** Whether an identity exists. Used to reject a forged or stale user id. */
export async function userExists(userId: string): Promise<boolean> {
  const result = await scopedQueryable().query<{ id: string }>(
    `select id from auth.users where id = $1`,
    [userId],
  );

  return (result.rowCount ?? 0) > 0;
}

/**
 * Runs `fn` in a transaction with the CALLER's identity, under the service role.
 *
 * ★ WHY THE ROLE AND THE IDENTITY ARE SEPARATE.
 *
 * `join_event` is `security definer` and its execute is granted to
 * `service_role` only — a direct PostgREST call by an `authenticated` client
 * would bypass the route's rate limiter and turn it into a token-enumeration
 * oracle. So the ROLE is `service_role`, which is what makes the call
 * permitted.
 *
 * But the function reads the caller's identity from `auth.uid()`, which comes
 * from the JWT claims GUC, not from the role. So the CLAIMS are set to the
 * caller's. The two are independent: the role grants permission, the claims
 * say on whose behalf.
 *
 * A `service_role` connection with no claims would give `auth.uid()` = NULL
 * and every join would fail. A claims-only session with the `authenticated`
 * role would have no permission to call the function. Both are needed.
 *
 * ★ THE ROLE IS PINNED INSIDE THE TRANSACTION, AND THE CLAIMS ARE LOCAL.
 *
 * Both are set with transaction scope, on purpose:
 *
 * `set local role` must come AFTER `begin`. Issued outside a transaction it
 * applies to nothing and reverts immediately, which would leave Node passing
 * (its connection is already a superuser) and Workers failing — the exact class
 * of bug this port exists to fix. On a superuser connection, `revoke`/`grant`
 * are ignored entirely, so a pooled edge connection would otherwise run every
 * query as the schema owner with RLS as the only gate. `tests/db/caller-role.test.ts` asserts
 * `current_user` rather than trusting the order.
 *
 * `set_config(..., true)` is transaction-local, so it cannot outlive the
 * transaction even if the process dies mid-request — strictly safer than the
 * session-scoped form plus an explicit reset, and it needs no `finally`.
 */
export async function withCallerTransaction<T>(
  caller: Caller,
  fn: (client: Queryable) => Promise<T>,
): Promise<T> {
  const claims = JSON.stringify({
    sub: caller.userId,
    role: 'authenticated',
    is_anonymous: caller.isAnonymous,
  });

  return withExclusiveTransaction(async (tx) => {
    await tx.query('set local role service_role');
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
    return fn(tx);
  });
}

/**
 * A caller's identity for one request.
 *
 * `isAnonymous` travels with it because the schema's restrictive policy reads
 * it, and because the join route must record it on the participant row.
 */
export interface Caller {
  userId: string;
  isAnonymous: boolean;
}

/**
 * Runs a transactional unit, choosing the transport (Plan 40 T8).
 *
 * ★ THE WHOLE POINT OF THIS FUNCTION IS THAT BOTH BRANCHES RETURN THE SAME THING.
 *
 * On the `pg` transport (`DATABASE_BACKEND` unset, `pg`, `supabase`, `local_pg`)
 * this is `withCallerTransaction(caller, work)` — literally the same call, so the
 * Node and Workers paths are byte-identical (`D5`).
 *
 * On the `supabase_rest` transport there is no `begin`/`commit` to issue:
 * PostgREST executes one HTTP request as one transaction, so a sequence of
 * statements run inside `work` would each be its own transaction and the unit
 * would silently lose atomicity. Instead the unit is one RPC — the same logic
 * server-side — and the caller's identity travels as a JWT so `auth.uid()`
 * resolves exactly as it does under `set_config('request.jwt.claims', ...)`.
 *
 * ★ `work` IS NOT RUN ON THE REST PATH, AND THAT IS NOT A COMPROMISE.
 *
 * It executes inside the transaction to produce the result; the RPC executes the
 * same operations and returns the same shape. Running both would double the
 * write. Which is why `result` is a separate callback: it is the function that
 * translates either outcome into the caller's type, so the two paths cannot drift
 * in what they return.
 *
 * ★ A UNIT WITH NO RPC FAILS LOUDLY, AT STARTUP.
 *
 * See `REST_UNITS` and `assertUnitsCovered` in `supabase-rest.ts` — a unit
 * missing from the registry is a red test, not a 500 on the join path.
 */
export async function withCallerUnit<T>(options: {
  caller: Caller;
  /** The RPC name on the REST transport. Must exist in `REST_RPCS`. */
  unit: RestUnitName;
  /** The RPC's arguments. The identity is NOT among them — it comes from claims. */
  args: Readonly<Record<string, unknown>>;
  /** The `pg`-transport body. Runs inside one real transaction. */
  work: (client: Queryable) => Promise<T>;
  /** The REST-transport body. Receives the RPC's raw `jsonb` payload. */
  fromPayload: (payload: Record<string, unknown>) => T;
}): Promise<T> {
  const handle = scopedQueryable();

  if (!isRestQueryable(handle)) {
    return withCallerTransaction(options.caller, options.work);
  }

  const payload = await handle.rpc<Record<string, unknown> | null>(options.unit, options.args);

  if (payload === null) {
    throw new RestTransactionUnavailableError(options.unit);
  }

  return options.fromPayload(payload);
}

/** Resolves a bearer-user-id header into a caller, or `null` when unknown. */
export async function resolveCaller(userId: string | null | undefined): Promise<Caller | null> {
  if (!userId) return null;

  const result = await scopedQueryable().query<{ is_anonymous: boolean }>(
    `select is_anonymous from auth.users where id = $1`,
    [userId],
  );

  const row = result.rows[0];
  if (!row) return null;

  return { userId, isAnonymous: row.is_anonymous };
}
