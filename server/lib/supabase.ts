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

/** The shared pool. One per process; the server is stateless otherwise. */
export function servicePool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: connectionString(), max: 10 });
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

export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number }>;
}

/**
 * Runs `fn` inside one transaction, rolling back on any throw.
 *
 * The invite join needs this: the cap check and the insert must commit or fail
 * together, and the row lock taken by `join_event` only means anything for the
 * length of the transaction that holds it.
 */
export async function withTransaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
  const client: PoolClient = await servicePool().connect();

  try {
    await client.query('begin');
    const result = await fn({
      async query(text, values = []) {
        const outcome = await client.query(text, values);
        return { rows: outcome.rows, rowCount: outcome.rowCount ?? 0 };
      },
    });
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
  const result = await servicePool().query<{ id: string }>(
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
  const result = await servicePool().query<{ id: string }>(
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
 * The claims MUST be reset before the client is released: they persist for the
 * life of a pooled connection, and a connection left carrying one caller's
 * identity would let the next borrower's service-role query act as them.
 */
export async function withCallerTransaction<T>(
  caller: Caller,
  fn: (client: Queryable) => Promise<T>,
): Promise<T> {
  const client = await servicePool().connect();

  const claims = JSON.stringify({
    sub: caller.userId,
    role: 'authenticated',
    is_anonymous: caller.isAnonymous,
  });

  try {
    await client.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
    await client.query('begin');

    const result = await fn({
      async query(text, values = []) {
        const outcome = await client.query(text, values);
        return { rows: outcome.rows, rowCount: outcome.rowCount ?? 0 };
      },
    });

    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // A connection that cannot roll back is discarded on release.
    }
    throw error;
  } finally {
    // The claims reset runs BEFORE the release: a connection returned to the
    // pool still carrying one caller's identity is the one leak this helper
    // exists to prevent.
    try {
      await client.query('reset request.jwt.claims');
    } catch {
      // A broken connection is discarded by `release` below.
    }
    client.release();
  }
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

/** Resolves a bearer-user-id header into a caller, or `null` when unknown. */
export async function resolveCaller(userId: string | null | undefined): Promise<Caller | null> {
  if (!userId) return null;

  const result = await servicePool().query<{ is_anonymous: boolean }>(
    `select is_anonymous from auth.users where id = $1`,
    [userId],
  );

  const row = result.rows[0];
  if (!row) return null;

  return { userId, isAnonymous: row.is_anonymous };
}
