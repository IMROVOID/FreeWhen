/**
 * The web-standard `fetch` entry (Plan 40 T5).
 *
 * ★ THE CONVENTION, NOT THE HOST.
 *
 * This adapter serves any runtime whose convention is a default export taking a
 * real `Request` and returning a real `Response`:
 *
 * ```ts
 * export default async function handler(request: Request): Promise<Response>
 * ```
 *
 * Those runtimes need nothing translated — only the per-request client lifecycle,
 * which is `runWithClient`. Point the runtime's function directory or rewrite rule
 * at this file; there is no host-specific configuration in it.
 *
 * ★ THE PATH ARRIVES INTACT, AND MUST STAY THAT WAY.
 *
 * `handleRequest` matches on path segments (`server/app.ts:223`), so the path must
 * reach it exactly as the client sent it — `/api/events` as `/api/events`. A
 * rewrite rule that strips the prefix would turn that into `/events` and 404 the
 * entire surface. If the runtime lets you configure a rewrite, use a catch-all.
 *
 * ★ THE CREDENTIAL IS AN ORDINARY ENVIRONMENT VARIABLE.
 *
 * There is no binding object: `DATABASE_URL` is set in the host's environment and
 * is already in `process.env`.
 */

import { bindEnvironment, defaultClientFactory, runWithClient } from './driver';

export default async function handler(request: Request): Promise<Response> {
  bindEnvironment(process.env);

  const connectionString = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    return Response.json(
      { error: 'misconfigured', detail: 'DATABASE_URL is not set' },
      { status: 500 },
    );
  }

  return runWithClient(connectionString, defaultClientFactory, request);
}
