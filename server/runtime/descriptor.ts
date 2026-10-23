/**
 * The context/handler entry (Plan 40 T4).
 *
 * ★ THE CONVENTION, NOT THE HOST.
 *
 * This adapter serves any runtime whose convention is
 *
 * ```ts
 * handler(context, request) => { status, headers, body }
 * ```
 *
 * where `context` is the runtime's own invocation object and `request` is a
 * *descriptor* — `method`, `url`, `headers`, `body` — rather than a Node stream
 * or a web `Request`. It is the third distinct shape in common use, and it is
 * worth its own file: folding it into the Node-signature entry would mean that
 * file knew two body models at once.
 *
 * ★ THE HEADER MAP IS ROUTED THROUGH THE NORMALISER.
 *
 * Some runtimes deliver `headers` as a plain object and some as a `Map`-like
 * iterable; both are legal here. This adapter never touches the field directly —
 * it hands it to `toRequest` in `http-normalise.ts`, which accepts either. That
 * is why this file has no header handling of its own.
 *
 * ★ THE RETURN VALUE CARRIES THE STATUS EXPLICITLY.
 *
 * A bare-body return would have the platform assume 200 — turning every
 * preflight into a 200 and every 4xx into a success. The status is always
 * present, via `toDescriptorResult`.
 *
 * ★ `context` IS UNUSED, AND THE LOGGING STAYS ON `stderr`.
 *
 * A failure is written by `runWithClient` to `process.stderr`, which every
 * host-managed runtime captures. Logging through the context as well would
 * duplicate every line in a second format, which the repo's `gate:logs` shape
 * (`component: event: generic-detail`) exists to prevent.
 */

import {
  bindEnvironment,
  defaultClientFactory,
  runWithClient,
  type ClientFactory,
} from './driver';
import { toRequest, type NodeStyleHeaders } from './http-normalise';
import { toDescriptorResult, type DescriptorResult } from './response';

/** The subset of a request descriptor this adapter reads. */
export interface DescriptorRequest {
  method?: string;
  url?: string;
  headers?: NodeStyleHeaders;
  /** Already-parsed JSON on some runtimes; a string or bytes on others. */
  body?: unknown;
  /** The unparsed original bytes, when the runtime provides them. */
  rawBody?: unknown;
}

/** The invocation context. Unused today; kept so the signature is honest. */
export interface InvocationContext {
  invocationId?: string;
}

/**
 * The body as bytes.
 *
 * ★ THREE POSSIBLE SHAPES, AND ALL THREE OCCUR.
 *
 * Some runtimes give `body` as the PARSED value when the request advertised
 * `application/json` — an object, not a string. Re-encoding it is not a
 * round-trip of the original bytes, but it is the only correct option: the
 * `Request` a route reads is `request.json()`, and a route that received an
 * object would fail to parse at all. `rawBody` is preferred when present because
 * it preserves the original bytes exactly.
 */
function bodyOf(request: DescriptorRequest): Uint8Array | undefined {
  if (request.rawBody instanceof Uint8Array) return request.rawBody;
  if (typeof request.rawBody === 'string') return new TextEncoder().encode(request.rawBody);

  const body = request.body;
  if (body === undefined || body === null) return undefined;
  if (body instanceof Uint8Array) return body;
  if (typeof body === 'string') return new TextEncoder().encode(body);

  return new TextEncoder().encode(JSON.stringify(body));
}

/**
 * The handler, with the client factory lifted out.
 *
 * `createDescriptorHandler()` is the export a deployment registers;
 * `createDescriptorHandler({ createClient })` is what the tests drive.
 */
export function createDescriptorHandler(options: { createClient?: ClientFactory } = {}) {
  const createClient = options.createClient ?? defaultClientFactory;

  return async function descriptorHandler(
    _context: InvocationContext,
    request: DescriptorRequest,
  ): Promise<DescriptorResult> {
    bindEnvironment(process.env);

    const connectionString = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
    if (!connectionString) {
      return toDescriptorResult(
        Response.json(
          { error: 'misconfigured', detail: 'DATABASE_URL is not set' },
          { status: 500 },
        ),
      );
    }

    const built = toRequest({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: bodyOf(request),
    });

    const response = await runWithClient(connectionString, createClient, built);
    return toDescriptorResult(response);
  };
}
