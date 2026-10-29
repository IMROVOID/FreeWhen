/**
 * The web implementation of the shared sheet.
 *
 * ★ THE GESTURE LIBRARY DOES NOT RENDER ON THIS BUILD.
 *
 * `@gorhom/bottom-sheet` v5 builds on `react-native-gesture-handler` and
 * `react-native-reanimated`, and on `react-native-web` its container mounts but
 * never appears. A document overlay is the correct surface on the web anyway:
 * click-outside and Escape are the dismissals a mouse and a keyboard user expect.
 *
 * ★ THE FOUR `fix(sheet)` COMMITS BEFORE THIS FILE EXISTED TARGETED NOTHING HERE.
 *
 * `2b11784`, `383373e`, `0d96b62` and `b9a73ee` all edited `BottomSheet.tsx` —
 * the file Metro does NOT resolve on web. Each one diagnosed the invisible sheet
 * again (measurement, scroll parent, commit timing) and none of them changed a
 * line of what the browser renders. Any future sheet fix has to be verified
 * against BOTH files; `tests/ui/sheet-web.test.tsx` exists so this one cannot be
 * missed.
 *
 * ★ `flex: 1` WAS THE VISIBILITY BUG.
 *
 * The root used to be `flex: 1` + `justifyContent: 'flex-end'`. Its parent is
 * React Native Web's portal wrapper, which does not give `flex` a height to
 * resolve against, so the root collapsed toward its content and the panel sat at
 * the top of a zero-height box pinned to `top: 0` — while the full-bleed scrim
 * still swallowed every click. Hence "it is there but invisible, and I cannot
 * click anything". The root is now absolutely inset to the viewport, which needs
 * no cooperation from the parent.
 *
 * ★ THE SCRIM WAS PAINTED WITH THE PAGE BACKGROUND.
 *
 * It was `theme.bg` at 0.72 opacity: a rectangle the same colour as the page
 * behind it. A scrim that does not dim cannot read as a layer, so opening a sheet
 * looked like nothing happening. It is now a translucent black, which dims in
 * both themes and in both directions.
 *
 * ★ THE PANEL CAN BE PULLED DOWN FROM ITS GRABBER.
 *
 * The dismissals were a scrim click and Escape — a phone has neither. The
 * grabber was `pointerEvents="none"`, i.e. pure decoration. It is now a drag
 * handle: pointer-down on the grabber row tracks the pointer, the panel follows
 * it, and on release the pure rule in `sheet-gestures.ts` decides whether that
 * was "close" or "put it back". It is attached to the grabber ONLY, so it can
 * never fight the panel's own scroll view.
 *
 * ★ AND A LONG DOCUMENT GROWS TO FULL HEIGHT WHEN READ DOWNWARD.
 *
 * A sheet capped at 85% makes the reader scroll inside a short window for no
 * reason: the page behind it is already dimmed and cannot be used. Scrolling
 * past a threshold animates the panel to the full viewport; scrolling back to the
 * very top animates it back. `expandedFor` owns the hysteresis.
 *
 * The file name is what makes Metro pick this: native keeps `BottomSheet.tsx`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { radius, size, space } from '@/src/theme/tokens';
import { REDUCED_MOTION_DURATION, dur, ease } from '@/src/theme/motion';
import { useMotion } from '@/src/theme/useMotion';
import { OverlaySurface } from './OverlaySurface';
import { usePageScrollLock } from './page-scroll-lock';
import { ceilingPercentOf, expandedFor, releaseTravelFor } from './sheet-gestures';
import { useTheme } from '@/src/theme/useTheme';

/**
 * A panel taller than this is not worth measuring for the slide — it is already
 * off-screen at the viewport height, and the floor keeps the travel visible on a
 * very short panel.
 */
const MIN_SLIDE_DISTANCE = 600;

export interface BottomSheetProps {
  children: React.ReactNode;
  /** Whether the sheet is presented. */
  visible: boolean;
  onDismiss: () => void;
  /**
   * The panel's starting height as a percentage of the viewport.
   *
   * On web a sheet sizes to its content, so this is a CEILING rather than a
   * fixed height: a two-line confirmation stays two lines tall, and the privacy
   * notice fills the ceiling, expands to the whole viewport once the reader
   * scrolls, and scrolls inside it.
   */
  snapPoints?: string[];
  /**
   * Whether the user may close the sheet.
   *
   * `false` makes this a gate rather than a panel: no scrim press, no Escape,
   * no drag. The caller owns the dismissal path entirely, which is what a
   * first-launch question the user has to answer needs.
   */
  dismissible?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

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
  const motion = useMotion();
  const { width: viewportWidth } = useWindowDimensions();

