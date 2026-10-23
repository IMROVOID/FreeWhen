/**
 * The database *transport* switch (Plan 40 T2).
 *
 * ★ THERE ARE NOW TWO ORTHOGONAL `DATABASE_BACKEND` VOCABULARIES, AND THIS FILE
 * EXISTS TO KEEP THEM APART.
 *
 * `scripts/db/backends.ts` already reads `DATABASE_BACKEND` and it means
 * **which deployment stack** you are running:
 *
 * | value | stack |
 * |---|---|
 * | `supabase` (default) | the self-hosted Supabase 5-container stack |
 * | `local_pg` | plain PostgreSQL + PostgREST, tokens from `server/auth` |
 *
 * This module means **which wire protocol the server uses to reach the
 * database**:
 *
 * | value | transport |
 * |---|---|
 * | `pg` (default) | `pg` over a TCP socket — a `Pool` on Node, a `Client` per request on Workers |
 * | `supabase_rest` | PostgREST over HTTPS — no socket, no direct Postgres credential |
 *
 * Those are different questions with the same variable name. Both existing
 * values describe a Postgres reached over TCP today, so **this module aliases
 * them to `pg`** and treats `supabase_rest` as the new value. Without that
 * reconciliation an operator with `DATABASE_BACKEND=local_pg` in a working
 * `.env` would hit the throw below the moment they upgraded — a boot failure
 * caused entirely by this feature.
 *
 * ★ AN UNKNOWN VALUE FAILS LOUDLY.
 *
 * The same rule `scripts/db/backends.ts:28` and `.env.example:86-89` already
 * state. A typo must not silently select the default: the operator would
 * believe they had deployed the REST transport while the host quietly opened a
 * TCP socket with credentials it may not have, and the failure would surface as
 * a connection error in production rather than a message at boot.
 *
 * ★ PURITY.
 *
 * No I/O and no side effects beyond the default argument, which reads the
 * environment. `resolveBackend(value)` is total and testable; the throw is the
 * only failure and it is synchronous.
 */

/**
 * Every accepted value, aliases included.
 *
 * `supabase` and `local_pg` are the pre-existing stack values from
 * `scripts/db/backends.ts`; they are transported over TCP like plain `pg`, so
 * they are accepted and resolved to it rather than rejected.
 */
export const BACKENDS = ['pg', 'supabase_rest'] as const;

export type Backend = (typeof BACKENDS)[number];

/**
 * The values that mean "Postgres over TCP this server opens itself".
 *
 * `supabase` and `local_pg` are here because both stacks are Postgres reached
 * on port 5432/6543 today — the stack name was never a statement about the
 * transport.
 */
export const PG_ALIASES = ['supabase', 'local_pg'] as const;

/** The default transport. Today's behaviour, and `D5`'s byte-identity guarantee. */
export const DEFAULT_BACKEND: Backend = 'pg';

/** The variable that selects the transport. */
export const BACKEND_ENV_VAR = 'DATABASE_BACKEND';

/** Raised when `DATABASE_BACKEND` names a transport that does not exist. */
export class UnknownTransportError extends Error {
  constructor(readonly value: string) {
    super(
      `unknown DATABASE_BACKEND ${JSON.stringify(value)} — expected one of ` +
        `${BACKENDS.join(', ')} (or the stack aliases ${PG_ALIASES.join(', ')} for 'pg')`,
    );
    this.name = 'UnknownTransportError';
  }
}

/**
 * Resolves the transport in effect.
 *
 * - `undefined` / `''` → `'pg'` (today's behaviour)
 * - `'pg'` → `'pg'`
 * - `'supabase'` / `'local_pg'` → `'pg'` (stack aliases; both speak TCP)
 * - `'supabase_rest'` → `'supabase_rest'`
 * - anything else → throws, naming every accepted value
 */
export function resolveBackend(
  value: string | undefined | null = process.env[BACKEND_ENV_VAR],
): Backend {
  if (value === undefined || value === null || value.trim() === '') {
    return DEFAULT_BACKEND;
  }

  const normalised = value.trim().toLowerCase();

  if ((PG_ALIASES as readonly string[]).includes(normalised)) return 'pg';
  if ((BACKENDS as readonly string[]).includes(normalised)) return normalised as Backend;

  throw new UnknownTransportError(value);
}

/** Whether the REST transport is in effect. The one branch call sites take. */
export function usesRestTransport(
  value: string | undefined | null = process.env[BACKEND_ENV_VAR],
): boolean {
  return resolveBackend(value) === 'supabase_rest';
}
