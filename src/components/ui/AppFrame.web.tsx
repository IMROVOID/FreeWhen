/**
 * The desktop presentation frame (web only).
 *
 * ★ THE APP WAS NOT DESIGNED FOR A DESKTOP, SO IT DOES NOT STRETCH TO ONE.
 *
 * Every screen in this product is a phone layout: one column, a header row, a
 * bottom action. Rendered at 1440px wide, the event list becomes a band of text
 * four words wide running the length of the window, the map picker is a letterbox
 * twice as wide as it is tall, and the sheets stretch until the panel's own
 * padding looks like a mistake. The request was explicit: limit the aspect ratio
 * to a phone or tablet with full height, "something like Chrome's Responsive
 * view".
 *
 * ★ PHONES AND TABLETS ARE UNTOUCHED.
 *
 * The cap only applies at or above `TABLET_BREAKPOINT`. Below it this component
 * renders its children through unchanged — no wrapper, no style, no extra layout
 * pass — so a phone and a tablet get byte-identical behaviour to before. That is
 * also why the breakpoint is a named export: the test asserts the exact number
 * rather than a screenshot.
 *
 * ★ THE COLUMN IS CENTRED ON A TINTED CANVAS, NOT ON WHITE.
 *
 * The area outside the column is painted with the SAME theme background at a
 * darker step, so the app reads as a surface with edges rather than as a page
 * that stops. `cardEdge` is reused for those two hairlines, which is the token
 * the cards already use, so the frame and a card share one boundary colour.
 */

import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { useTheme } from '@/src/theme/useTheme';

/**
 * The width at or above which the desktop frame applies.
 *
 * 768 is the conventional tablet breakpoint: below it the viewport IS a tablet
 * (or a phone in landscape), where the layout already fits.
 */
export const TABLET_BREAKPOINT = 768;

/**
 * The widest the app's column gets on a desktop.
 *
 * 520 is a large phone / small tablet at 100% zoom. Wider than this and the
 * single-column screens start to read as empty; narrower and the Persian type
 * scale's line lengths get short enough to wrap badly.
 */
export const FRAME_MAX_WIDTH = 520;

export interface AppFrameProps {
  children: React.ReactNode;
}

export function AppFrame({ children }: AppFrameProps) {
  const { t: theme } = useTheme();
  const { width } = useWindowDimensions();

  /**
   * ★ A PASS-THROUGH, NOT A WIDE WRAPPER.
   *
   * Returning `children` directly (rather than a `View` with no styles) keeps the
   * phone layout's node tree exactly what it was, so nothing about a phone's
   * layout, safe-area handling or scroll behaviour changes.
   */
  if (width < TABLET_BREAKPOINT) return <>{children}</>;

  return (
    <View style={[styles.canvas, { backgroundColor: theme.bg }]} testID="app-frame">
      {/* The canvas behind the column. It is the page background at a darker
          step, so the phone-sized column reads as the app rather than as a page
          that has been cut off. */}
      <View
        pointerEvents="none"
        style={[styles.scrim, { backgroundColor: theme.surface3 }]}
        testID="app-frame-canvas"
      />

      <View
        style={[
          styles.column,
          { backgroundColor: theme.bg, borderColor: theme.cardEdge },
        ]}
        testID="app-frame-column"
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    flex: 1,
    width: '100%',
    // Full height, as asked: the column is the viewport's height and scrolls
    // internally exactly as it does on a phone.
    height: '100%',
    alignItems: 'center',
    overflow: 'hidden',
  },
  scrim: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0, // rtl-ok: full-bleed inset, symmetric so there is nothing to mirror
    right: 0,
    // The darker step is a hint that there is a frame, not a second surface. The
    // page colour behind the column does the rest.
    opacity: 0.55,
  },
  column: {
    flex: 1,
    width: '100%',
    maxWidth: FRAME_MAX_WIDTH,
    height: '100%',
    // Logical, because the frame is symmetric: both edges always have a rule, so
    // the two spellings describe the same box in either direction.
    borderStartWidth: StyleSheet.hairlineWidth,
    borderEndWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
});
