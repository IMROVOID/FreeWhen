/**
 * Request-scoped database access (Plan 39 T2).
 *
 * ★ THE PROBLEM THIS SOLVES.
 *
 * `servicePool()` returns one process-wide `pg.Pool`. On Node that is correct.
 * On Cloudflare Workers there is no process to hold a pool — Hyperdrive pools at
 * the edge, and each request must build its own short-lived `pg.Client`.
 *
 * Threading a connection parameter through every service function would be a
 * large, risky diff that changes nothing on the Node path. So the switch lives
 * here, in one module-level binding, and `scopedQueryable()` in `supabase.ts`
 * reads it.
 *
 * ★ NODE BEHAVIOUR IS BYTE-IDENTICAL WHEN NOTHING IS BOUND.
 *
 * `withRequestQueryable` binds a queryable for the duration of a callback and
 * restores whatever was there before. When nothing binds it — the whole Node
 * server, and every DB test before Task 6 — `scopedQueryable()` returns the same
 * shared Pool object it always did.
 *
 * ★ WHY NOT AsyncLocalStorage.
 *
 * `node:async_hooks` is not available on Workers, and pulling it in for a
 * single-request binding would re-introduce the exact portability problem this
 * change exists to remove. An explicit bind/restore around a callback is
 * synchronous, predictable, and works on both runtimes.
 *
 * The cost is that a binding is only visible to code running INSIDE the
 * callback, and that two overlapping callbacks would share one slot. The guard
 * below turns that cost into a hard error rather than a silent leak.
 */

import type { QueryResultRow } from 'pg';

import type { Queryable } from './supabase';

/**
 * The queryable bound for the current scope, or `undefined`.
 *
 * Module-level rather than per-request because both runtimes await the whole
 * request inside the binding: Node's `call()` harness and the Worker adapter
 * each bind once and await `handleRequest` to completion. `active` is what makes
 * that an invariant instead of an assumption.
 */
let bound: Queryable | undefined;
let active = false;
/** How many overlapping scopes are open on the SAME queryable. */
let sharing = 0;

/**
 * Runs `fn` with `queryable` bound as the process's database handle.
 *
 * ★ OVERLAPPING SCOPES ON DIFFERENT QUERYABLES THROW.
 *
 * There is exactly one slot. If a second scope opening while the first is still
 * active binds a DIFFERENT queryable, whichever bound last serves both — so
 * request A's queries would run on request B's connection. On Workers that
 * connection carries B's JWT claims and therefore B's identity: a cross-user RLS
 * leak, not a performance problem. It must fail loudly.
 *
 * ★ OVERLAPPING SCOPES ON THE SAME QUERYABLE DO NOT.
 *
 * On Node the harness binds one shared `Pool`, so concurrent requests bind the
 * identical object. There is no second connection to confuse it with, and no
 * identity to swap: `withCallerTransaction` sets the claims with transaction
 * scope, so each request's `auth.uid()` is its own regardless of interleaving.
 * Rejecting that case would fail the database suite's deliberate concurrency
 * tests — the cap race and the concurrent double-write both issue simultaneous
 * requests on purpose, and they are proving row locking, not scope isolation.
 *
 * The refcount exists so the slot is only cleared when the last sharer leaves;
 * clearing it on the first exit would unbind the requests still running.
 *
 * ★ A NESTED SCOPE ON A DIFFERENT QUERYABLE IS A BUG IN THE CALLER.
 *
 * Not a legitimate pattern to support: it means a request created a second
 * client, which on Workers is a connection the platform cannot reclaim.
 *
 * ★ `fn` MUST BE FULLY AWAITED.
 *
 * Anything started here and not awaited escapes the scope and will see the outer
 * (pool) binding. The Worker entry awaits `handleRequest` and every handler it
 * awaits in turn; the DB harness does the same.
 */
export async function withRequestQueryable<T>(
  queryable: Queryable,
  fn: () => Promise<T>,
): Promise<T> {
  if (active && bound !== queryable) {
    throw new Error('db-scope: nested/concurrent binding — a request scope is already active');
  }

  const outermost = !active;

  if (outermost) {
    bound = queryable;
    active = true;
  }
  sharing += 1;

  try {
    return await fn();
  } finally {
    sharing -= 1;
    if (sharing === 0) {
      bound = undefined;
      active = false;
    }
  }
}

/** The currently bound queryable, if any. The single switch `scopedQueryable()` reads. */
export function currentQueryable(): Queryable | undefined {
  return bound;
}

/** Clears the scope. Test hook only — a live request always leaves it clean. */
export function resetDbScope(): void {
  bound = undefined;
  active = false;
  sharing = 0;
}

export type { Queryable, QueryResultRow };
