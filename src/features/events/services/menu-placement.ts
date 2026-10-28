/**
 * Where the long-press menu opens, from the pressed row's own position.
 *
 * ★ "UNDER OR ABOVE" IS THE WHOLE POINT OF THIS MODULE.
 *
 * A context menu anchored under an event row is right until the row is near the foot
 * of the screen — then the menu is clipped or pushed off-viewport, and the last event
 * in a long list becomes the one you cannot act on. The requirement is explicit:
 * open under the row, but above it when there is not enough space under.
 *
 * ★ EVERY CHOICE HERE IS CLAMPED, NOT HOPED FOR.
 *
 * A row can be wider than the menu, at the very top, or at the very bottom. Each of
 * those is a branch, and each branch has an assertion in
 * `tests/ui/event-context-menu.test.ts`, because the failure mode is a menu rendered
 * half off-screen with no way to reach the item the user held the row for.
 */

/** The safe distance a menu keeps from the viewport edge. */
export const MENU_EDGE_MARGIN = 12;

/** The gap between the pressed row and the menu. */
export const MENU_ANCHOR_GAP = 8;

export interface MenuAnchor {
  /** The row's top edge, in window coordinates. */
  y: number;
  /** The row's height. */
  height: number;
  /** The row's leading edge. */
  x: number;
  /** The row's width. */
  width: number;
}

export interface MenuPlacementInput {
  anchor: MenuAnchor;
  /** The viewport's height, excluding system chrome where possible. */
  windowHeight: number;
  /** The viewport's width. */
  windowWidth: number;
  /** The menu's measured height. */
  menuHeight: number;
  /** The menu's measured width. */
  menuWidth: number;
}

export interface MenuPlacement {
  /** The menu's top edge, in window coordinates. */
  top: number;
  /** The menu's leading edge, in window coordinates. */
  left: number;
  /** Whether it had to open above the row. */
  above: boolean;
}

/**
 * Places the menu, preferring below and falling back to above.
 *
 * The fallback is not "whichever has more room" — it is "below unless below does not
 * fit", because a menu that jumps to the other side of the row for a few pixels of
 * advantage is a menu the reader cannot predict.
 */
export function placeMenu({
  anchor,
  windowHeight,
  windowWidth,
  menuHeight,
  menuWidth,
}: MenuPlacementInput): MenuPlacement {
  const belowTop = anchor.y + anchor.height + MENU_ANCHOR_GAP;
  const belowSpace = windowHeight - belowTop - MENU_EDGE_MARGIN;

  const fitsBelow = belowSpace >= menuHeight;

  // ★ ABOVE IS ALWAYS AVAILABLE ABOVE THE ROW, BUT MAY NOT FIT EITHER.
  //
  // A menu taller than the whole viewport (a long list of actions at a large text
  // scale) fits in neither direction. Below is kept in that case, then clamped into
  // the window — a partly-visible menu at the row's own edge is the most predictable
  // outcome, and it is what a platform menu does.
  const aboveTop = anchor.y - MENU_ANCHOR_GAP - menuHeight;
  const aboveSpace = anchor.y - MENU_ANCHOR_GAP - MENU_EDGE_MARGIN;
  const canOpenAbove = aboveSpace >= menuHeight;

  const above = !fitsBelow && canOpenAbove;

  const rawTop = above ? aboveTop : belowTop;

  // Clamp last, so both branches are held inside the viewport even when neither fit.
  const maxTop = Math.max(MENU_EDGE_MARGIN, windowHeight - menuHeight - MENU_EDGE_MARGIN);
  const top = Math.min(maxTop, Math.max(MENU_EDGE_MARGIN, rawTop));

  /**
   * Horizontally the menu aligns with the row's leading edge, then is pulled back
   * inside the viewport. A row that reaches the edge would otherwise push a
   * wider-than-necessary menu off the opposite side.
   */
  const maxLeft = Math.max(MENU_EDGE_MARGIN, windowWidth - menuWidth - MENU_EDGE_MARGIN);
  // rtl-ok: the menu is positioned in PHYSICAL window coordinates, the same space
  // measureInWindow reports; a logical inset would mirror a rect that did not.
  // left is a PHYSICAL window coordinate, the same space measureInWindow reports.
  const left = Math.min(maxLeft, Math.max(MENU_EDGE_MARGIN, anchor.x));

  // rtl-ok: physical window coordinates, not a logical inset
  return { top, left, above };
}
