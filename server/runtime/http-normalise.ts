/**
 * Node-style request normalisation (Plan 40 T3).
 *
 * ★ WHY THIS IS A SEPARATE MODULE.
 *
 * Several runtimes hand the handler something that is *not* a `Request`: a
 * method, a URL, a header bag and a body stream. `server/app.ts` speaks `Request`
 * only, so every one of those runtimes needs the same translation.
 *
 * Putting it here rather than in each adapter means the body-buffering rule, the
 * header-case rule and the "GET has no body" rule are decided once. They are the
 * three places a hand-written adapter gets it wrong.
 *
 * ★ PURE, AND SYNCHRONOUS ON PURPOSE.
 *
 * The body is already a `Buffer`/`Uint8Array` by the time this is called: every
 * runtime buffers the body before invoking the handler — either as a string, or
 * as a stream the adapter has already drained. Keeping `toRequest` synchronous
 * makes it trivially testable and keeps the async part — reading the stream —
 * visible in the adapter that owns the stream type.
 */

/**
 * The header shapes the runtimes actually deliver.
 *
 * Node gives `Record<string, string | string[] | undefined>` and preserves the
 * incoming case. Other runtimes give an object whose values are
 * `string | undefined`, or a `Map`-like iterable. All are accepted rather than
 * making each adapter convert first.
 */
export type NodeStyleHeaders =
  | Record<string, string | string[] | number | undefined>
  | Iterable<readonly [string, string]>;

export interface NodeStyleRequest {
  method?: string | undefined;
  url?: string | undefined;
  headers?: NodeStyleHeaders | undefined;
  /** The already-buffered body. `undefined` and an empty array are equivalent. */
  body?: Uint8Array | string | undefined;
}

/** The origin assumed when a platform hands over only a path. */
export const DEFAULT_ORIGIN = 'http://localhost';

/**
 * Whether a method may carry a body in a `Request`.
 *
 * ★ `GET` AND `HEAD` MUST NOT, AND THE PLATFORM WILL SEND ONE ANYWAY.
 *
 * The `Request` constructor throws `TypeError: Request with GET/HEAD method
 * cannot have body`. Event-object runtimes both occasionally
 * deliver a `GET` with a body (a proxy forwarding a health check, or a client
 * sending an empty JSON document), so constructing the `Request` without this
 * guard turns a request that would have 404'd or 204'd into a 500.
 *
 * Mirrors `server/index.ts:37` exactly — the same three conditions, so the Node
 * listener and an adapter cannot disagree about what a body is.
 */
export function sendsBody(method: string, bodyLength: number): boolean {
  return method !== 'GET' && method !== 'HEAD' && bodyLength > 0;
}

/**
 * Copies a header bag into a `Headers`, lower-casing names.
 *
 * ★ NAMES ARE LOWER-CASED HERE, NOT LATER.
 *
 * `Headers` normalises on `set`, so the value would be correct either way — but
 * an adapter that reads the response's headers back out with
 * `Object.fromEntries(response.headers)` and serialises them must
 * produce lower-case names, or the gateway duplicates them (`X-Request-Id`
 * alongside `x-request-id`). Deciding it once, on the way in, means the way out
 * cannot get it wrong.
 *
 * Array values are joined with `, ` — the same choice `server/index.ts:42` makes
 * for repeated headers, and the same thing HTTP means by a repeated header.
 */
export function toHeaders(source: NodeStyleHeaders | undefined): Headers {
  const headers = new Headers();
  if (!source) return headers;

  const entries: Iterable<readonly [string, unknown]> =
    Symbol.iterator in source
      ? (source as Iterable<readonly [string, unknown]>)
      : Object.entries(source);

  for (const [name, value] of entries) {
    if (value === undefined || value === null) continue;

    const text = Array.isArray(value) ? value.join(', ') : String(value);
    // `Headers.set` throws on a malformed name; a stray header from a proxy
    // must not fail the request it arrived with.
    try {
      headers.set(name.toLowerCase(), text);
    } catch {
      // A header name HTTP itself considers invalid is not actionable here.
    }
  }

  return headers;
}

/**
 * Builds an absolute URL from whatever the platform supplied.
 *
 * A bare path (`/api/events`) is resolved against `DEFAULT_ORIGIN`. An adapter
 * that can see the real host (e.g. via `x-forwarded-host`) passes it in.
 */
export function toUrl(url: string | undefined, origin: string = DEFAULT_ORIGIN): URL {
  const raw = url && url.trim() !== '' ? url : '/';
  return new URL(raw, origin);
}

/**
 * Translates a Node-style request into the `Request` `handleRequest` expects.
 *
 * ★ `OPTIONS` AND `HEAD` PASS THROUGH UNCHANGED.
 *
 * `handleRequest` answers `OPTIONS` itself with a 204 and the CORS headers
 * (`server/app.ts:219-221`). An adapter that short-circuited a preflight would
 * drop those headers and break the web build's cross-origin calls, so the
 * method is only ever passed through, never interpreted.
 */
export function toRequest(
  incoming: NodeStyleRequest,
  options: { origin?: string } = {},
): Request {
  const method = (incoming.method ?? 'GET').toUpperCase();
  const url = toUrl(incoming.url, options.origin);
  const headers = toHeaders(incoming.headers);

  const body = incoming.body;
  const bodyBytes: Uint8Array =
    typeof body === 'string' ? new TextEncoder().encode(body) : (body ?? new Uint8Array(0));

  return new Request(url, {
    method,
    headers,
    // `new Uint8Array(bodyBytes)` copies into a plain ArrayBuffer, which is the
    // `BodyInit` the constructor accepts — the same wrapping `server/index.ts:48`
    // does for the same reason.
    body: sendsBody(method, bodyBytes.length) ? new Uint8Array(bodyBytes) : undefined,
  });
}

/**
 * Buffers an `AsyncIterable` of chunks into one `Uint8Array`.
 *
 * Node-signature runtimes hand over a stream the adapter must drain before the
 * handler can run. Mirrors `server/index.ts:23-27`.
 */
export async function readBody(stream: AsyncIterable<Uint8Array | string>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const joined = new Uint8Array(total);

  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }

  return joined;
}
