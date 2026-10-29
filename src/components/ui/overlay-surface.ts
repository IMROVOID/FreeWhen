/**
 * Where a web overlay lives, in the same coordinates `AppFrame` uses.
 *
 * ★ `AppFrame` CLAMPS THE ROUTES, AND NOTHING CLAMPED THE OVERLAYS.
 *
 * The frame caps `<Stack>` in a centred column at or above
 * `TABLET_BREAKPOINT`, which covers every screen. Every overlay in the product
 * is a `Modal`, and a modal renders into react-native-web's portal wrapper — a
 * direct child of `<body>`, i.e. OUTSIDE the frame's column. Each overlay's root
 * is `position: absolute` with both inline insets at 0, so it resolved against
 * the portal wrapper and covered the whole window. On a laptop the app was a
 * phone column with desktop-wide sheets over it.
 *
 * ★ THE TWO NUMBERS ARE IMPORTED, NOT COPIED.
 *
 * The column an overlay covers has to be the column the app occupies. A second
 * literal would drift the first time the frame changed, and the failure would be
 * a one-frame offset that reads as a rendering fault rather than as a bug.
 *
 * Pure and renderer-free so the arithmetic is testable: "does the sheet clamp on
 * a laptop" is a question with a wrong answer that no screenshot review catches.
 */

import { FRAME_MAX_WIDTH, TABLET_BREAKPOINT } from './AppFrame.web';

export { FRAME_MAX_WIDTH, TABLET_BREAKPOINT };

export interface OverlaySurfaceInput {
  /** The viewport's width, from `useWindowDimensions`. */
  width: number;
}

export interface OverlaySurfaceGeometry {
  /**
   * `false` means "cover the viewport", which is what a phone needs: below the
   * breakpoint the window IS the app.
   */
  clamped: boolean;
  /** The overlay column's width. */
  columnWidth: number;
  /** The inline inset of that column. Symmetric, so the direction is irrelevant. */
  columnInset: number;
}

/** The overlay column for a viewport width. */
export function overlaySurface({ width }: OverlaySurfaceInput): OverlaySurfaceGeometry {
  if (width < TABLET_BREAKPOINT) {
    return { clamped: false, columnWidth: width, columnInset: 0 };
  }

  return {
    clamped: true,
    columnWidth: FRAME_MAX_WIDTH,
    // Centred: the leftover width, halved. `Math.max` keeps a viewport narrower
    // than the column (a resized desktop window at exactly the breakpoint) from
    // producing a negative inset.
    columnInset: Math.max(0, (width - FRAME_MAX_WIDTH) / 2),
  };
}
