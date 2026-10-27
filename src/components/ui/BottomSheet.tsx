import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import GorhomBottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';

import { radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface BottomSheetProps {
  children: React.ReactNode;
  /** Whether the sheet is presented. */
  visible: boolean;
  onDismiss: () => void;
  /**
   * Explicit snap points, for a sheet whose height genuinely cannot come from
   * its content.
   *
   * Omit it for a short, fixed sheet — that is the common case, and omitting it
   * is what makes the sheet fit rather than leaving a dead band.
   *
   * ★ PASS IT WHEN THE CONTENT HAS NO INTRINSIC HEIGHT.
   *
   * A child with `flex: 1` (a scrolling list, which is what `CommentSheet`
   * holds) measures as zero under content sizing, so its list would collapse to
   * its own padding. Those sheets must name a height.
   */
  snapPoints?: string[];
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A sheet with a grabber and velocity-based snapping. Top corners `r.xl`,
 * `surface1` fill (Style Guide §11.8).
 *
 * ★ DYNAMIC SIZING IS THE DEFAULT, AND IT IS NOT A LUXURY.
 *
 * The sheet used to hardcode `enableDynamicSizing={false}` and take a snap-point
 * percentage from every caller. The share sheet's content is two rows and a
 * button, so its `'50%'` left a large dead band above the action, and the page
 * underneath showed through the uncovered area. A percentage can only be right
 * for one screen at one font scale.
 *
 * ★ A CLOSED SHEET MUST RENDER NOTHING AT ALL.
 *
 * `@gorhom/bottom-sheet` keeps its handle mounted and its pan gesture live even
 * at `index={-1}`. On the event screen that left a drag handle sitting on the
 * bottom edge of a page with no sheet open, and dragging it pulled up an empty
 * panel — the collapsed, expandable, empty overlay users reported.
 *
 * So the sheet is MOUNTED ONLY WHILE IT IS WANTED. `mounted` is set when
 * `visible` turns true and cleared from `onClose`, so a dismissal still animates
 * away instead of vanishing mid-slide.
 *
 * The library is controlled through the snap-point `index`: `-1` means closed,
 * `0` is the first snap point — or, under dynamic sizing, the measured content
 * height.
 */
export function BottomSheet({
  children,
  visible,
  onDismiss,
  snapPoints,
  testID,
  style,
}: BottomSheetProps) {
  const { t } = useTheme();
  const sheetRef = useRef<ComponentRef<typeof GorhomBottomSheet>>(null);
  const [mounted, setMounted] = useState(visible);

  const isDynamic = snapPoints === undefined;

  // ★ THE OPEN MUST WAIT FOR THE MOUNT.
  //
  // A closed sheet returns `null`, so on the first open the ref is still null in
  // the effect that sets `mounted` — `snapToIndex(0)` would be a no-op against
  // nothing and the sheet would mount at `index={-1}` and never open. Every
  // caller flips `visible` in the same render as the trigger, so that is the
  // common path, not an edge case.
  //
  // The two steps are therefore SEQUENCED: mount first, then open on the render
  // that follows, when the ref exists.
  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }

    sheetRef.current?.close();
  }, [visible]);

  useEffect(() => {
    if (visible && mounted) {
      sheetRef.current?.snapToIndex(0);
    }
  }, [visible, mounted]);

  /**
   * ★ A MOUNT-TIME CLOSE IS NOT A DISMISSAL.
   *
   * `@gorhom/bottom-sheet` reports `onClose` as soon as it settles at index -1,
   * which includes the moment it mounts closed. Forwarding that to `onDismiss`
   * would clear the caller's `visible` state on the same tick it set it, and the
   * sheet would flash and vanish. Only a close while the caller still wants the
   * sheet counts, and `visible` is read through a ref so the callback is stable
   * across renders.
   */
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const handleClose = useCallback(() => {
    if (visibleRef.current) {
      // The sheet closed itself (a drag, or the back button) while the caller
      // still considers it open: the caller's state is now stale.
      onDismiss();
      return;
    }

    // The caller closed it. Tear down only now, so the close animation runs.
    setMounted(false);
  }, [onDismiss]);

  if (!visible && !mounted) return null;

  return (
    <GorhomBottomSheet
      ref={sheetRef}
      index={-1}
      // `undefined` lets the library measure the content; passing an array is
      // what pins it to fractions of the screen.
      snapPoints={snapPoints}
      enablePanDownToClose
      enableDynamicSizing={isDynamic}
      onClose={handleClose}
      backgroundStyle={[styles.background, { backgroundColor: t.surface1 }, style]}
      handleComponent={Grabber}
      accessibilityLabel={testID}
    >
      <BottomSheetView style={styles.content}>{children}</BottomSheetView>
    </GorhomBottomSheet>
  );
}

function Grabber() {
  const { t } = useTheme();
  return (
    <View style={styles.grabberWrapper}>
      <View style={[styles.grabber, { backgroundColor: t.surface3 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  background: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  content: {
    padding: space[5],
  },
  grabberWrapper: {
    alignItems: 'center',
    paddingVertical: space[2],
  },
  grabber: {
    width: size.grabberWidth,
    height: size.grabberHeight,
    borderRadius: radius.pill,
  },
});
