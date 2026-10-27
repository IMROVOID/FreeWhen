/**
 * How long to wait before the next poll, given how the last one went.
 *
 * ★ A FAILING POLL USED TO RETRY AT FULL SPEED, FOREVER.
 *
 * `createRealtimeEngine` registered `setInterval(safeRefetch, 10_000)` and never
 * looked at the result, and `useDecisionStatus` swallows the error into a banner.
 * So a persistent 500 — which is what a cold Vercel function with no TLS produced
 * — became six requests a minute per screen, each one running ten sequential
 * queries, from every open tab. The load that generated is a plausible
 * contributor to the very failure being retried.
 *
 * ★ BACKOFF IS IN THE SCHEDULE, NOT IN THE TIMER.
 *
 * A `setInterval` cannot express a changing period. This module is a pure
 * function of the attempt count so the policy is testable without mocking a
 * clock, and it is deliberately separate from the engine that uses it.
 *
 * ★ SUCCESS RESETS TO THE FLOOR, NOT TO ZERO.
 *
 * The floor is the healthy cadence (PRD-02 E9: fast enough that another device's
 * vote appears while the user is looking). Returning to it immediately after a
 * success is correct; backing off from a success would make the product feel
 * slow for no reason.
 */

/** The healthy cadence, matching `POLL_INTERVAL_MS` in `realtime-engine.ts`. */
export const POLL_FLOOR_MS = 10_000;

/**
 * The longest the client will wait between polls.
 *
 * A minute is short enough to recover on its own and long enough that a broken
 * deployment stops being hammered by every idle tab.
 */
export const POLL_CEILING_MS = 60_000;

/**
 * The delay before the next poll.
 *
 * `consecutiveFailures` is the number of failures since the last success, so `0`
 * means the last poll succeeded. The curve is `floor * 2^(n-1)`, clamped to the
 * ceiling — the first failure waits one floor, the second two, and so on. The
 * cheapest policy that converges quickly and never stops trying.
 *
 * The last value is repeated rather than growing without bound, so a tab left
 * open overnight still polls once a minute instead of once a day.
 */
export function nextPollDelay(consecutiveFailures: number, floorMs: number = POLL_FLOOR_MS): number {
  const floor = Number.isFinite(floorMs) && floorMs > 0 ? floorMs : POLL_FLOOR_MS;

  if (!Number.isFinite(consecutiveFailures) || consecutiveFailures <= 0) {
    return floor;
  }

  // ★ THE CEILING IS A MULTIPLE OF THE FLOOR, NOT A FIXED MILLISECOND COUNT.
  //
  // A caller may pass a shorter floor (the tests do, and so would a screen that
  // genuinely wants a faster cadence). Capping at an absolute sixty seconds would
  // then make the backoff jump straight to the ceiling on the first failure,
  // which is worse than not backing off at all. Six floors is >= the documented
  // one-minute ceiling for the real floor and scales with it.
  const ceiling = Math.max(floor, Math.min(POLL_CEILING_MS, floor * 6));

  // `2 ** n` overflows to Infinity for a large count, which `Math.min` clamps.
  const scaled = floor * 2 ** (Math.floor(consecutiveFailures) - 1);

  return Math.min(ceiling, scaled);
}