  /**
   * `rendered` outlives `visible` by one animation.
   *
   * Unmounting the instant `visible` flips false would cut the exit off at frame
   * one — the panel would vanish rather than slide away. This mirrors the native
   * sheet's `mounted` state.
   */
  const [rendered, setRendered] = useState(visible);

  /**
   * The one-shot that keeps the exit from re-arming itself, and the reason the
   * teardown timer can be trusted. See the effect below.
   */
  const [ready, setReady] = useState(visible);

  const [panelHeight, setPanelHeight] = useState(MIN_SLIDE_DISTANCE);

  /** Whether the panel has taken the whole viewport, because it is being read. */
  const [expanded, setExpanded] = useState(false);

  const progress = useSharedValue(0);
  const translateY = useSharedValue(MIN_SLIDE_DISTANCE);

  /**
   * The drag's vertical offset from the panel's rest.
   *
   * A shared value rather than state: it changes on every pointer move, and a
   * re-render per frame would make the drag trail the finger.
   */
  const dragY = useSharedValue(0);

  /** Whether a pointer is currently dragging the grabber. */
  const [dragging, setDragging] = useState(false);

  const timing = (to: number) => withTiming(to, { duration: dur.slow, easing: ease.out });

  /**
   * The teardown timer, held outside React.
   *
   * ★ A TIMER INSIDE AN EFFECT'S CLEANUP CAN BE LOST BY A RE-RENDER.
   *
   * The exit effect re-runs whenever any of its dependencies change, and its
   * cleanup cleared the unmount timer. A re-render in the 420ms between the close
   * and the unmount — a parent's `setExpanded(false)`, a layout pass that moves
   * `panelHeight` — therefore cancelled the only thing that would ever set
   * `rendered` back to false, and the sheet stayed mounted with its scrim over
   * the page forever. A ref cannot be cleared by a dependency change.
   */
  const unmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ensureUnmountScheduled = useCallback(() => {
    if (unmountTimer.current !== null) return;

    unmountTimer.current = setTimeout(
      () => {
        unmountTimer.current = null;
        setRendered(false);
      },
      // Under Reduce Motion there is nothing to wait for beyond the fade.
      motion.reduce ? REDUCED_MOTION_DURATION : dur.slow,
    );
  }, [motion.reduce]);

