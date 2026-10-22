/**
 * The per-provider backoff.
 *
 * ★ THIS FILE EXISTS BECAUSE TWO LIMITERS MUST NOT SHARE AN ERROR PATH.
 *
 * Plan 05 owns `server/lib/rate-limit.ts` for the invite limiter, and that
 * limiter is normative in a way this one is not: FR-1.15 requires a
 * **byte-identical** response for a rate-limited invite, so the invite
 * limiter must never return a distinguishable body. If the provider backoff
 * lived in the same file, a rate-limited provider call and a rate-limited
 * invite would share a code path — and the first change that made the
 * provider response readable would leak that difference into the invite
 * response. Splitting the files makes the separation structural.
 *
 * This file holds the PROVIDER backoff only. It never touches the invite
 * path.
 *
 * ★ WHAT THE BACKOFF ACTUALLY DOES.
 *
 * It records, per provider, when that provider last refused us, and it
 * refuses to CALL a provider that is inside its backoff window. That is the
 * whole mechanism — and it matters most for the two statuses that must
 * never be retried:
 *
 * - **481 `LimitExceeded`** — the quota is spent. Calling again does not
 *   buy quota back; it only delays the fallback that would have worked.
 * - **482 `RateExceeded`** — the per-minute cap. Waiting is the correct
 *   response, and the wait is bounded so the ranking still arrives.
 */

import { logSafe } from '@/src/lib/redact';
import type { ProviderService } from '@/src/routing/provider';

/** How long a provider is benched after each kind of refusal, in ms. */
export const BACKOFF_MS: Record<ProviderService, number> = {
  // ★ A QUOTA FAULT LASTS UNTIL THE QUOTA IS REFILLED, WHICH IS HOURS OR
  // DAYS — NOT MINUTES. A 30-minute bench would have the ladder asking
  // again within the same demo, and each ask is a guaranteed 481.
  //
  // The bench is deliberately long: the cost of being wrong is one wasted
  // call, and the cost of being right is not asking a provider that has
  // told us it has nothing left.
  neshan_matrix: 6 * 60 * 60 * 1000,
  neshan_direction: 6 * 60 * 60 * 1000,
  // ORS's window is 24 hours from the FIRST request of the window, not from
  // midnight, so the bench is a day rather than "until tomorrow".
  ors: 24 * 60 * 60 * 1000,
};

/** The backoff window for the 482 per-minute cap, in ms. */
export const RATE_BACKOFF_MS = 60 * 1000;

/** The state of one provider's backoff. */
interface BackoffState {
  /** When the provider may be called again. */
  until: number;
  /** Why it was benched. */
  reason: 'quota' | 'rate' | 'config' | 'transient';
}

/** The backoff state, per provider. */
const state = new Map<ProviderService, BackoffState>();

/**
 * Whether a provider is currently benched.
 *
 * The ladder consults this before calling, so a benched provider is skipped
 * without a network round trip — which is the point: the request would fail
 * anyway, and failing fast is what keeps the ranking fast.
 */
export function isBackedOff(service: ProviderService, now: number = Date.now()): boolean {
  const entry = state.get(service);
  if (!entry) return false;

  if (now >= entry.until) {
    // The window has passed. The state is cleared so the next refusal
    // starts a fresh window rather than extending a stale one.
    state.delete(service);
    return false;
  }

  return true;
}

/**
 * Records a refusal and benches the provider.
 *
 * `reason` decides the window: a quota fault outlasts a rate cap, and a
 * config fault outlasts both, because a config fault does not fix itself
 * without a deploy.
 */
export function recordRefusal(
  service: ProviderService,
  reason: BackoffState['reason'],
  now: number = Date.now(),
): void {
  const window = reason === 'rate' ? RATE_BACKOFF_MS : BACKOFF_MS[service];
  state.set(service, { until: now + window, reason });

  // The reason is logged; the key is not, and neither is any coordinate.
  logSafe('provider_backoff', { service, reason, retry_after_ms: window });
}

/**
 * Clears a provider's backoff.
 *
 * Called when a provider answers successfully — a refusal followed by a
 * success means the window was wrong, and continuing to bench it would
 * degrade the ranking unnecessarily.
 */
export function clearBackoff(service: ProviderService): void {
  state.delete(service);
}

/**
 * The remaining bench for a provider, in ms. Zero when it is not benched.
 */
export function remainingBackoffMs(
  service: ProviderService,
  now: number = Date.now(),
): number {
  const entry = state.get(service);
  if (!entry) return 0;
  return Math.max(0, entry.until - now);
}

/** Clears every provider's backoff. Tests call this. */
export function resetBackoff(): void {
  state.clear();
}
