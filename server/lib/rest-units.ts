/**
 * The PostgREST unit registry (Plan 40 T6/T8).
 *
 * ★ WHY A REGISTRY AND NOT A PARSER.
 *
 * PostgREST executes one HTTP request as one statement against one table or one
 * RPC, and offers no begin/commit across requests
 * (postgrest.org/…/transactions). This module therefore cannot translate SQL in
 * the general case; it enumerates the units the server actually needs, each
 * knowing the one call that implements it.
 *
 * ★ THE LOAD-TIME GUARD.
 *
 * `REST_UNITS` is the table `server/lib/supabase.ts` dispatches on. If a unit is
 * added to a route without an RPC, a REST deployment would fail at request time —
 * on the join or voting path, in production, as a 500. `assertUnitsCovered()`
 * turns that into a red `npm test` instead.
 */

/**
 * The table-name vocabulary PostgREST understands, so a typo in the registry is
 * a type error rather than a 404 at runtime.
 */
export const REST_TABLES = [
  'event',
  'participant',
  'proposal',
  'vote',
  'start_point',
  'comment',
] as const;

export type RestTable = (typeof REST_TABLES)[number];

/** The RPCs this transport can call. Mirrors `server/sql/*.rpc.sql` + `join_event`. */
export const REST_RPCS = [
  'join_event',
  'redeem_invite',
  'cast_vote',
  'confirm_decision',
  'reopen_event',
  'create_proposal',
  'create_event',
  'resolve_caller',
  'create_anonymous_user',
] as const;

export type RestRpc = (typeof REST_RPCS)[number];

/** One registry entry: the PostgREST call that implements a statement. */
export interface RestUnit {
  /** The table or RPC this statement targets. */
  readonly target: RestTable | RestRpc;
  /** `table` reads/writes go through `/<prefix>/<table>`; `rpc` through `/<prefix>/rpc/<fn>`. */
  readonly kind: 'table' | 'rpc';
}

/**
 * The transactional units the server routes through a transport, and the RPC
 * each one needs.
 *
 * ★ A UNIT WITH NO RPC IS A DECLARED GAP, NOT AN OVERSIGHT.
 *
 * A unit that cannot be expressed as one RPC — because it needs a statement
 * PostgREST does not expose — must say so here rather than being silently
 * absent. `withCallerUnit` then throws `RestTransactionUnavailableError` for it
 * on the REST transport and works normally on `pg`. That keeps the Node path
 * whole and refuses the REST path rather than faking atomicity.
 */
export const REST_UNITS = {
  join_event: 'join_event',
  cast_vote: 'cast_vote',
  confirm_decision: 'confirm_decision',
  reopen_event: 'reopen_event',
  resolve_caller: 'resolve_caller',
  create_anonymous_user: 'create_anonymous_user',
} as const satisfies Readonly<Record<string, RestRpc>>;

export type RestUnitName = keyof typeof REST_UNITS;

/**
 * Verifies every declared unit has an RPC the transport can actually call.
 *
 * Throws — it does not warn. A unit without an RPC is a security-relevant gap,
 * not a quality issue: replaying its statements sequentially would reopen the
 * concurrency races the RPCs exist to close.
 */
export function assertUnitsCovered(): void {
  const missing = Object.entries(REST_UNITS)
    .filter(([, rpc]) => !(REST_RPCS as readonly string[]).includes(rpc))
    .map(([unit]) => unit);

  if (missing.length > 0) {
    throw new Error(
      `REST_UNIT_WITHOUT_RPC: ${missing.join(', ')} — every unit in REST_UNITS must name an ` +
        'RPC in REST_RPCS and a matching .sql file in server/sql/',
    );
  }
}
