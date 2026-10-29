/**
 * Where the long-press menu opens, from the point the finger was on.
 *
 * ★ "UNDER OR ABOVE" IS THE WHOLE POINT OF THIS MODULE.
 *
 * A context menu anchored under an event row is right until the row is near the
 * foot of the screen — then the menu is clipped or pushed off-viewport, and the last
 * event in a long list becomes the one you cannot act on. So the menu prefers to
 * open from the pressed point and falls back when there is no room.
 *
 * ★ IT OPENS WHERE THE FINGER IS, NOT AT A CORNER.
 *
 * The menu used to be positioned from the row's rect: its `left` was the row's
 * leading edge and its `top` was under the row — with the row spanning the whole
 * list, that is a menu pinned to the list's left (or right) edge and to the row's
 * top, which the report describes as "always at the bottom right, not where I
 * held". A press carries a POINT, so the menu is placed relative to that point:
 * its leading edge sits just after the finger and its first item sits under it.
 *
 * ★ EVERY CHOICE HERE IS CLAMPED, NOT HOPED FOR.
 *
 * A point can be anywhere: at the very top, at the very bottom, hard against
 * either side. Each of those is a branch, and each branch has an assertion in
 * `tests/ui/event-context-menu.test.ts`, because the failure mode is a menu
 * rendered half off-screen with no way to reach the item the user held the row
 * for.
 */

/** The safe distance a menu keeps from the viewport edge. */
export const MENU_EDGE_MARGIN = 12;

/** The gap between the pressed point and the menu. */
export const MENU_ANCHOR_GAP = 8;

export interface MenuAnchor {
  /** The pressed point's y, in window coordinates. */
  y: number;
  /** The pressed point's x, in window coordinates. */
  x: number;
  /** The pressed row's top edge, in window coordinates. */
  rowTop: number;
  /** The pressed row's height. */
  rowHeight: number;
  /** The pressed row's leading edge. */
  rowLeft: number;
  /** The pressed row's width. */
  rowWidth: number;
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
  /** Whether the interface reads right-to-left, which mirrors the horizontal rule. */
  rtl?: boolean;
}

export interface MenuPlacement {
  /** The menu's top edge, in window coordinates. */
  top: number;
  /** The menu's leading edge, in window coordinates. */
  left: number;
  /** Whether it had to open above the press. */
  above: boolean;
}

/**
 * Places the menu, preferring from-the-press and falling back when it cannot fit.
 *
 * Vertical: the menu's top starts at the press, and drops below the press when
 * there is more room beneath it than above. The fallback is not "whichever side
 * has more room" — it is "at the press unless that does not fit" — because a menu
 * that jumps to the other side for a few pixels of advantage is a menu the reader
 * cannot predict.
 *
 * Horizontal: the menu's leading edge sits `MENU_ANCHOR_GAP` past the press, on
 * whichever side the layout reads from, then is pulled back inside the viewport.
 */
export function placeMenu({
  anchor,
  windowHeight,
  windowWidth,
  menuHeight,
  menuWidth,
  rtl = false,
}: MenuPlacementInput): MenuPlacement {
  /**
   * Vertical — `top` starts at the press so the first item lands under the
   * finger. When that would overflow the foot, the menu is lifted so its LAST
   * item is at the press instead, which is the platform behaviour and keeps the
   * menu adjacent to where the user is looking.
   */
  const fromPress = anchor.y - MENU_ANCHOR_GAP;
  const spaceBelow = windowHeight - MENU_EDGE_MARGIN - fromPress;
  const spaceAbove = anchor.y - MENU_EDGE_MARGIN;

  const above = spaceBelow < menuHeight && spaceAbove > spaceBelow;

  const rawTop = above ? anchor.y - menuHeight + MENU_ANCHOR_GAP : fromPress;

  // Clamp last, so both branches are held inside the viewport even when neither fit.
  const maxTop = Math.max(MENU_EDGE_MARGIN, windowHeight - menuHeight - MENU_EDGE_MARGIN);
  const top = Math.min(maxTop, Math.max(MENU_EDGE_MARGIN, rawTop));

  /**
   * Horizontal — measured from the press, on the reading side.
   *
   * `rtl-ok`: this is a PHYSICAL window coordinate derived from a physical press,
   * so the mirroring is done explicitly by `rtl` rather than by a logical inset —
   * a logical inset would be applied to a rect that is already physical and would
   * double-mirror it.
   *
   * ★ WHEN THE READING SIDE DOES NOT FIT, THE MENU FLIPS TO THE OTHER SIDE.
   *
   * In RTL the menu hangs to the LEFT of the finger. A press near the leading
   * edge makes that left edge negative — and clamping to `MENU_EDGE_MARGIN` then
   * parked the menu at the far LEFT margin, which is the one place it was trying
   * to get away from: it read as the menu jumping across the screen instead of
   * opening at the finger. The same applies to an LTR press at the trailing edge.
   *
   * So the reading side is tried first, and if it does not fit the menu opens on
   * the opposite side of the press. Only a press with no room on EITHER side is
   * clamped, which is the degenerate case of a menu wider than the remaining
   * space.
   */
  const maxLeft = Math.max(MENU_EDGE_MARGIN, windowWidth - menuWidth - MENU_EDGE_MARGIN);

  const readingLeft = rtl
    ? anchor.x - menuWidth - MENU_ANCHOR_GAP
    : anchor.x + MENU_ANCHOR_GAP;

  const oppositeLeft = rtl ? anchor.x + MENU_ANCHOR_GAP : anchor.x - menuWidth - MENU_ANCHOR_GAP;

  const fits = (candidate: number): boolean =>
    candidate >= MENU_EDGE_MARGIN && candidate <= maxLeft;

  const chosen = fits(readingLeft) ? readingLeft : fits(oppositeLeft) ? oppositeLeft : readingLeft;

  // rtl-ok: `left` is a PHYSICAL window x, the same space `measureInWindow`
  // reports. The mirroring is already explicit in `readingLeft`/`oppositeLeft`
  // rtl-ok: `left` is a PHYSICAL window x, the same space `measureInWindow` reports
  const left = Math.min(maxLeft, Math.max(MENU_EDGE_MARGIN, chosen));

  return {
    top,
    left, // rtl-ok: a physical window x; the mirroring is explicit above
    above,
  };
}

/**
 * The press point, from a row's rect and a touch inside it.
 *
 * Kept pure so the "where did the finger actually land" conversion is testable:
 * a `nativeEvent.locationX/locationY` is relative to the ROW, while the menu is
 * positioned in WINDOW coordinates.
 */
export function anchorFromPress(
  row: { x: number; y: number; width: number; height: number },
  press: { x: number; y: number },
): MenuAnchor {
  return {
    x: row.x + press.x,
    y: row.y + press.y,
    rowTop: row.y,
    rowHeight: row.height,
    rowLeft: row.x,
    rowWidth: row.width,
  };
}

/** A press exactly at the row's centre — the fallback for a keyboard or a screen reader. */
export function anchorFromRow(row: {
  x: number;
  y: number;
  width: number;
  height: number;
}): MenuAnchor {
  return anchorFromPress(row, { x: row.width / 2, y: row.height / 2 });
}
