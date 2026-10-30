/**
 * Rate limiting for the unauthenticated and mutating surfaces (PRD-08 FR-8.26–FR-8.34).
 *
 * ★ A LIMITER IS AN ORACLE IF IT ANNOUNCES ITSELF.
 *
 * The invite path answers a rate-limited caller with the SAME generic error it
 * answers a revoked token (FR-1.15). A distinguishable 429 body would let an
 * attacker probe token validity at a lower rate for free — the limiter would
 * become the enumeration channel it exists to prevent. `server/routes/invite.ts`
 * is where that rule is applied; this module only counts.
 *
 * ★ The IP key comes from the forwarded-for header, not the socket.
 *
 * Behind Caddy the socket address is the proxy's, so keying on it would put
 * every user in Iran into one bucket and rate-limit the whole product after ten
 * redemptions.
 *
 * A sliding window is used rather than a fixed one: a fixed window admits twice
 * the limit across a boundary (ten at 10:59:59, ten more at 11:00:00), which for
 * a security limiter is a ten-fold error at the moment it matters.
 */

/** The window all limits are expressed in. */
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/** BR-8.34 — 10 redemptions per hour from one address. */
export const REDEEM_PER_IP = 10;

/** BR-8.34 — 30 redemptions per hour against one link. */
export const REDEEM_PER_TOKEN = 30;

/** Mutating endpoints, per participant and per event. */
export const MUTATION_PER_PARTICIPANT = 120;
export const MUTATION_PER_EVENT = 600;

/** Anonymous sign-in follows the same per-address budget as redemption. */
export const SIGNIN_PER_IP = 30;

/**
 * Place search per address (Plan 06 Task 8).
 *
 * Every search spends a metered Neshan quota on behalf of an unauthenticated
 * caller, so it is budgeted even though it reads nothing. A typist searching
 * for one café will not exceed this; a script draining the quota will.
 */
export const SEARCH_PER_IP = 60;

/**
 * Route geometry per address.
 *
 * Higher than search because one event page draws one line per proposed venue,
 * so a single legitimate view can spend several calls. Still bounded: the
 * alternative is an unmetered egress path into a MapBox account.
 */
export const GEOMETRY_PER_IP = 240;

/**
 * The ceiling on tracked keys.
 *
 * An unbounded map keyed by attacker-chosen strings is a memory exhaustion
 * primitive. At the cap the oldest bucket is evicted; eviction weakens the
 * limit for one key rather than taking the process down.
 */
const MAX_TRACKED_KEYS = 5000;

export interface RateLimitResult {
  allowed: boolean;
  /** What is left in the window after this hit. */
  remaining: number;
  /** Seconds until the oldest hit leaves the window — the honest `Retry-After`. */
  retryAfterSeconds: number;
}

/** A clock, injectable so the tests do not sleep. */
export type Clock = () => number;

/**
 * A sliding-window counter over a `Map` of hit timestamps.
 *
 * One instance per limit — the bucket key is the caller's identity for THAT
 * limit (an IP, a token hash, a participant id), never a composite, so a
 * limit cannot accidentally share another's budget.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = RATE_LIMIT_WINDOW_MS,
    private readonly clock: Clock = Date.now,
  ) {}

  /**
   * Records a hit and reports whether it is within the limit.
   *
   * A rejected hit is NOT recorded. Recording it would extend the penalty on
   * every retry, so a caller that keeps trying would never be let back in —
   * a permanent ban produced by a transient burst.
   */
  check(key: string): RateLimitResult {
    const now = this.clock();
    const windowStart = now - this.windowMs;

    const existing = this.hits.get(key) ?? [];
    const live = existing.filter((at) => at > windowStart);

    if (live.length >= this.limit) {
      // Keep the pruned list: it is what makes the next call cheap.
      this.hits.set(key, live);
      const oldest = live[0] ?? now;
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)),
      };
    }

    live.push(now);
    this.hits.set(key, live);
    this.evictIfNeeded();

    return {
      allowed: true,
      remaining: this.limit - live.length,
      retryAfterSeconds: 0,
    };
  }

  /** Clears a single bucket — used when a limit is reset by a privileged action. */
  forget(key: string): void {
    this.hits.delete(key);
  }

  /** Drops every bucket. Tests call this; production never does. */
  reset(): void {
    this.hits.clear();
  }

  /** The number of live buckets — asserted by the eviction test. */
  size(): number {
    return this.hits.size;
  }

  private evictIfNeeded(): void {
    if (this.hits.size <= MAX_TRACKED_KEYS) return;

    // `Map` preserves insertion order, so the first key is the oldest bucket.
    const oldestKey = this.hits.keys().next().value;
    if (oldestKey !== undefined) this.hits.delete(oldestKey);
  }
}

/**
 * The forwarded client address.
 *
 * `x-forwarded-for` is a comma-separated chain; the left-most entry is the
 * original client. Anything past it was appended by a proxy and cannot be
 * trusted for identity. `x-real-ip` is the single-value fallback.
 *
 * ★ A missing header yields `unknown`, and every such caller shares one bucket.
 *
 * That is deliberate: falling back to the socket address would key on Caddy and
 * collapse everyone into one real bucket anyway, while silently pretending to be
 * per-client. A shared `unknown` bucket fails closed and is visible in the
 * limiter's own metrics.
 */
export function clientIp(headers: Headers | Record<string, string | undefined>): string {
  const read = (name: string): string | undefined =>
    headers instanceof Headers
      ? (headers.get(name) ?? undefined)
      : Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];

  const forwarded = read('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }

  return read('x-real-ip')?.trim() || 'unknown';
}

/** The six buckets the app uses. Module-level, so they survive a request. */
export const limiters = {
  redeemByIp: new RateLimiter(REDEEM_PER_IP),
  redeemByToken: new RateLimiter(REDEEM_PER_TOKEN),
  mutationByParticipant: new RateLimiter(MUTATION_PER_PARTICIPANT),
  mutationByEvent: new RateLimiter(MUTATION_PER_EVENT),
  signInByIp: new RateLimiter(SIGNIN_PER_IP),
  searchByIp: new RateLimiter(SEARCH_PER_IP),
  geometryByIp: new RateLimiter(GEOMETRY_PER_IP),
} as const;

/** Clears every limiter. Tests only — a running server never calls this. */
export function resetRateLimits(): void {
  for (const limiter of Object.values(limiters)) limiter.reset();
}
