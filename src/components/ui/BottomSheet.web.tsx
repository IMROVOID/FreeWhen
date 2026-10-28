/**
 * The web implementation of the shared sheet.
 *
 * ★ THE GESTURE LIBRARY DOES NOT RENDER ON THIS BUILD.
 *
 * `@gorhom/bottom-sheet` v5 builds on `react-native-gesture-handler` and
 * `react-native-reanimated`, and on `react-native-web` its container mounts but
 * never appears. A document overlay is the correct surface on the web anyway:
 * there is no drag gesture to lose, and click-outside and Escape are the
 * dismissals a mouse and a keyboard user expect.
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
 * ★ THE FADE WAS THE PLATFORM'S, NOT OURS.
 *
 * `react-native-web`'s `Modal` implements `animationType="fade"` as an opacity
 * keyframe on the whole container, scrim included. The panel is now animated by
 * reanimated: it translates from below the fold to rest, and the scrim
 * cross-fades. Reduce Motion collapses both to a 120ms fade (Style Guide §7.7)
 * while still opening the sheet.
 *
 * ★ IT KEEPS THE SAME CONTRACT AS THE NATIVE SHEET.
 *
 * `visible`, `onDismiss`, `snapPoints`, `testID` and `style` mean the same thing,
 * so callers do not branch. `snapPoints`'s first entry becomes the panel's
 * maximum height — on web a content-sized panel is the default, and a named
 * height is only needed for content that cannot measure itself (the privacy
 * notice's `flex: 1` scroll view).
 *
 * The file name is what makes Metro pick this: native keeps `BottomSheet.tsx`.
 */

import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { radius, size, space } from '@/src/theme/tokens';
import { REDUCED_MOTION_DURATION, dur, ease } from '@/src/theme/motion';
import { useMotion } from '@/src/theme/useMotion';
import { usePageScrollLock } from './page-scroll-lock';
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
   * The panel's maximum height as a percentage of the viewport.
   *
   * On web a sheet sizes to its content, so this is a CEILING rather than a
   * fixed height: a two-line confirmation stays two lines tall, and the privacy
   * notice fills the ceiling and scrolls inside it. Omitting it means no cap
   * beyond the viewport.
   */
  snapPoints?: string[];
  /**
   * Whether the user may close the sheet.
   *
   * `false` makes this a gate rather than a panel: no scrim press, no Escape.
   * The caller owns the dismissal path entirely, which is what a first-launch
   * question the user has to answer needs.
   */
  dismissible?: boolean;
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

  const progress = useSharedValue(0);
  const translateY = useSharedValue(MIN_SLIDE_DISTANCE);

  const timing = (to: number) => withTiming(to, { duration: dur.slow, easing: ease.out });

  useEffect(() => {
    if (visible) {
      setRendered(true);
      setReady(true);
      progress.value = timing(1);
      translateY.value = motion.reduce ? 0 : timing(0);
      return;
    }

    /**
     * ★ THE EXIT MUST RUN ONCE.
     *
     * `rendered` is in this effect's dependencies because the open branch sets
     * it, and setting it re-runs the effect. On that second pass `visible` is
     * false and the cleanup of the first pass has already cancelled the teardown
     * timer, so the branch animated out AGAIN and re-armed a fresh timer — which
     * did the same thing again. The panel never settled, and every close looked
     * like a hard cut because the exit restarted from zero on each pass.
     *
     * `ready` is the one-shot: the exit is armed once per close.
     */
    if (!ready) return;

    progress.value = timing(0);
    translateY.value = motion.reduce ? 0 : timing(panelHeight);

    setReady(false);

    // Torn down only after the exit has had time to run, unless motion is
    // reduced — in which case there is nothing to wait for beyond the fade.
    const timer = setTimeout(() => setRendered(false), motion.reduce ? REDUCED_MOTION_DURATION : dur.slow);
    return () => clearTimeout(timer);
  }, [visible, ready, motion.reduce, panelHeight, progress, translateY]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

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
            ceilingOf(snapPoints),
            style,
            panelStyle,
          ]}
        >
          <View style={styles.grabberRow} pointerEvents="none">
            <View style={[styles.grabber, { backgroundColor: t.surface3 }]} />
          </View>

          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </Animated.View>
      </View>
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
