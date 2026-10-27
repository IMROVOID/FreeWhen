/**
 * The web implementation of the shared sheet.
 *
 * ★ THE GESTURE LIBRARY DOES NOT RENDER ON THIS BUILD.
 *
 * `@gorhom/bottom-sheet` v5 builds on `react-native-gesture-handler` and
 * `react-native-reanimated`, and on `react-native-web` its container mounts but
 * never appears: nothing is portaled to the document, so the sheet is present in
 * the tree and invisible on screen. Verified directly — measuring the DOM after
 * clicking the trigger showed zero sheet nodes on both the old and the new
 * wrapper, so no sheet in the web app has ever opened.
 *
 * A document overlay is the correct surface on the web anyway: there is no drag
 * gesture to lose, the content scrolls with the page's own scrollbar, and a
 * click-outside and an Escape key are the dismissals a mouse user expects.
 *
 * ★ IT KEEPS THE SAME CONTRACT AS THE NATIVE SHEET.
 *
 * `visible`, `onDismiss`, `snapPoints`, `testID` and `style` mean the same
 * thing, so callers do not branch. `snapPoints`'s first entry becomes the
 * panel's maximum height — on web a content-sized panel is the default, and a
 * named height is only needed for content that cannot measure itself (the
 * privacy notice's `flex: 1` scroll view).
 *
 * The file name is what makes Metro pick this: native keeps `BottomSheet.tsx`.
 */

import { useEffect } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface BottomSheetProps {
  children: React.ReactNode;
  /** Whether the sheet is presented. */
  visible: boolean;
  onDismiss: () => void;
  /**
   * The panel's maximum height as a percentage of the viewport.
   *
   * On web a sheet sizes to its content, so this is a CEILING rather than a
   * fixed height: a two-line confirmation stays two lines tall, and the privacy
   * notice fills the ceiling and scrolls inside it. Omitting it means no cap
   * beyond the viewport.
   */
  snapPoints?: string[];
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** `'85%'` → `'85vh'`, the same proportion expressed for the DOM. */
function ceilingOf(snapPoints: string[] | undefined): ViewStyle {
  const first = snapPoints?.[0];
  if (!first) return { maxHeight: '100%' };

  const percent = /^(\d+(?:\.\d+)?)%$/.exec(first);
  return { maxHeight: percent ? `${percent[1]}vh` : first };
}

export function BottomSheet({ children, visible, onDismiss, snapPoints, testID, style }: BottomSheetProps) {
  const { t } = useTheme();

  // Escape closes, which is the dismissal a keyboard user reaches for and the
  // one a native sheet gets from its back gesture.
  useEffect(() => {
    if (!visible || typeof document === 'undefined') return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onDismiss();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [visible, onDismiss]);

  // Nothing is mounted while closed: a sheet that is not open must not leave a
  // handle, a scrim or a focus target behind.
  if (!visible) return null;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.root} testID={testID}>
        {/* The scrim is a real control, so a click outside dismisses and a
            screen reader is never trapped in an unlabelled layer. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="close"
          onPress={onDismiss}
          style={[styles.scrim, { backgroundColor: t.bg }]}
        />

        <View
          style={[
            styles.panel,
            { backgroundColor: t.surface1 },
            ceilingOf(snapPoints),
            style,
          ]}
        >
          <View style={styles.grabberRow} pointerEvents="none">
            <View style={[styles.grabber, { backgroundColor: t.surface3 }]} />
          </View>

          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    // Logical insets, so the scrim covers the same area in both directions
    // instead of depending on which physical side the row starts from.
    insetInlineStart: 0,
    insetInlineEnd: 0,
    opacity: 0.72,
  },
  panel: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    // Lets a `flex: 1` child measure against the ceiling above.
    overflow: 'hidden',
  },
  grabberRow: {
    alignItems: 'center',
    paddingVertical: space[2],
  },
  grabber: {
    width: size.grabberWidth,
    height: size.grabberHeight,
    borderRadius: radius.pill,
  },
  content: {
    padding: space[5],
    // The panel scrolls internally, so its content must never be clipped by a
    // fixed height; `flexGrow` lets a short sheet stay short.
    flexGrow: 1,
  },
});
