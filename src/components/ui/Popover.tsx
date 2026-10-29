/**
 * A popover anchored to a point on screen.
 *
 * ★ THE OVERLAY RULES IN `BottomSheet.web.tsx` APPLY TO THIS TOO.
 *
 * A bare platform `Modal` has no exit on either platform: it vanishes rather than
 * animating away, and on web `react-native-web`'s implementation renders a layer that
 * a document-level wrapper can leave invisible while its scrim still swallows clicks.
 * So the structure here is the same one the sheet uses — an absolutely-inset root
 * inside a transparent `Modal` — and the entrance/exit is a timing animation the
 * component owns, not the OS's.
 *
 * ★ IT IS NOT A BOTTOM SHEET, AND THAT IS THE POINT.
 *
 * A sheet slides up from the foot of the screen because it asks a question about the
 * page. A context menu answers a question about ONE ROW, and sliding it to the bottom
 * edge severs it from the thing it belongs to. So this one is positioned, and the
 * `position` prop is the caller's computed rect — see `menu-placement.ts`, which holds
 * the "under the row, or above it when there is no room" rule.
 *
 * ★ IT MUST KEEP ITS `Modal` PRESENTED UNTIL THE EXIT HAS RUN.
 *
 * This is the Android focus-lock bug, and it is not cosmetic. The component used to
 * `return null` on the same tick `visible` went false — while its `Modal` was still on
 * screen. On Android a `Modal` removed while presented leaves its window behind: a
 * transparent `TYPE_APPLICATION` window that covers the app and swallows every touch.
 * The page underneath looked completely normal and nothing responded, which is exactly
 * the reported "after closing an overlay I can't click anything any more, like the
 * focus is still on the closed overlay". Four screens reach this component, and the
 * set is not guessable from the symptom.
 *
 * `mounted` outlives `visible` by one animation for the same reason `BottomSheet`
 * has one, and the teardown is armed ONCE per close so a re-render cannot restart it.
 */

import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { REDUCED_MOTION_DURATION, dur, ease } from '@/src/theme/motion';
import { radius, space } from '@/src/theme/tokens';
import { useMotion } from '@/src/theme/useMotion';
import { useTheme } from '@/src/theme/useTheme';

export interface PopoverProps {
  /** Whether the popover is wanted. */
  visible: boolean;
  /** Dismisses it. Called by the scrim, the back button, and Escape. */
  onDismiss: () => void;
  /** The popover's viewport position, from the caller's own measurement. */
  position: { top: number; left: number } | null;
  accessibilityLabel?: string;
  testID?: string;
  children: React.ReactNode;
}

