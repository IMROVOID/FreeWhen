/**
 * The time wheel's row arithmetic.
 *
 * ★ PURE, SO A DRAG CAN BE PINNED WITHOUT A DOM.
 *
 * The wheel's defects were both about what a pointer gesture means: a drag that
 * turned into a text selection instead of a scroll, and a release that left the
 * drum between two numbers. Neither needs a renderer to reason about — an offset
 * and an item height decide everything.
 */

/** Holds an index inside a list, treating a non-finite value as the first item. */
export function clampIndex(index: number, count: number): number {
  if (!Number.isFinite(index) || count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.trunc(index)));
}

/**
 * The item nearest a scroll offset.
 *
 * Rounding — not flooring — is what makes the wheel settle on the number the
 * reader was looking at rather than the one above it.
 */
export function indexForScroll(offset: number, count: number, itemHeight: number): number {
  if (!Number.isFinite(offset) || !Number.isFinite(itemHeight) || itemHeight <= 0) return 0;
  return clampIndex(Math.round(offset / itemHeight), count);
}

/** The scroll offset that puts an item in the drum's window. */
export function scrollForIndex(index: number, itemHeight: number): number {
  return clampIndex(index, Number.MAX_SAFE_INTEGER) * itemHeight;
}

/**
 * The offset to settle at after a drag.
 *
 * A release snaps: an offset between two items is only ever a transient state, and
 * leaving it there would put half of two numbers in the window — which the reader
 * cannot act on and the control cannot report.
 */
export function snapOffsetFor(offset: number, count: number, itemHeight: number): number {
  return scrollForIndex(indexForScroll(offset, count, itemHeight), itemHeight);
}
