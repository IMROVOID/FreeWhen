/**
 * The sheet's drag and expand arithmetic, kept pure.
 *
 * ★ PURE SO THE TWO GESTURE RULES CAN BE PINNED WITHOUT A BROWSER.
 *
 * Two behaviours on the sheet are pure decisions: "did this drag mean close?" and
 * "should the panel be full height right now?". Both have a wrong answer that
 * only shows up in the hand — a drag that closes on a one-pixel wobble, or a
 * panel that flaps between two heights while a finger jitters at the boundary —
 * so both live here and both are asserted in `tests/ui/sheet-drag.test.ts`.
 */

/** How far the panel must travel, as a fraction of its own height, to close. */
export const CLOSE_DISTANCE_RATIO = 0.25;

/** A flick faster than this (px/ms) closes regardless of distance. */
export const CLOSE_VELOCITY = 0.5;

/**
 * The distance to fall back to when a fling is what closed it.
 *
 * A fast short flick moves the panel almost nowhere, and an exit animation from
 * there is a pop rather than a slide. The panel is sent the rest of the way so
 * the close still reads as leaving the screen.
 */
export const FLING_FALLBACK_TRAVEL = 120;

/** Whether a completed drag should close the sheet. */
export function shouldCloseOnDrag(dy: number, vy: number, panelHeight: number): boolean {
  if (!Number.isFinite(dy)) return false;

  // A drag upward never closes: it is the opposite of the pull-down gesture.
  if (dy <= 0) return false;

  if (Number.isFinite(vy) && vy > CLOSE_VELOCITY) return true;

  const height = Number.isFinite(panelHeight) && panelHeight > 0 ? panelHeight : 0;
  return dy >= height * CLOSE_DISTANCE_RATIO;
}

/**
 * How far the panel should settle after a release.
 *
 * `0` means it snapped back; anything larger is the travel the exit runs from.
 */
export function releaseTravelFor(dy: number, vy: number, panelHeight: number): number {
  if (!shouldCloseOnDrag(dy, vy, panelHeight)) return 0;

  const height = Number.isFinite(panelHeight) && panelHeight > 0 ? panelHeight : 0;
  return Math.max(dy, Math.min(height, FLING_FALLBACK_TRAVEL));
}

/** How far into the panel's scroll the reader is before the sheet takes the room. */
export const EXPAND_THRESHOLD = 24;

export interface ExpandInput {
  /** The inner scroll view's vertical offset. */
  offsetY: number;
  /** Whether the panel is currently full height. */
  expanded: boolean;
}

/**
 * Whether the panel should be full height.
 *
 * ★ THERE IS HYSTERESIS, AND IT IS NOT A DETAIL.
 *
 * Expanding at `offsetY > 24` and collapsing at `offsetY < 24` would flap: a
 * finger sitting exactly at the boundary, or a momentum scroll that overshoots
 * and settles back, would cross the threshold twice a frame and the panel would
 * pulse. Collapsing only at the very top means the panel can only shrink when
 * there is nothing left to read above the fold — which is also the only moment
 * shrinking is what the reader wants.
 */
export function expandedFor({ offsetY, expanded }: ExpandInput): boolean {
  if (!Number.isFinite(offsetY)) return expanded;

  if (expanded) return offsetY > 0;
  return offsetY > EXPAND_THRESHOLD;
}

/** A percentage of the viewport, as the ceiling a panel starts from. */
export function ceilingPercentOf(snapPoints: string[] | undefined): number {
  const first = snapPoints?.[0];
  if (!first) return 100;

  const percent = /^(\d+(?:\.\d+)?)%$/.exec(first);
  return percent ? Number(percent[1]) : 100;
}
