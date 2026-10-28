/**
 * Request-scoped database access (Plan 39 T2).
 *
 * ★ THE PROBLEM THIS SOLVES.
 *
 * `servicePool()` returns one process-wide `pg.Pool`. On Node that is correct.
 * On a request-scoped runtime there is no process to hold a pool — the platform
 * pools connections in front of the database, and each request must build its own
 * short-lived `pg.Client`.
 *
 * Threading a connection parameter through every service function would be a
 * large, risky diff that changes nothing on the Node path. So the switch lives
 * here, in one binding, and `scopedQueryable()` in `supabase.ts` reads it.
 *
 * ★ THE BINDING IS PER ASYNC CONTEXT, NOT PER PROCESS.
 *
 * This used to be a single module-level slot with a `sharing` refcount, and a
 * warm serverless function broke it: Vercel keeps an isolate alive between
 * requests and will run several concurrently. Each request builds its OWN
 * `pg.Client` (`server/runtime/driver.ts`), so the second concurrent request
 * bound a different object than the first and the guard threw
 * "nested/concurrent binding — a request scope is already active". The request
 * then answered 500 `INTERNAL_ERROR`, and the client retried until it happened
 * to land alone — the intermittent failure reported on every page load.
 *
 * A single slot cannot express "request A's queryable" and "request B's
 * queryable" at once. `AsyncLocalStorage` can: it stores the binding in the
 * async context rather than on the module, so overlapping requests each see
 * their own value and neither can be served the other's connection.
 *
 * ★ WHY AsyncLocalStorage IS ALLOWED HERE NOW.
 *
 * The module previously avoided `node:async_hooks` for portability, because a
 * Worker has no `node` built-ins. But the only runtime that binds a per-request
 * client is the Node-style one — `driver.ts` and `long-lived-fetch.ts`, both of
 * which run on Vercel's Node functions, not on Workers. `long-lived-fetch.ts`
 * runs the always-on Node process. So the import is guarded: when
 * `AsyncLocalStorage` is unavailable the module degrades to the old single-slot
 * behaviour instead of failing to load.
 *
 * ★ NODE BEHAVIOUR IS UNCHANGED WHEN NOTHING IS BOUND.
 *
 * `withRequestQueryable` binds a queryable in the async context of a callback.
 * When nothing binds it — the whole Node server's pool path — `scopedQueryable()`
 * returns the same shared Pool object it always did.
 */

import type { QueryResultRow } from 'pg';

import type { Queryable } from './supabase';

/**
 * The async-context store, when the runtime has one.
 *
 * `require` rather than `import` on purpose: a static `import 'node:async_hooks'`
 * is resolved at load time, and a bundler targeting a non-Node runtime fails the
 * whole module for a feature it will never reach.
 */
type Store = { queryable: Queryable };

interface AsyncStorageLike {
  getStore(): Store | undefined;
  run<R>(store: Store, callback: () => R): R;
}

function loadAsyncStorage(): AsyncStorageLike | null {
  try {
    // Dynamic on purpose: a static `import 'node:async_hooks'` is resolved at
    // load time, so a bundler targeting a runtime without `node:` built-ins would
    // fail this whole module for a feature that runtime never reaches.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const hooks = require('node:async_hooks') as {
      AsyncLocalStorage: new () => AsyncStorageLike;
    };
    return new hooks.AsyncLocalStorage();
  } catch {
    return null;
  }
}

const storage = loadAsyncStorage();

/**
 * The fallback slot, used only where `AsyncLocalStorage` is missing.
 *
 * Kept for the environments the previous single-slot design actually served
 * correctly: a runtime that awaits one request at a time. The refcount lets
 * overlapping scopes on the SAME queryable share it, which is the Node test
 * harness's shape (one shared `Pool`).
 */
let fallbackBound: Queryable | undefined;
let fallbackActive = false;
/** How many overlapping scopes are open on the SAME queryable. */
let fallbackSharing = 0;

/**
 * Runs `fn` with `queryable` bound as the database handle for this async context.
 *
 * ★ OVERLAPPING REQUESTS EACH SEE THEIR OWN BINDING.
 *
 * That is the whole point: Vercel runs requests concurrently in one warm
 * isolate, and each one owns a separate `pg.Client`. Under the old single slot
 * the second bind was fatal. Now the two contexts are independent, so there is
 * no cross-request connection — and therefore no cross-user identity — to leak.
 *
 * ★ A NESTED SCOPE ON A DIFFERENT QUERYABLE IS STILL A BUG.
 *
 * Inside one request, opening a second scope with a different client means the
 * request built a client of its own that the platform cannot reclaim. That is
 * not a concurrency pattern to support, so it still fails loudly.
 *
 * ★ `fn` MUST BE FULLY AWAITED.
 *
 * Anything started here and not awaited escapes the context and sees the
 * outer (pool) binding. Every caller awaits `handleRequest` to completion.
 */
export async function withRequestQueryable<T>(
  queryable: Queryable,
  fn: () => Promise<T>,
): Promise<T> {
  if (storage) {
    const outer = storage.getStore()?.queryable;

    if (outer !== undefined && outer !== queryable) {
      throw new Error('db-scope: nested binding — a request scope is already active');
    }

    return storage.run({ queryable }, fn);
  }

  if (fallbackActive && fallbackBound !== queryable) {
    throw new Error('db-scope: nested/concurrent binding — a request scope is already active');
  }

  const outermost = !fallbackActive;

  if (outermost) {
    fallbackBound = queryable;
    fallbackActive = true;
  }
  fallbackSharing += 1;

  try {
    return await fn();
  } finally {
    fallbackSharing -= 1;
    if (fallbackSharing === 0) {
      fallbackBound = undefined;
      fallbackActive = false;
    }
  }
}

/** The queryable bound to this async context, if any. What `scopedQueryable()` reads. */
export function currentQueryable(): Queryable | undefined {
  if (storage) return storage.getStore()?.queryable;
  return fallbackBound;
}

/** Clears the fallback scope. Test hook only — a live request always leaves it clean. */
export function resetDbScope(): void {
  fallbackBound = undefined;
  fallbackActive = false;
  fallbackSharing = 0;
}

export type { Queryable, QueryResultRow };
