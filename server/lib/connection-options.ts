/**
 * The one place that decides how a Postgres connection is opened.
 *
 * ★ TLS, TIMEOUTS AND KEEPALIVE WERE MISSING FROM THE RUNTIME AND PRESENT IN THE
 *   MIGRATION PATH.
 *
 * `.github/scripts/db-migrate.sh` appends `sslmode=require` for a managed
 * provider, and its header explains why the omission is so misleading: Neon and
 * Supabase refuse a connection without TLS, and the refusal "reads as `password
 * authentication failed`". So the migrations reached the database over TLS while
 * the application server did not — `servicePool()` passed only `connectionString`
 * and `max`.
 *
 * On Vercel the app opens a `Client` per request (`runWithClient`), which means
 * the first request on a cold function pays the whole TLS handshake. A handshake
 * that fails escapes the request scope and becomes a bare 500 from the driver,
 * which the client's ten-second poller then retries. That is the reported
 * "some pages get an error and only load after a second Retry".
 *
 * Two connection paths each building their own options is how they drifted, so
 * this module owns the decision and both consume it.
 */

import type { PoolConfig } from 'pg';

/**
 * How long to wait for a handshake.
 *
 * Matches `CONNECT_TIMEOUT_MS` in `server/runtime/driver.ts`. A request that
 * cannot reach the database should fail in seconds, not hang until the platform
 * kills the function.
 */
export const CONNECT_TIMEOUT_MS = 10_000;

/**
 * How long a single statement may run.
 *
 * Matches `QUERY_TIMEOUT_MS` in `server/runtime/driver.ts`. A statement that
 * outlives this is a bug, not a slow query, and holding the connection open makes
 * every later request queue behind it.
 */
export const STATEMENT_TIMEOUT_MS = 15_000;

/** Idle connections are closed rather than held against the database's limit. */
export const IDLE_TIMEOUT_MS = 30_000;

/** A host that cannot have a certificate: a container on the same machine. */
const LOOPBACK = /(?:^|@)(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/;

/**
 * Appends `sslmode=require` for a managed provider that names none.
 *
 * The rule is deliberately identical to `.github/scripts/db-migrate.sh`'s: an
 * existing `sslmode` is the operator's choice and is never overridden, and a
 * loopback host is skipped because a local Postgres commonly has no certificate —
 * `npm run db:local:up` must keep working.
 */
export function withRequiredTls(connectionString: string): string {
  if (connectionString.includes('sslmode=')) return connectionString;
  if (LOOPBACK.test(connectionString)) return connectionString;

  const separator = connectionString.includes('?') ? '&' : '?';
  return `${connectionString}${separator}sslmode=require`;
}

/**
 * The options both connection paths use.
 *
 * `ssl` is set explicitly rather than relying on the URL: `pg` only turns the
 * handshake on when either the URL carries `sslmode` or the option is present,
 * and passing both removes the ambiguity about which one won.
 *
 * `rejectUnauthorized: false` is required in practice. A managed provider
 * presents a certificate signed by its own CA, and `pg` has no way to be given
 * that CA bundle here — `sslmode=require` in `pg` currently means "encrypt", not
 * "verify", which is the same behaviour the migration script relies on.
 */
export function connectionOptions(connectionString: string): PoolConfig {
  const secured = withRequiredTls(connectionString);
  const isLocal = LOOPBACK.test(connectionString);

  return {
    connectionString: secured,
    ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    keepAlive: true,
  };
}
