/**
 * `Response` → serialised result (Plan 40 T3).
 *
 * ★ THE OTHER HALF OF THE SEAM.
 *
 * `handleRequest` returns a `Response`. Every runtime that accepts a web-standard
 * `Response` hands it straight back and needs nothing from this module. Runtimes
 * that take a *serialised* result cannot: they want a status code, a header map
 * and a body string, and most of them additionally want to be told whether that
 * body is binary.
 *
 * Two serialised shapes are in common use, and they differ only in the field
 * names:
 *
 * | Shape | Status field | Used by |
 * |---|---|---|
 * | `EventResult` | `statusCode` + `isBase64Encoded` | event-object runtimes |
 * | `DescriptorResult` | `status`, body as bytes | context/handler runtimes |
 *
 * Getting either translation wrong is invisible until it is not, so each decision
 * below is made once and tested.
 *
 * ★ THE `no-store` RULE.
 *
 * `/health` reports whether the database is reachable. A cached 200 outliving a
 * database outage is the one health answer worse than no answer, so any response
 * this module converts that does not already say otherwise is marked
 * `cache-control: no-store`. A caller that genuinely wants caching sets the header
 * itself and it is preserved.
 */

import type { ServerResponse } from 'node:http';

/**
 * The serialised shape an event-object runtime accepts.
 *
 * Declared locally rather than importing a platform type package — the repo's
 * rule is no dependency without need, and this is four fields.
 */
export interface EventResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded: boolean;
}

/** The serialised shape a context/handler runtime accepts. */
export interface DescriptorResult {
  status: number;
  headers: Record<string, string>;
  body: string | Uint8Array;
}

/** The header this module adds when a response does not speak for itself. */
export const CACHE_HEADER = 'cache-control';
export const NO_STORE = 'no-store';

/** Statuses that carry no body by definition. */
const BODYLESS = new Set([204, 205, 304]);

/**
 * Whether a content type needs base64 on the wire.
 *
 * ★ THIS IS EXPLICIT, NOT OMITTED.
 *
 * Event-object runtimes treat the returned body as UTF-8 unless the flag says
 * otherwise. The API is JSON-only today, so every real call returns `false` and
 * omitting the flag would work — until the day a PDF, an image or a protobuf is
 * served, at which point the body is silently corrupted on the wire and the tests
 * that covered the JSON paths keep passing.
 *
 * So the flag is always present and this function always decides it.
 *
 * JSON, text and form types are UTF-8-safe. Everything else — an image, a PDF, an
 * octet-stream, an unknown type — is treated as binary, because guessing "text"
 * for an unknown type is the corrupting direction.
 */
export function isBinary(contentType: string | null | undefined): boolean {
  if (!contentType) return false;

  const normalised = contentType.toLowerCase();

  return !(
    normalised.startsWith('text/') ||
    normalised.includes('json') ||
    normalised.includes('xml') ||
    normalised.includes('javascript') ||
    normalised.includes('x-www-form-urlencoded')
  );
}

/** The headers of a `Response`, lower-cased, with the cache rule applied. */
export function resultHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const [name, value] of response.headers.entries()) {
    headers[name.toLowerCase()] = value;
  }

  if (!(CACHE_HEADER in headers)) headers[CACHE_HEADER] = NO_STORE;

  return headers;
}

/** The body bytes, empty for a status that carries none. */
async function bodyBytes(response: Response): Promise<Uint8Array> {
  if (BODYLESS.has(response.status)) return new Uint8Array(0);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Converts a `Response` into the event-object result shape.
 *
 * ★ A BODYLESS STATUS PRODUCES AN EMPTY STRING, NOT `"null"`.
 *
 * A 204, 205 or 304 has no body by definition. `response.text()` on a null-body
 * response returns `''`, but a naive `String(await response.json())` or a
 * `JSON.stringify(null)` produces the four-character string `"null"`, which a
 * client parses as a JSON document and an HTTP intermediary treats as a protocol
 * violation on a 204.
 */
export async function toEventResult(response: Response): Promise<EventResult> {
  const bytes = await bodyBytes(response);
  const binary = isBinary(response.headers.get('content-type'));

  return {
    statusCode: response.status,
    headers: resultHeaders(response),
    // A bodyless response is never base64 — an empty base64 string and an empty
    // plain string are the same bytes, and `false` keeps the result readable.
    body: binary ? binaryToBase64(bytes) : new TextDecoder().decode(bytes),
    isBase64Encoded: binary,
  };
}

/** Converts a `Response` into the context/handler result shape. */
export async function toDescriptorResult(response: Response): Promise<DescriptorResult> {
  return {
    status: response.status,
    headers: resultHeaders(response),
    body: await bodyBytes(response),
  };
}

/**
 * Writes a `Response` onto a Node `ServerResponse`.
 *
 * ★ `writeHead` WITH THE STATUS THE HANDLER CHOSE.
 *
 * `OPTIONS` returns 204 with the CORS headers (`server/app.ts:219-221`). An
 * adapter that forced 200 for a null body would turn every preflight into a
 * response the browser ignores, so the status is copied verbatim.
 */
export async function toNodeWritable(response: Response, res: ServerResponse): Promise<void> {
  const payload = await bodyBytes(response);

  res.writeHead(response.status, resultHeaders(response));
  res.end(payload);
}

/**
 * Base64 without `Buffer`.
 *
 * `Buffer` is not available on every runtime this module is bundled for, and the
 * `btoa`/`String.fromCharCode` pair is available everywhere that has a `Request`.
 */
function binaryToBase64(bytes: Uint8Array): string {
  let binary = '';
  // Chunked so a large body does not blow the argument limit of `apply`.
  const CHUNK = 0x8000;

  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }

  return btoa(binary);
}
