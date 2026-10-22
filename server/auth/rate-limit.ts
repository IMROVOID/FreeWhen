/**
 * The anonymous sign-in rate limit for the local backend (PRD-08 FR-8.35).
 *
 * ★ THE LIMIT IS 30 REQUESTS PER HOUR PER IP, AND IT IS CONFIGURABLE.
 *
 * FR-8.35 calls the platform default "adjustable", and the reason is
 * practical rather than theoretical: a demo behind one NAT address has
 * every attendee behind the same IP, and 30 requests an hour is not enough
 * for a room of people joining at once. The limit stays a knob rather than
 * being raised to a number that would be unsafe for a public host.
 *
 * ★ THE COUNTER IS SHARED, THE ERROR PATH IS NOT.
 *
 * The counting lives in `server/lib/rate-limit.ts`, which Plan 05 owns and
 * which already carries a sign-in bucket at 30/hour. Reusing it is what
 * keeps the two backends from drifting: the same limit, the same window
 * semantics, one implementation.
 *
 * The ERROR PATH is deliberately separate. Plan 05's invite limiter must
 * answer a rate-limited caller with the SAME generic error it answers a
 * revoked token (FR-1.15) — a distinguishable 429 body would turn the
 * limiter into a token-enumeration oracle. A rate-limited SIGN-IN has no
 * such requirement: the caller learns only that they must wait, and the
 * response says so. Sharing the counter is safe; sharing the response
 * would not be.
 */

import { RateLimiter, limiters } from '../lib/rate-limit';

/** The default limit: 30 requests per hour per IP (FR-8.35). */
export const DEFAULT_SIGN_IN_LIMIT_PER_HOUR = 30;

/** The environment variable that overrides the limit. */
export const LIMIT_ENV_VAR = 'ANON_SIGNIN_LIMIT_PER_HOUR';

/**
 * The window length, in milliseconds. One hour.
 */
export const WINDOW_MS = 60 * 60 * 1000;

/**
 * The bucket key prefix.
 *
 * ★ IT MUST MATCH Plan 05's, so both paths spend the SAME budget.
 *
 * `server/routes/events.ts` and `server/routes/invite.ts` key the shared
 * limiter as `signin:<ip>`. A different prefix here would be a different
 * bucket, and a client could mint 30 identities through the auth service
 * and 30 more through the API — double FR-8.35's budget.
 */
export const SIGN_IN_BUCKET_PREFIX = 'signin:';

/**
 * Reads the limit from the environment.
 *
 * ★ An unparseable value falls back to the default rather than to zero.
 *
 * A limit of zero would refuse every sign-in, and a limit of `Infinity`
 * would remove the protection. Neither is what a typo means.
 */
export function readSignInLimit(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env[LIMIT_ENV_VAR];
  if (!raw) return DEFAULT_SIGN_IN_LIMIT_PER_HOUR;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SIGN_IN_LIMIT_PER_HOUR;

  return parsed;
}

/**
 * The sign-in limiter — Plan 05's shared instance.
 *
 * ★ ONE BUCKET, NOT TWO.
 *
 * The counter lives in `server/lib/rate-limit.ts`, which Plan 05 owns and
 * which already carries a sign-in bucket at 30/hour. Using THAT instance
 * is what keeps the two backends from drifting, and what keeps the auth
 * service and the API from each granting a full budget.
 *
 * The limit is configurable per deployment, so the shared instance is
 * REPLACED at start-up with one built from the environment — rather than
 * Plan 05's module-level constant, which is fixed at 30.
 */
let limiter: RateLimiter | undefined;

/**
 * The limiter in effect.
 *
 * On the first call it REPLACES Plan 05's module-level instance with one
 * built from the environment, so `ANON_SIGNIN_LIMIT_PER_HOUR` applies to
 * both paths.
 */
export function signInLimiter(
  env: Record<string, string | undefined> = process.env,
): RateLimiter {
  if (!limiter) {
    const configured = new RateLimiter(readSignInLimit(env), WINDOW_MS);
    (limiters as { signInByIp: RateLimiter }).signInByIp = configured;
    limiter = configured;
  }
  return limiter;
}

/**
 * The bucket key for an address.
 *
 * ★ The prefix is Plan 05's, so both paths share one budget.
 */
export function signInBucketKey(ip: string): string {
  return `${SIGN_IN_BUCKET_PREFIX}${ip}`;
}

/**
 * Replaces the limiter. Tests call this; a running server never does.
 */
export function resetSignInLimiter(
  env: Record<string, string | undefined> = process.env,
): RateLimiter {
  limiter = new RateLimiter(readSignInLimit(env), WINDOW_MS);
  (limiters as { signInByIp: RateLimiter }).signInByIp = limiter;
  return limiter;
}

/**
 * The `X-RateLimit-*` and `Retry-After` headers for a sign-in response.
 *
 * ★ The headers are what let a client back off correctly.
 *
 * Without them, a client that hits the limit has no way to know when to
 * retry except by guessing, and a guessing client retries into the wall.
 */
export function signInRateLimitHeaders(result: {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Remaining': String(result.remaining),
  };

  if (!result.allowed) {
    headers['Retry-After'] = String(result.retryAfterSeconds);
  }

  return headers;
}
