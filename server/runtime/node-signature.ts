/**
 * The Node-signature entry (Plan 40 T4).
 *
 * ★ THE CONVENTION, NOT THE HOST.
 *
 * This adapter serves any runtime that invokes a function with a plain
 * `node:http` request/response pair:
 *
 * ```ts
 * handler(req: IncomingMessage, res: ServerResponse) => void
 * ```
 *
 * That is the shape `server/index.ts` already implements for a listener. What
 * differs on a host-managed runtime is that the function owns no port and the
 * platform may invoke it concurrently — so the client is still created **per
 * invocation** and closed unconditionally.
 *
 * ★ THE HOST COMES FROM THE REQUEST, NOT FROM A CONSTANT.
 *
 * `PUBLIC_BASE_URL` is what invite links are built from, and it is a configured
 * value (`server/lib/http.ts:117`). The `Request`'s own origin is only used for
 * routing, and it is reconstructed from the forwarding headers because a
 * host-managed runtime terminates the origin in front of the function: the
 * listener only ever sees an internal address in `host`.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  bindEnvironment,
  defaultClientFactory,
  runWithClient,
  type ClientFactory,
} from './driver';
import { readBody, toRequest } from './http-normalise';
import { toNodeWritable } from './response';

/** The first value of a possibly-repeated header. */
function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The origin the function was reached on.
 *
 * The public authority arrives in `x-forwarded-host` (and the scheme in
 * `x-forwarded-proto`) because the listener only sees the internal one. Falling
 * back to `host` covers a direct invocation and a local development harness.
 */
function originOf(req: IncomingMessage): string {
  const host =
    firstHeader(req.headers['x-forwarded-host']) ??
    firstHeader(req.headers.host) ??
    'localhost';
  const proto = firstHeader(req.headers['x-forwarded-proto']) ?? 'https';

  return `${proto}://${host}`;
}

/**
 * The handler, with the client factory lifted out.
 *
 * `createNodeSignatureHandler()` is what an entry file exports;
 * `createNodeSignatureHandler({ createClient })` is what the tests drive.
 */
export function createNodeSignatureHandler(options: { createClient?: ClientFactory } = {}) {
  const createClient = options.createClient ?? defaultClientFactory;

  return async function nodeSignatureHandler(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    bindEnvironment(process.env);

    const connectionString = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
    if (!connectionString) {
      await toNodeWritable(
        Response.json(
          { error: 'misconfigured', detail: 'DATABASE_URL is not set' },
          { status: 500 },
        ),
        res,
      );
      return;
    }

    const origin = originOf(req);
    const body = await readBody(req);

    const request = toRequest(
      { method: req.method, url: req.url, headers: req.headers, body },
      { origin },
    );

    const response = await runWithClient(connectionString, createClient, request);
    await toNodeWritable(response, res);
  };
}
