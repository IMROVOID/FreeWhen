/**
 * The box a web overlay covers: the app's own column, not the window.
 *
 * ★ THE OVERLAYS WERE THE ONE THING THE DESKTOP FRAME DID NOT COVER.
 *
 * `AppFrame` caps the routes in a centred phone-width column on a laptop. Every
 * sheet and menu is a `Modal`, and a modal mounts into react-native-web's portal
 * wrapper — a sibling of the app, not a descendant — so its absolutely-inset root
 * resolved against the whole window and every overlay opened desktop-wide over a
 * phone-sized app. The reported symptom is exactly that: "the page is clamped but
 * the overlays are still full desktop width".
 *
 * The geometry is `overlay-surface.ts`; this file is the one place it becomes
 * layout. It renders INSIDE a `Modal`, so it is the only node between the portal
 * wrapper and the panel.
 *
 * ★ BELOW THE BREAKPOINT IT IS A PASS-THROUGH.
 *
 * A phone's window IS the app, so the overlay has to cover all of it. Below
 * `TABLET_BREAKPOINT` the children are returned unwrapped and the overlay's own
 * absolute root — which this file must not disturb — still fills the viewport.
 *
 * ★ THE DIM BEHIND THE COLUMN IS THE OVERLAYS' OWN SCRIM, AT A SECOND LAYER.
 *
 * The scrim inside the panel dims the app's column. The band either side of that
 * column would otherwise be undimmed, which reads as the page being usable while
 * a sheet is open. This component paints the same band, so the whole window is
 * dimmed and only the app's column is interactive.
 */

import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/src/theme/useTheme';

import { overlaySurface } from './overlay-surface';

export interface OverlaySurfaceProps {
  /** The viewport's width. */
  viewportWidth: number;
  children: React.ReactNode;
}

export function OverlaySurface({ viewportWidth, children }: OverlaySurfaceProps) {
  const { t } = useTheme();

  const geometry = overlaySurface({ width: viewportWidth });

  // A phone: the window is the app, so there is nothing to clamp and nothing to
  // add to the node tree.
  if (!geometry.clamped) return <>{children}</>;

  return (
    <View
      style={[styles.canvas, { backgroundColor: t.scrim }]}
      testID="overlay-surface"
    >
      <View
        style={[
          styles.column,
          {
            width: geometry.columnWidth,
            marginStart: geometry.columnInset,
            marginEnd: geometry.columnInset,
          },
        ]}
        testID="overlay-surface-column"
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    flex: 1,
    // The frame's own shell is a column; the overlay's is a row inside it. This
    // is `column` physically, because the band is painted symmetrically and the
    // column is centred — there is no leading or trailing side to mirror.
    flexDirection: 'row',
  },
  column: {
    flexGrow: 1,
    flexShrink: 1,
    // The overlay's own root is `position: absolute` at all four edges, so it
    // needs a positioned parent that is exactly the column.
    position: 'relative',
    overflow: 'hidden',
  },
});
