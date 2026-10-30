import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { Modal, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import GorhomBottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';

import { dur } from '@/src/theme/motion';
import { radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

import { shouldOpenSheet, sheetIndexFor } from './sheet-open';

/**
 * How often the open is re-asked while the library has not acknowledged it.
 *
 * One frame at 60Hz is ~16ms; 32ms gives the container's measurement and the
 * library's `isLayoutCalculated` derivation a frame to agree without feeling slow.
 */
const SHEET_OPEN_RETRY_MS = 32;

/**
 * How many re-asks before giving up.
 *
 * ~8 × 32ms ≈ 250ms, comfortably longer than the two-frame race this covers while
 * staying far short of a user's tolerance for an unresponsive tap. The interval is
 * cleared the moment the library acknowledges, so this ceiling is only reached if
 * the sheet genuinely cannot open.
 */
const SHEET_OPEN_ATTEMPTS = 8;

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
   * ★ THE OPEN IS DRIVEN BY `index` AND RETRIED UNTIL THE LIBRARY ACKNOWLEDGES.
   *
   * `handleSnapToIndex` returns silently when the sheet's own layout has not been
   * calculated yet — `const isLayoutReady = isLayoutCalculated.get(); if
   * (!isLayoutReady) return;` in the library — and the effect that reacts to the
   * `index` prop does NOT depend on layout readiness, so the drop is permanent:
   * the `index` value stays `0`, the mount flags stay put, and nothing re-runs
   * when the measurement finally arrives.
   *
   * That is why every overlay in this app opened and painted nothing: the sheet's
   * `Modal` is presented (a real window on Android), the panel inside it stays
   * translated off-screen at `index −1`, and the window swallows every touch. The
   * report is exact: "the overlays still don't open on App/Mobile, it just swallows
   * the Focus/Control".
   *
   * ★ AND AN ATTEMPT IS NOT A SUCCESS.
   *
   * The first version of this retry set the "opened" flag BEFORE calling
   * `snapToIndex`, so the mount-time attempt — which the library silently ignores,
   * because its gate is still closed — consumed the retry. When `onLayout` then
   * fired, the guard rejected it and the sheet never opened at all. The flag is
   * therefore set ONLY by the library's own acknowledgement (`onChange`), and the
   * attempt itself is free to repeat.
   */
  const openIndex = sheetIndexFor({ visible, mounted });

  /**
   * Whether the library has confirmed that the sheet actually opened.
   *
   * Written by `onChange` — the library's signal that it settled at an index — and
   * cleared when the caller closes the sheet, so the next presentation opens again.
   */
  const openedRef = useRef(false);

  /**
   * Whether the library has settled ANYWHERE for this presentation, including a
   * position the user chose by dragging.
   *
   * Distinct from `openedRef` because a settle at a negative index is not an open —
   * but it IS the user taking control, so it must end the retry just the same.
   */
  const settledRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      openedRef.current = false;
      settledRef.current = false;
    }
  }, [visible]);

  const requestOpen = useCallback(() => {
    if (!shouldOpenSheet({ wanted: visible, layoutReady: true, alreadyOpened: openedRef.current })) {
      return;
    }

    // Deliberately NO state update here. The library ignores a call whose layout
    // gate is still closed, so this may be a no-op — and treating a no-op as
    // success is what killed the retry before.
    sheetRef.current?.snapToIndex(0);
  }, [visible]);

  /**
   * The library reported a settle: stop asking it to open.
   *
   * ★ ANY SETTLED INDEX ENDS THE RETRY, INCLUDING ONE THE USER CHOSE.
   *
   * A drag that comes to rest anywhere — at a snap point, mid-flight, or back at
   * closed — is the user having taken control. Continuing to call `snapToIndex(0)`
   * for the rest of the retry budget would fight that gesture. The retry exists to
   * survive a *gated* call the library silently ignored, not to override a
   * decision the user made.
   *
   * An actual open is additionally recorded, so `requestOpen` becomes a no-op for
   * the rest of this presentation.
   */
  const handleChange = useCallback((index: number) => {
    if (index >= 0) openedRef.current = true;
    settledRef.current = true;
  }, []);

  useEffect(() => {
    if (!visible || !mounted) return;
    requestOpen();
  }, [visible, mounted, requestOpen]);

  /**
   * ★ A BOUNDED RETRY, BECAUSE `onLayout` IS NOT ALWAYS LATE ENOUGH.
   *
   * `onLayout` on the measuring parent is the first moment the library's gate
   * *can* pass, but it is not guaranteed to be the moment it *has* passed: on
   * Android the container's measurement and the library's own
   * `isLayoutCalculated` are separate derivations of the same frame, and the
   * second can still be `false` when the first arrives. One retry attempts that
   * race and loses it silently.
   *
   * So the open is re-asked on a short interval until the library acknowledges
   * (or the budget runs out). Each attempt is free — the library ignores a call it
   * is not ready for — and `openedRef` stops the interval the moment it settles, so
   * the happy path pays a single extra call at most.
   */
  useEffect(() => {
    if (!visible || !mounted) return;

    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;

      if (openedRef.current || settledRef.current || attempts > SHEET_OPEN_ATTEMPTS) {
        clearInterval(timer);
        return;
      }

      requestOpen();
    }, SHEET_OPEN_RETRY_MS);

    return () => clearInterval(timer);
  }, [visible, mounted, requestOpen]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }

    /**
     * ★ THE MODAL IS NOT TORN DOWN ON THE SAME TICK `visible` GOES FALSE.
     *
     * Clearing `mounted` here makes `return null` below remove the `Modal`
     * immediately, and on Android a `Modal` removed while it is still on screen
     * leaves its window behind — observed on the emulator as a second
     * `ty=APPLICATION fmt=TRANSPARENT … shown=true` window that covered the app
     * and swallowed every touch while the page beneath looked completely normal.
     *
     * It happened to be survivable before because nothing closed a sheet
     * programmatically: the only exits were the pan gesture and a scrim press, and
     * both go through `onClose`, which tears down after the library has settled.
     * The nickname gate closes from its own `onResolved` callback instead, so the
     * teardown raced the animation.
     *
     * Waiting out the close slide is what lets the sheet finish leaving rather
     * than being cut off. `dur.base` is the same number the library's own close
     * takes, and the guard keeps a repeated `false` from re-arming the timer.
     */
    if (!mounted) return;

    const timer = setTimeout(() => setMounted(false), dur.base);
    return () => clearTimeout(timer);
  }, [visible, mounted]);

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
          This `flex: 1` view gives it a real height to measure against.

          ★ AND ITS `onLayout` IS THE OPEN'S SECOND CHANCE.
          This node is the sheet's measuring parent, so its layout event is
          precisely the moment the library's `isLayoutCalculated` can become true
          — which is the moment a previously-dropped `snapToIndex` would succeed.
          Without this the open was attempted once, before measurement existed, and
          never retried. */}
      <View style={styles.modalRoot} onLayout={requestOpen}>
        <GorhomBottomSheet
          ref={sheetRef}
          index={openIndex}
          // `undefined` lets the library measure the content; passing an array is
          // what pins it to fractions of the screen.
          snapPoints={snapPoints}
          enablePanDownToClose={dismissible}
          enableDynamicSizing={isDynamic}
          onClose={handleClose}
          // ★ THE ACKNOWLEDGEMENT. This is the only thing that marks the open as
          // done, so a call the library silently ignored cannot consume the retry.
          onChange={handleChange}
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
