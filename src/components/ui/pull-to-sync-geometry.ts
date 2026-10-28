/**
 * The geometry behind pull-to-sync (Plan 49 T16).
 *
 * ★ PURE, SO THE THRESHOLD CAN BE TESTED WITHOUT A GESTURE.
 *
 * The drag itself is a `PanResponder`, which no Node test can drive. What is worth
 * pinning is the arithmetic: how far the page is displaced for a given drag, when
 * the release refreshes, and where the spinner sits. All of that is here.
 *
 * ★ THE DISPLACEMENT IS DAMPED, NOT LINEAR.
 *
 * A page that follows the finger one-to-one overshoots the content and reveals a
 * blank band above it. Damping makes the page feel attached to something with
 * weight, which is also what tells the reader they are pulling rather than
 * scrolling.
 */

/** How far the reader must pull before a release refreshes. */
export const REFRESH_THRESHOLD = 72;

/** The furthest the page will travel, however hard it is pulled. */
export const MAX_PULL = 200;

/** The band revealed above the page: where the spinner lives. */
export const BAND_HEIGHT = 64;

/** The radius the page's top corners take while displaced. */
export const PULLED_RADIUS = 26;

/**
 * How much of the finger's travel the page takes in the direct phase.
 *
 * ★ THE OLD CURVE WAS TUNED AT THE WRONG POINT.
 *
 * `sqrt(2 * drag)` moves the page `sqrt(144) = 12px` at the 72px trigger — a twelfth
 * of the finger's travel, the same order as the list's own gap, which is why the pull
 * read as "the page barely moves down". The square root is measured against the
 * FINGER, but the number that matters is measured at the THRESHOLD.
 *
 * A page that follows the finger at half speed up to a little past the trigger keeps
 * the gesture unmistakable while staying under the finger, and the taper after it is
 * what stops the page being dragged into the middle of the screen.
 */
const DIRECT_RESPONSE = 0.55;

/** The drag at which the page has taken `REFRESH_THRESHOLD` of travel. */
const TAPER_START = REFRESH_THRESHOLD / DIRECT_RESPONSE;

/**
 * How far the page has moved for a raw drag distance.
 *
 * Two phases, both monotonic and both strictly under the finger:
 *
 *  1. up to `TAPER_START`, the page follows at `DIRECT_RESPONSE` — the pull is
 *     obvious and the threshold is reachable within a comfortable gesture;
 *  2. past it, the remaining travel tapers with a square root, so a hard pull
 *     approaches `MAX_PULL` without ever reaching the middle of the screen.
 *
 * ★ THE CONTINUITY AT THE JOIN IS ARITHMETIC, NOT A SPECIAL CASE.
 *
 * The taper starts from exactly `REFERENCE_AT_TAPER` so the two phases meet with no
 * step, which matters because the corner radius is derived from this value — a step
 * here would be a visible snap in the radius.
 */
const REFERENCE_AT_TAPER = TAPER_START * DIRECT_RESPONSE;

export function displacementFor(dragDistance: number): number {
  if (!Number.isFinite(dragDistance) || dragDistance <= 0) return 0;

  if (dragDistance <= TAPER_START) {
    return dragDistance * DIRECT_RESPONSE;
  }

  // A square root from the join, so the second phase begins exactly where the first
  // ended and rises ever more slowly.
  const over = dragDistance - TAPER_START;
  const tapered = REFERENCE_AT_TAPER + Math.sqrt(over) * 4;

  return Math.min(MAX_PULL, tapered);
}

/** Whether a release at this drag distance should refresh. */
export function shouldRefresh(dragDistance: number): boolean {
  return displacementFor(dragDistance) >= REFRESH_THRESHOLD;
}

/**
 * The page's top corner radius at a given displacement.
 *
 * Rounded only while displaced: at rest the page is square against the header, as
 * it is on every other screen. The radius arrives with the pull, which is what
 * makes the page read as a leaf being lifted away from the band behind it.
 */
export function cornerRadiusFor(displacement: number): number {
  if (!Number.isFinite(displacement) || displacement <= 0) return 0;

  return Math.min(PULLED_RADIUS, (displacement / REFRESH_THRESHOLD) * PULLED_RADIUS);
}

/** How opaque the revealed band is, so it fades in with the pull. */
export function bandOpacityFor(displacement: number): number {
  if (!Number.isFinite(displacement) || displacement <= 0) return 0;

  return Math.min(1, displacement / BAND_HEIGHT);
}

/** How far the spinner has rotated, so it turns as the reader pulls. */
export function spinnerRotationFor(displacement: number): number {
  if (!Number.isFinite(displacement) || displacement <= 0) return 0;

  // ★ ONE TURN AT THE THRESHOLD, THEN STOP.
  //
  // Past the threshold the release WILL refresh, so continuing to spin adds no
  // information — and an unbounded angle would let a hard pull wind the icon
  // several turns, which reads as a broken animation rather than as progress.
  return Math.min(1, displacement / REFRESH_THRESHOLD) * 360;
}
