/**
 * A `fetch`-signature entry for runtimes that do not honour a default export.
 *
 * ★ WHY THIS EXISTS.
 *
 * `web-fetch.ts` is a correct web-standard handler, but Vercel's Node runtime
 * reads a DEFAULT export as `(req, res) => void` and IGNORES the returned
 * `Response`. The handler ran, its result was discarded, and the request hung
 * until the 30 s timeout — the function's own warning says so:
 *
 *   WARN: default export returned a `Response`.
 *   The default-export signature is `(req, res) => void` — returns are ignored.
 *   Fix: export a `fetch` function or a named HTTP method.
 *
 * So this file exports `fetch`, which every convention that receives a real
 * `Request` understands, and delegates to the same adapter. Nothing about
 * routing or error shapes moves here.
 */
import handler from './web-fetch';

export function fetch(request: Request): Promise<Response> {
  return handler(request);
}