export function Popover({
  visible,
  onDismiss,
  position,
  accessibilityLabel,
  testID,
  children,
}: PopoverProps) {
  const { t } = useTheme();
  const motion = useMotion();

  const [rendered, setRendered] = useState(visible);

  /** The one-shot that keeps the exit from re-arming itself. See the effect. */
  const [ready, setReady] = useState(visible);

  const progress = useSharedValue(visible ? 1 : 0);

  /**
   * The caller's latest intent.
   *
   * A ref, so a dismissal the caller initiated (the menu's own item tap, for
   * instance) does not race the caller's `visible` update and get reported twice.
   */
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    if (visible) {
      setRendered(true);
      setReady(true);
      progress.value = motion.reduce ? 1 : withTiming(1, { duration: dur.fast, easing: ease.out });
      return;
    }

    /**
     * ★ THE EXIT RUNS ONCE.
     *
     * `rendered` is set by the open branch above, which re-runs this effect. On
     * that second pass `visible` is false and the first pass's cleanup has
     * already cancelled the teardown timer, so the branch would animate out
     * AGAIN and arm a fresh timer — the panel never settled. `ready` is the
     * one-shot.
     */
    if (!ready) return;

    progress.value = motion.reduce ? 0 : withTiming(0, { duration: dur.base, easing: ease.out });
    setReady(false);

    /**
     * ★ THE TEARDOWN WAITS FOR THE EXIT, AND IT MUST BE THE `Modal`'S TEARDOWN.
     *
     * Waiting out `dur.base` is what lets the fade finish instead of being cut
     * one frame in, and — the part that matters on Android — it keeps the
     * `Modal` presented until the animation is over, so removing it cannot
     * strand its window over the app.
     */
    const lift = motion.reduce ? REDUCED_MOTION_DURATION : dur.base;
    const timer = setTimeout(() => setRendered(false), lift);
    return () => clearTimeout(timer);
  }, [visible, ready, motion.reduce, progress]);

  // Escape is the dismissal a keyboard user expects, and react-native-web gives no
  // key handler of its own.
  useEffect(() => {
    if (!visible || typeof document === 'undefined') return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [visible, onDismiss]);

  const panelStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    // A transformer-style pop about the panel's own leading/top edge, which is
    // the corner nearest the point that was pressed. A scale about the centre
    // reads as a fade with a slight swell, and a scale about 0,0 reads as the
    // panel flying in from the screen's corner — neither is a menu.
    transform: [{ scale: 0.92 + progress.value * 0.08 }],
  }));

  // Nothing is mounted while closed — not a scrim, not a focus target. The check
  // is on `rendered`, NOT on `visible`: keying it on `visible` is the bug above.
  if (!rendered) return null;

  return (
    <Modal transparent visible animationType="none" onRequestClose={onDismiss}>
      <View style={styles.root} testID={testID}>
        {/* A full-bleed dismiss surface. `Pressable` rather than `Pressy`: a scrim is
            not a control, so it takes no press-scale and no haptic. */}
        <Pressable
          accessibilityRole="button"
          onPress={onDismiss}
          style={[styles.scrim, { backgroundColor: t.scrim }]}
          testID={testID ? `${testID}-scrim` : undefined}
        />

        <Animated.View
          accessibilityRole="menu"
          accessibilityLabel={accessibilityLabel}
          style={[
            styles.panel,
            { backgroundColor: t.surface2 },
            // rtl-ok: window coordinates from measureInWindow are PHYSICAL, so a
            // physical offset is the only correct one — a logical start would
            // mirror a rect that already did not.
            position === null
              ? styles.unplaced
              : { top: position.top, left: position.left }, // rtl-ok: physical window coords
            panelStyle,
          ]}
        >
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    // Absolute, not `flex: 1`: the wrapper above this gives `flex` no height to
    // resolve against — the collapse that made the sheet invisible.
    position: 'absolute',
    top: 0,
    bottom: 0,
    insetInlineStart: 0,
    insetInlineEnd: 0,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    insetInlineStart: 0,
    insetInlineEnd: 0,
  },
  panel: {
    position: 'absolute',
    borderRadius: radius.lg,
    // ★ NO BORDER.
    //
    // A hairline around a floating menu reads as a dropdown control rather than
    // as a menu belonging to the row that was held, and it is the only hard edge
    // on a surface that is already lifted by its scrim. The fill alone carries
    // it, which is the same reasoning the map's search pill uses.
    paddingVertical: space[2],
    paddingHorizontal: space[2],
    // ★ THE POP GROWS FROM ITS OWN CORNER.
    //
    // `transformOrigin` is the react-native-web spelling and is honoured there;
    // on native the same effect comes from the scale being small (8%) and short
    // (160ms), which reads as a pop either way. Without pinning the origin the
    // exit appears to slide towards the viewport's corner — the reported "it
    // moves to the top right before disappearing".
    ...({ transformOrigin: 'top left' } as object),
  },
  unplaced: {
    // rtl-ok: an off-canvas parking spot, not a layout position.
    // Hidden until the caller has measured itself. Painting at 0,0 would flash the
    // menu in the corner for a frame.
    opacity: 0,
    top: 0,
    left: 0, // rtl-ok: off-canvas parking, not a layout position
  },
});
