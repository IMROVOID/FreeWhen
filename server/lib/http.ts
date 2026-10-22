/**
 * The wire contract for the Phase 5 endpoints (PRD-09 §5.2).
 *
 * ★ ERRORS CARRY A CODE AND A CATALOGUE KEY — NEVER PROSE.
 *
 * `src/lib/errors.ts` defines the codes and their HTTP statuses and is reused
 * verbatim here. What is added is `messageKey`: the server names the catalogue
 * entry the client should render, and ships no Persian or English of its own.
 *
 * That is a deliberate difference from `ApiError.message`. A route holding a
 * Persian sentence is a hardcoded user-facing string (the phase's completion
 * checklist forbids it), and it makes the error untranslatable: the same
 * response must read «این لینک معتبر نیست…» in `fa` and "This link is not
 * valid…" in `en` without a server round trip per locale.
 *
 * The codes and statuses are NOT redefined — `HTTP_STATUS_BY_CODE` stays the
 * single source of truth, so the two layers cannot disagree.
 */

import { HTTP_STATUS_BY_CODE, type ApiErrorCode } from '@/src/lib/errors';

/** The response body every failing endpoint returns. */
export interface WireError {
  error: ApiErrorCode;
  messageKey: string;
  /** Field-level keys, for inline rendering. `VALIDATION_FAILED` only. */
  fields?: Record<string, string>;
}

/** The catalogue key per code. Mirrors the `errors` namespace in both locales. */
export const MESSAGE_KEY_BY_CODE: Record<ApiErrorCode, string> = {
  INVITE_INVALID: 'errors.inviteInvalid',
  EVENT_FULL: 'errors.eventFull',
  NOT_PARTICIPANT: 'errors.notParticipant',
  NOT_ORGANIZER: 'errors.notOrganizer',
  VALIDATION_FAILED: 'errors.validationFailed',
  RATE_LIMITED: 'errors.rateLimited',
  PROVIDER_UNAVAILABLE: 'errors.providerUnavailable',
};

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' } as const;

/** A JSON response. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

/** The error envelope, with the status its code implies. */
export function wireError(
  code: ApiErrorCode,
  options: { fields?: Record<string, string>; headers?: Record<string, string> } = {},
): Response {
  const body: WireError = { error: code, messageKey: MESSAGE_KEY_BY_CODE[code] };
  if (options.fields) body.fields = options.fields;

  return json(body, HTTP_STATUS_BY_CODE[code], options.headers);
}

/**
 * A 422 carrying a `fields` map of catalogue keys.
 *
 * Zod issues are `{ path, message }` where the message is already a catalogue
 * key (see `src/types/event.ts`), so this is a flattening, not a translation.
 */
export function validationFailed(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): Response {
  const fields: Record<string, string> = {};

  for (const issue of issues) {
    const field = issue.path.length > 0 ? issue.path.map(String).join('.') : '_';
    // First issue per field wins: a field shows one message, not a list.
    if (!(field in fields)) fields[field] = issue.message;
  }

  return wireError('VALIDATION_FAILED', { fields });
}

/** The parsed JSON body, or `null` when it is absent or not an object. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json();
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * The caller's identity from the `x-user-id` header.
 *
 * The MVP has no session cookie dance: the client mints an anonymous identity
 * once and sends its id, which is the same claim `auth.uid()` reads in the
 * database. It is a header rather than a bearer JWT because the local backend
 * (D22) mints its own tokens in Phase 2B and the routes must not change shape
 * between backends.
 *
 * Returns `null` when the header is absent — an anonymous caller, not an
 * error. Endpoints that write require an identity and answer 403 themselves.
 */
export function callerIdFrom(request: Request): string | null {
  const value = request.headers.get('x-user-id');
  return value && value.trim() !== '' ? value.trim() : null;
}

/** A UUID check, so a malformed id fails before it reaches a query. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** The public origin for invite links. */
export function publicBaseUrl(request: Request): string {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/$/, '');

  return new URL(request.url).origin;
}