  // The timer is cleared only on unmount, never by a re-render.
  useEffect(
    () => () => {
      if (unmountTimer.current !== null) {
        clearTimeout(unmountTimer.current);
        unmountTimer.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (visible) {
      // A reopen before the teardown fired must cancel it, or the sheet would
      // unmount under its own entrance.
      if (unmountTimer.current !== null) {
        clearTimeout(unmountTimer.current);
        unmountTimer.current = null;
      }

      setRendered(true);
      setReady(true);
      dragY.value = 0;
      progress.value = timing(1);
      translateY.value = motion.reduce ? 0 : timing(0);
      return;
    }

    /**
     * ★ THE EXIT MUST RUN ONCE, AND THE TEARDOWN MUST SURVIVE A RE-RENDER.
     *
     * `rendered` is in this effect's dependencies because the open branch sets
     * it, and setting it re-runs the effect. On that second pass `visible` is
     * false and the cleanup of the first pass has already cancelled the teardown
     * timer, so the branch animated out AGAIN and re-armed a fresh timer — which
     * did the same thing again. The panel never settled, and every close looked
     * like a hard cut because the exit restarted from zero on each pass.
     *
     * `ready` is the one-shot: the exit is armed once per close.
     *
     * ★ BUT `ready` MUST NOT CANCEL THE ONLY TEARDOWN.
     *
     * The early return below leaves NOTHING scheduled, and this effect's cleanup
     * runs on every dependency change — `panelHeight`, `expanded` via
     * `setExpanded(false)` above, `motion.reduce`. So a re-render between the
     * close and the 420ms timer cleared it and returned early, and `rendered`
     * stayed true forever: the sheet stayed mounted with a full-bleed scrim
     * swallowing every click while its CONTENT had already been replaced by the
     * caller's `visible: false`. That is the reported "after closing an overlay
     * I can't click anything any more, like the focus is still on it" — and the
     * nickname gate is the overlay everyone meets.
     *
     * The teardown therefore lives in its own ref so a re-render cannot lose it,
     * and the one-shot only guards the ANIMATION — which must not restart — not
     * the unmount, which must always happen.
     */
    if (!ready) {
      ensureUnmountScheduled();
      return;
    }

    setExpanded(false);

    progress.value = timing(0);
    // The exit starts from wherever the drag left the panel, not from zero: a
    // pull-down that closes has already travelled.
    translateY.value = motion.reduce ? 0 : timing(Math.max(panelHeight, dragY.value));

    setReady(false);

    // Torn down only after the exit has had time to run, unless motion is
    // reduced — in which case there is nothing to wait for beyond the fade.
    ensureUnmountScheduled();

    return undefined;
  }, [visible, ready, motion.reduce, panelHeight, progress, translateY, dragY, ensureUnmountScheduled]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value + dragY.value }],
  }));

  const onPanelLayout = useCallback((height: number) => {
    if (height > 0) setPanelHeight(height);
  }, []);

  /**
   * Escape closes, which is the dismissal a keyboard user reaches for. A
   * non-dismissible sheet is a gate: there is nowhere to escape to.
   */
  useEffect(() => {
    if (!visible || !dismissible || typeof document === 'undefined') return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onDismiss();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [visible, dismissible, onDismiss]);

  /* ── The grabber drag ─────────────────────────────────────────────────── */

  const drag = useRef({ active: false, startY: 0, lastY: 0, lastT: 0, vy: 0 });

  const onPointerDown = useCallback(
    (event: { nativeEvent: { pageY: number }; timeStamp?: number }) => {
      if (!dismissible) return;
      const y = event.nativeEvent.pageY;
      drag.current = {
        active: true,
        startY: y,
        lastY: y,
        lastT: event.timeStamp ?? Date.now(),
        vy: 0,
      };
      setDragging(true);
    },
    [dismissible],
  );

  const onPointerMove = useCallback(
    (event: { nativeEvent: { pageY: number }; timeStamp?: number }) => {
      if (!drag.current.active) return;

      const y = event.nativeEvent.pageY;
      const now = event.timeStamp ?? Date.now();
      const dt = Math.max(1, now - drag.current.lastT);

      drag.current.vy = (y - drag.current.lastY) / dt;
      drag.current.lastY = y;
      drag.current.lastT = now;

      // Only downward travel moves the panel: pulling up on a sheet that is
      // already at its ceiling has nowhere to go.
      dragY.value = Math.max(0, y - drag.current.startY);
    },
    [dragY],
  );

  const onPointerUp = useCallback(() => {
    if (!drag.current.active) return;

    drag.current.active = false;
    setDragging(false);

    const travel = releaseTravelFor(dragY.value, drag.current.vy, panelHeight);

    if (travel > 0) {
      // Sent the rest of the way so the close is a slide, even after a short
      // flick. `onDismiss` runs the exit from wherever the panel already is.
      translateY.value = withTiming(travel, { duration: dur.base, easing: ease.in });
      onDismiss();
      return;
    }

    dragY.value = withTiming(0, { duration: dur.base, easing: ease.out });
  }, [dragY, panelHeight, onDismiss, translateY]);

  /* ── Expanding to the full viewport while reading ──────────────────────── */

  const onScroll = useCallback(
    (event: { nativeEvent: { contentOffset: { y: number } } }) => {
      const next = expandedFor({ offsetY: event.nativeEvent.contentOffset.y, expanded });
      if (next === expanded) return;

      // ★ ONLY A LONG PANEL EXPANDS.
      //
      // A two-line confirmation has nothing to reveal and would just jump to
      // full height for no reason, so the behaviour is limited to a sheet that
      // declared a ceiling — i.e. one whose content genuinely overflows.
      if (next && snapPoints === undefined) return;

      setExpanded(next);
    },
    [expanded, snapPoints],
  );

  const startingPercent = ceilingPercentOf(snapPoints);
  const heightStyle: ViewStyle = snapPoints
    ? { maxHeight: expanded ? '100%' : `${startingPercent}%` }
    : { maxHeight: '100%' };

  // Nothing is mounted while closed: a sheet that is not open must not leave a
  // handle, a scrim or a focus target behind.
  //
  // ★ THE PAGE BEHIND A MODAL STILL SCROLLS ON THE WEB.
  //
  // `Modal` renders a fixed layer but leaves the document scrollable, so a wheel
  // or a drag that lands on the scrim moves the page under the sheet. The hook is
  // called unconditionally, before the early return, because hooks cannot be
  // conditional — it locks only while `visible`, and its own cleanup releases the
  // shared counter, so one sheet closing cannot unlock another that is stacked
  // above it.
  usePageScrollLock(visible);

  if (!rendered) return null;

  return (
    <Modal transparent visible animationType="none" onRequestClose={dismissible ? onDismiss : undefined}>
      {/* ★ THE SHEET COVERS THE APP'S COLUMN, NOT THE DESKTOP WINDOW.
          A `Modal` mounts into react-native-web's portal wrapper, outside the
          frame's column, so `AppFrame` had no authority over any overlay and a
          sheet on a laptop opened desktop-wide over a phone-sized app. See
          `OverlaySurface.tsx`. */}
      <OverlaySurface viewportWidth={viewportWidth}>
        <View style={styles.root} testID={testID}>
        {/* The scrim is a real control, so a click outside dismisses and a
            screen reader is never trapped in an unlabelled layer. */}
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel={dismissible ? 'close' : undefined}
          accessibilityElementsHidden={!dismissible}
          disabled={!dismissible}
          onPress={onDismiss}
          style={[styles.scrim, { backgroundColor: t.scrim }, scrimStyle]}
        />

        <Animated.View
          onLayout={(event) => onPanelLayout(event.nativeEvent.layout.height)}
          style={[
            styles.panel,
            { backgroundColor: t.surface1 },
            heightStyle,
            style,
            panelStyle,
          ]}
        >
          {/*
            ★ THE GRABBER IS THE DRAG HANDLE.

            `pointerEvents="none"` made it decoration, and the only ways out were
            a scrim click and Escape — neither of which exists on a phone. The
            handlers are on this ROW and nowhere else, so a drag that starts in
            the content still scrolls the content.
          */}
          <View
            style={dragging ? [styles.grabberRow, styles.grabberRowActive] : styles.grabberRow}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            accessibilityRole="adjustable"
            accessibilityLabel={dismissible ? 'drag down to close' : undefined}
            testID={testID ? `${testID}-grabber` : undefined}
          >
            <View style={[styles.grabber, { backgroundColor: t.surface3 }]} />
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            onScroll={onScroll}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator
          >
            {children}
          </ScrollView>
        </Animated.View>
        </View>
      </OverlaySurface>
    </Modal>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const styles = StyleSheet.create({
  root: {
    // Absolute, not `flex: 1`: the portal wrapper above this gives `flex` no
    // height to resolve against, which is what collapsed the sheet.
    position: 'absolute',
    top: 0,
    bottom: 0,
    // Logical insets, so the root covers the same area in both directions.
    insetInlineStart: 0,
    insetInlineEnd: 0,
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
  },
  panel: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    // Lets a `flex: 1` child measure against the ceiling above.
    overflow: 'hidden',
    // The height change when the panel expands is animated by the style swap
    // above; a transition keeps the two ceilings from cutting between frames.
    ...({ transitionProperty: 'max-height', transitionDuration: `${dur.slow}ms` } as object),
  },
  grabberRow: {
    alignItems: 'center',
    paddingVertical: space[2],
    // ★ THE BROWSER MUST NOT CLAIM THE DRAG.
    //
    // Without this a vertical drag on the grabber scrolls the page (or starts a
    // text selection) instead of moving the panel, and the pointerup never
    // arrives where the sheet can see it.
    //
    // ★ AND THE DRAG MUST NOT SELECT THE PANEL'S TEXT EITHER.
    //
    // `touch-action` only stops the browser's SCROLL gesture. A slow downward
    // drag is still a selection gesture everywhere else on a page, so the press
    // dragged across the sheet's title selected the text as it went — "when I
    // pull the overlay down by its header, the texts inside get selected". This
    // is limited to the handle: the panel's content keeps normal selection.
    ...({
      touchAction: 'none',
      cursor: 'grab',
      userSelect: 'none',
      WebkitUserSelect: 'none',
    } as object),
  },
  grabberRowActive: {
    ...({ cursor: 'grabbing' } as object),
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
