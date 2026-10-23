/**
 * The long-lived `fetch` entry (Plan 40 T5).
 *
 * ★ THE CONVENTION, NOT THE HOST.
 *
 * This adapter serves any runtime that keeps **one process alive across many
 * requests** and hands a web-standard `(request: Request) => Response` handler to
 * its own server bootstrap. That is the opposite situation from every other file
 * in this directory:
 *
 * | Entry | Process lifetime | Client |
 * |---|---|---|
 * | `web-fetch.ts`, `event-object.ts`, … | one per request | created per request, always closed |
 * | **this file** | one per many requests | **the shared pool** |
 *
 * ★ AND THAT IS ALSO A CONSTRAINT ON WHAT THIS FILE MAY DO.
 *
 * `server/lib/db-scope.ts:54-60` refuses an overlapping scope on a DIFFERENT
 * queryable. One shared pool is the same object for every request, so concurrent
 * requests share it safely — the refcount handles that case. Creating a client
 * per request instead would make every concurrent pair a hard 500, because two
 * scopes would hold two different queryables at once.
 *
 * ★ WHERE THE POOL COMES FROM.
 *
 * `servicePool()`, unchanged. It reads `DATABASE_URL` lazily on first query, so
 * nothing here validates it — a misconfiguration surfaces as a 500 on the first
 * request that touches the database, which is what the Node listener does too.
 *
 * ★ THE REALTIME BRIDGE IS NOT STARTED HERE.
 *
 * A long-lived process has the sockets the bridge needs, but starting it inside a
 * request handler would open a new `LISTEN` connection per request. It stays a
 * separate deployment (`npm run server:realtime`); `docs/RUNBOOK.md` describes
 * running both.
 */

import { handleRequest } from '../app';
import { withRequestQueryable } from '../lib/db-scope';
import { servicePool } from '../lib/supabase';

/**
 * The fetch handler, with the pool injectable for tests.
 *
 * A long-lived process binds the shared pool — the same object for every
 * request — so `withRequestQueryable` takes the sharing branch rather than the
 * throw.
 */
export function createLongLivedHandler(options: { pool?: ReturnType<typeof servicePool> } = {}) {
  return async function fetch(request: Request): Promise<Response> {
    return withRequestQueryable(options.pool ?? servicePool(), () => handleRequest(request));
  };
}

export default {
  /**
   * Wire this to whatever bootstrap the host provides, e.g.
   * `serve({ fetch: createLongLivedHandler().fetch })`.
   *
   * The port and hostname are deliberately not read here: a bootstrap function
   * requires its own `port`/`hostname` options, and a value read from this module
   * would be a second source of truth for `PORT` next to `server/index.ts:65`.
   */
  fetch: createLongLivedHandler(),
};
