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
export const MAX_PULL = 128;

/** The band revealed above the page: where the spinner lives. */
export const BAND_HEIGHT = 64;

/** The radius the page's top corners take while displaced. */
export const PULLED_RADIUS = 26;

/**
 * How far the page has moved for a raw drag distance.
 *
 * Only downward drags displace anything, and the result is damped by a square root
 * so the first pixels move freely and the rest taper off. The ceiling keeps the
 * page from being dragged into the middle of the screen.
 */
export function displacementFor(dragDistance: number): number {
  if (!Number.isFinite(dragDistance) || dragDistance <= 0) return 0;

  // ★ `sqrt(2 * drag)` IS ALWAYS BELOW `drag` FOR A POSITIVE DRAG, WHICH IS THE
  // DEFINITION OF DAMPING.
  //
  // A linear `sqrt(drag) * k` is only damped once `drag > k²`; below that it
  // AMPLIFIES the drag, so the first few pixels move the page further than the
  // finger travelled. This form is monotonic, starts at zero, and stays strictly
  // under the finger for every positive input.
  const damped = Math.sqrt(dragDistance * 2);

  return Math.min(MAX_PULL, damped);
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
