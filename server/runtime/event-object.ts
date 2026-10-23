/**
 * The event/object invocation entry (Plan 40 T4).
 *
 * ★ THE CONVENTION, NOT THE HOST.
 *
 * This adapter serves any runtime that invokes a function with a single
 * serialised *event object* and expects a serialised *result object* back:
 *
 * ```ts
 * handler(event, context) => { statusCode, headers, body, isBase64Encoded }
 * ```
 *
 * That shape is shared by several platforms — gateway-fronted, function-URL and
 * queue-style invocations all speak it — because it is the portable form of
 * "a request arrived, describe it as data". Nothing here is specific to one
 * vendor: the fields read below are the ones any event-object runtime supplies.
 *
 * ★ WHY THE EVENT SHAPES ARE HANDLED TOGETHER.
 *
 * Event-object runtimes differ in exactly one place — where the method and path
 * live — and share everything else: a header map, a body string, and a flag
 * saying whether that body is base64. Splitting them per flavour would duplicate
 * the body decoding, which is the only part with a way to be wrong. Branching in
 * one well-commented function is honest.
 *
 * ### Fields read, in preferred order
 *
 * | Concept | First | Fallback |
 * |---|---|---|
 * | Path | `rawPath` | `requestContext.http.path`, then `path`, then `/` |
 * | Method | `requestContext.http.method` | `httpMethod`, then `GET` |
 * | Query | `rawQueryString` (verbatim) | rebuilt from `queryStringParameters` |
 * | Headers | `headers` | `multiValueHeaders` flattened underneath |
 * | Body | `body` + `isBase64Encoded` | absent |
 *
 * ★ THE CREDENTIAL COMES FROM THE ENVIRONMENT.
 *
 * Event-object runtimes have no binding object. `DATABASE_URL` is an ordinary
 * environment variable, already in `process.env`, so `bindEnvironment` is only
 * needed for the optional provider keys an operator may set alongside it.
 *
 * ★ NO PLATFORM TYPE PACKAGE.
 *
 * The repo's rule is no dependency without need. The event is four fields from a
 * surface that changes at the vendor's pace; declaring the minimal structural
 * interface locally means an SDK upgrade cannot break this file.
 */

import {
  bindEnvironment,
  defaultClientFactory,
  runWithClient,
  type ClientFactory,
} from './driver';
import { toRequest } from './http-normalise';
import { toEventResult, type EventResult } from './response';

/** The subset of an event object this adapter reads. */
export interface EventRequest {
  rawPath?: string;
  /** Older/other shapes put the path here. */
  path?: string;
  /** Older/other shapes put the method here. */
  httpMethod?: string;
  headers?: Record<string, string | undefined>;
  /** Repeated headers, when the runtime splits them out. */
  multiValueHeaders?: Record<string, string[] | undefined>;
  /** The query string, already encoded and unmodified. */
  rawQueryString?: string;
  /** The query string, delivered pre-decoded. */
  queryStringParameters?: Record<string, string | undefined> | null;
  body?: string | null;
  isBase64Encoded?: boolean;
  requestContext?: {
    http?: { method?: string; path?: string };
  };
}

/** The invocation context. Unused today; kept so the signature is honest. */
export interface EventContext {
  requestId?: string;
}

/**
 * The method, from whichever place this event flavour put it.
 *
 * Defaulting to `GET` is right for an event that genuinely carries no method,
 * which is what a stripped health check looks like.
 */
function methodOf(event: EventRequest): string {
  return (event.requestContext?.http?.method ?? event.httpMethod ?? 'GET').toUpperCase();
}

/** The path, before any query string, from whichever field this flavour uses. */
function pathOf(event: EventRequest): string {
  return event.rawPath ?? event.requestContext?.http?.path ?? event.path ?? '/';
}

/**
 * The query string, preserved verbatim.
 *
 * ★ NOT REBUILT FROM THE DECODED PARAMETERS WHEN AN ENCODED FORM IS AVAILABLE.
 *
 * The decoded parameters have been through one decode already, so rebuilding a
 * URL from them would double-encode any value containing `%` or `+`. The
 * encoded form is the original bytes. The fallback re-encodes through
 * `URLSearchParams`, which is correct for values that arrived already decoded.
 */
function queryOf(event: EventRequest): string {
  if (event.rawQueryString) return event.rawQueryString;

  const params = event.queryStringParameters;
  if (!params) return '';

  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) search.set(name, value);
  }

  const encoded = search.toString();
  return encoded === '' ? '' : `?${encoded}`;
}

/** The header bag, flattening repeated-header maps into the single map. */
function headersOf(event: EventRequest): Record<string, string | string[] | undefined> {
  const headers: Record<string, string | string[] | undefined> = {};

  for (const [name, values] of Object.entries(event.multiValueHeaders ?? {})) {
    if (values) headers[name] = values;
  }
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) headers[name] = value;
  }

  return headers;
}

/**
 * The body, decoded out of base64 when the runtime encoded it.
 *
 * ★ DECODED BEFORE THE `Request` IS BUILT.
 *
 * Handing the base64 string to `toRequest` un-decoded would send the base64 text
 * as the request body — a valid request that parses as garbage JSON. A `GET`
 * with a body is dropped by `sendsBody`, and the decode has to happen here rather
 * than being deferred, because that guard needs the real byte length.
 */
function bodyOf(event: EventRequest): Uint8Array | undefined {
  if (event.body === null || event.body === undefined || event.body === '') return undefined;
  if (!event.isBase64Encoded) return new TextEncoder().encode(event.body);

  return new Uint8Array(Buffer.from(event.body, 'base64'));
}

/**
 * The handler, with the client factory lifted out.
 *
 * `handler` is what a deployment points at; `createEventHandler({
 * createClient })` is what the tests drive.
 */
export function createEventHandler(options: { createClient?: ClientFactory } = {}) {
  const createClient = options.createClient ?? defaultClientFactory;

  return async function handler(
    event: EventRequest,
    _context?: EventContext,
  ): Promise<EventResult> {
    bindEnvironment(process.env);

    const connectionString = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
    if (!connectionString) {
      // A missing configuration value is a deployment error, not a request
      // error. Same shape across every entry so an operator sees one message.
      return toEventResult(
        Response.json(
          { error: 'misconfigured', detail: 'DATABASE_URL is not set' },
          { status: 500 },
        ),
      );
    }

    const request = toRequest({
      method: methodOf(event),
      url: `${pathOf(event)}${queryOf(event)}`,
      headers: headersOf(event),
      body: bodyOf(event),
    });

    const response = await runWithClient(connectionString, createClient, request);
    return toEventResult(response);
  };
}
