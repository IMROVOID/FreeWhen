/**
 * The PostgREST transport's failure vocabulary (Plan 40 T6).
 *
 * ★ THESE LIVE APART FROM THE TRANSPORT ITSELF FOR ONE REASON.
 *
 * `REST_UNSUPPORTED_STATEMENT` and `REST_TRANSACTION_UNAVAILABLE` are the two
 * loud refusals the whole design turns on, and `server/lib/supabase.ts` must be
 * able to throw one of them without importing the transport. Keeping them in
 * their own module means the error type is available to the dispatcher without
 * dragging `fetch`, the header builders and the row decoding into the `pg`-only
 * bundle.
 *
 * ★ THE MESSAGES ARE SAFE TO LOG.
 *
 * Every statement in this codebase is a literal in `server/lib` with its values
 * bound as parameters, so the text carries no row, no host and no credential. The
 * redaction rule that governs logs is about `pg`'s error strings, which can carry
 * all three. Including the statement is what makes the failure diagnosable.
 */

/**
 * Raised for a statement the registry does not cover.
 *
 * ★ THE FAILURE THIS PREVENTS.
 *
 * PostgREST is not "arbitrary SQL over HTTP" — one request is one statement
 * against one table or one RPC. Guessing at a translation for a multi-table read
 * would return wrong data silently, which is worse than refusing.
 */
export class UnsupportedStatementError extends Error {
  constructor(readonly statement: string) {
    super(
      `REST_UNSUPPORTED_STATEMENT: the PostgREST transport has no unit for ${JSON.stringify(statement.slice(0, 120))} — ` +
        'add a registry entry in server/lib/supabase-rest.ts and an RPC in server/sql/, or run with DATABASE_BACKEND=pg',
    );
    this.name = 'UnsupportedStatementError';
  }
}

/**
 * Raised when a transactional unit has no RPC.
 *
 * ★ THIS IS THE ERROR THAT PREVENTS A SILENTLY NON-ATOMIC JOIN.
 *
 * `withExclusiveTransaction` issues `begin` / work / `commit` as three round
 * trips, which PostgREST cannot replay. The only correct answer is one RPC per
 * transactional unit. A unit without an RPC must fail here, at call time, rather
 * than by firing its statements one by one over separate requests: `join_event`'s
 * whole reason for existing (`server/sql/join_event.sql:4-10`) is that the
 * participant cap is a security bound, and a sequential replay reopens exactly
 * the race that lock closes.
 */
export class RestTransactionUnavailableError extends Error {
  constructor(readonly unit: string) {
    super(
      `REST_TRANSACTION_UNAVAILABLE: transactional unit ${JSON.stringify(unit)} has no RPC — ` +
        'PostgREST executes one request as one transaction, so this unit cannot be replayed ' +
        'statement-by-statement without becoming non-atomic. Add an RPC in server/sql/ or run with DATABASE_BACKEND=pg',
    );
    this.name = 'RestTransactionUnavailableError';
  }
}

/** Raised when the HTTP call itself fails. Never carries the key. */
export class RestRequestError extends Error {
  constructor(readonly status: number, readonly detail: string) {
    // ★ THE DETAIL IS POSTGREST'S OWN `message`, NOT A HEADER DUMP.
    //
    // PostgREST answers a failed RPC with `{ message, code, details, hint }`.
    // `message` is a constraint or function name, which is a schema fact and not
    // a credential. The request headers are never included.
    super(`REST_TRANSPORT_FAILED: HTTP ${status}${detail ? `: ${detail}` : ''}`);
    this.name = 'RestRequestError';
  }
}
