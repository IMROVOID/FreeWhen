import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { Modal, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
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
  /**
   * Whether the user may close the sheet.
   *
   * `false` makes this a gate rather than a panel: no pan-down, no back press.
   * The caller owns the dismissal path entirely, which is what a first-launch
   * question the user has to answer needs. Web honours the same prop.
   */
  dismissible?: boolean;
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
  dismissible = true,
  testID,
  style,
}: BottomSheetProps) {
  const { t } = useTheme();
  const sheetRef = useRef<ComponentRef<typeof GorhomBottomSheet>>(null);
  const [mounted, setMounted] = useState(visible);

  const isDynamic = snapPoints === undefined;

  /**
   * The caller's latest intent, for the close callback.
   *
   * A ref, so the callback stays stable across renders and can tell "the user
   * dismissed this" from "the library settled closed as it mounted".
   */
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  /**
   * ★ THE OPEN IS DRIVEN BY `index`, NOT BY `snapToIndex`.
   *
   * `handleSnapToIndex` returns silently when the sheet's own layout has not
   * been calculated yet — `const isLayoutReady = isLayoutCalculated.get(); if
   * (!isLayoutReady) return;` in the library. It was being called from an effect
   * on the commit after mount, which is still before the container has measured
   * itself, so every open was a no-op with no error and no retry. That is why
   * the sheet mounted and never appeared.
   *
   * `index` is the library's supported control: it is applied by an internal
   * effect that re-runs when the layout becomes ready, so the open survives the
   * measurement. `-1` is closed, `0` is the first snap point — or, under dynamic
   * sizing, the measured content height.
   */
  const openIndex = visible && mounted ? 0 : -1;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }

    // The caller closed it. The library animates out; `onClose` tears down.
    setMounted(false);
  }, [visible]);

  /**
   * ★ A MOUNT-TIME CLOSE IS NOT A DISMISSAL.
   *
   * `@gorhom/bottom-sheet` reports `onClose` as soon as it settles at index -1,
   * which includes the moment it mounts closed. Forwarding that to `onDismiss`
   * would clear the caller's `visible` state on the same tick it set it, and the
   * sheet would flash and vanish. Only a close while the caller still wants the
   * sheet counts.
   */
  const handleClose = useCallback(() => {
    if (!visibleRef.current) return;

    onDismiss();
  }, [onDismiss]);

  if (!visible && !mounted) return null;

  /**
   * ★ THE SHEET NEEDS A SIBLING MOUNT, NOT A CHILD OF THE PAGE.
   *
   * `@gorhom/bottom-sheet` renders an absolutely-positioned container anchored
   * to its nearest positioned ancestor. Rendered inline — which is what every
   * caller does, since the trigger and the sheet live in the same component —
   * that ancestor is the screen's `ScrollView` content, so the sheet was laid out
   * against the scroll content, positioned at `bottom: 0` of a box taller than
   * the viewport, and drawn off-screen. That is why no sheet in the app opened:
   * not one caller, and not on another platform's implementation, but every
   * sheet on every caller.
   *
   * A `Modal` gives the sheet a screen-sized, positioned parent of its own and
   * lifts it above the page, which is the container this component always meant
   * to have. `transparent` keeps the page visible behind it, and
   * `statusBarTranslucent` keeps the measured height equal to the window's so
   * the panel is not pushed down by the status bar's inset.
   */
  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={() => {
        if (dismissible) sheetRef.current?.close();
      }}
    >
      {/* ★ THE CONTAINER NEEDS A FULL-SIZE PARENT TO FILL.
          The library's hosting container is `position: absolute` at all four
          edges, so its height comes from its PARENT. A `Modal` renders its child
          into a wrapper that sizes to the content, and the content here is an
          absolutely-positioned box — which collapses to zero. The container then
          measures 0, the library's `isLayoutCalculated` never becomes true, and
          the panel is never shown: the modal opened, covered the page (Back
          dismissed it), and painted nothing.
          This `flex: 1` view gives it a real height to measure against. */}
      <View style={styles.modalRoot}>
        <GorhomBottomSheet
          ref={sheetRef}
          index={openIndex}
          // `undefined` lets the library measure the content; passing an array is
          // what pins it to fractions of the screen.
          snapPoints={snapPoints}
          enablePanDownToClose={dismissible}
          enableDynamicSizing={isDynamic}
          onClose={handleClose}
          backgroundStyle={[styles.background, { backgroundColor: t.surface1 }, style]}
          handleComponent={Grabber}
          accessibilityLabel={testID}
        >
          <BottomSheetView style={styles.content}>{children}</BottomSheetView>
        </GorhomBottomSheet>
      </View>
    </Modal>
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
  modalRoot: {
    // The library's container is absolute-fill; this is the box it fills.
    flex: 1,
  },
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
