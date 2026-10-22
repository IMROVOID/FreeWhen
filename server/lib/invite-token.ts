/**
 * Invite token generation, hashing and comparison (PRD-01 §13.1, FR-1.5–FR-1.15).
 *
 * ★ THE TOKEN IS A CREDENTIAL. Three properties follow, and none is optional:
 *
 *  1. **Unpredictable** — ≥128 bits of CSPRNG entropy. Never `Math.random()`,
 *     never a timestamp, never derived from the event id. A guessable token is
 *     a public event with everyone's approximate location on it.
 *  2. **Irrecoverable** — only the sha256 hash is stored. The plaintext exists
 *     in the URL handed to the organizer and nowhere else. A lost link is
 *     rotated, never retrieved.
 *  3. **Compared in constant time** — `===` on a hash leaks length and prefix
 *     timing. `timingSafeEqual` does not.
 *
 * The token never reaches a log: `src/lib/redact.ts` lists `token`,
 * `inviteToken` and `inviteTokenHash` in its forbidden set, and `gate:logs`
 * fails the build on a sensitive key handed to a logger.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 16 bytes = 128 bits. base64url encodes it in 22 characters. */
const TOKEN_BYTES = 16;

/** The length a base64url encoding of `TOKEN_BYTES` always produces. */
export const INVITE_TOKEN_LENGTH = 22;

/** sha256 renders as 64 lowercase hex characters. */
export const INVITE_TOKEN_HASH_LENGTH = 64;

/** The default lifetime when the event ends later than a week away (OQ-1.3). */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** How long a link survives past the event's end (OQ-1.3). */
export const INVITE_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * A fresh token. `randomBytes` is the platform CSPRNG, which is the whole
 * point — the encoding is unimportant, the entropy source is not.
 */
export function generateInviteToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * The stored form. Deterministic, so the lookup is an indexed equality on the
 * hash rather than a scan comparing plaintexts.
 *
 * A salt is deliberately absent: the token already carries 128 bits of
 * entropy, so a rainbow table cannot help, and the hash must stay stable for
 * the unique index to work.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Constant-time comparison of a candidate token against a stored hash.
 *
 * Both sides are hashed before comparison, so the lengths always match and
 * `timingSafeEqual` cannot throw on a length mismatch — which would itself be
 * a timing signal.
 */
export function tokensMatch(candidate: string, storedHash: string): boolean {
  const candidateHash = Buffer.from(hashToken(candidate), 'hex');
  const stored = Buffer.from(storedHash, 'hex');

  if (candidateHash.length !== stored.length) return false;

  return timingSafeEqual(candidateHash, stored);
}

/** Whether a string is shaped like a token, before it costs a database round trip. */
export function isTokenShaped(token: string): boolean {
  return token.length === INVITE_TOKEN_LENGTH && /^[A-Za-z0-9_-]+$/.test(token);
}

/**
 * The invite's expiry: the earlier of the event's end plus a day, or a week
 * from issue (OQ-1.3).
 *
 * A link must not outlive the evening it exists to plan — but an event that is
 * a month away still needs a week's worth of link.
 */
export function inviteExpiresAt(windowEnd: Date, issuedAt: Date = new Date()): Date {
  const eventBased = new Date(windowEnd.getTime() + INVITE_GRACE_MS);
  const issueBased = new Date(issuedAt.getTime() + INVITE_TTL_MS);

  return eventBased < issueBased ? eventBased : issueBased;
}

/** What the organizer sees. The path is the route the client serves at `/e/[token]`. */
export function inviteUrl(token: string, baseUrl: string): string {
  const trimmed = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${trimmed}/e/${token}`;
}
