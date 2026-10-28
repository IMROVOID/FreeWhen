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
 * ★ IT MUST KEEP ITSELF MOUNTED TO LEAVE.
 *
 * `rendered` is set on open and cleared when the exit animation finishes, so the
 * closing fade has something to fade.
 */

import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { dur, ease } from '@/src/theme/motion';
import { border, radius, space } from '@/src/theme/tokens';
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
  const progress = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      progress.value = motion.reduce ? 1 : withTiming(1, { duration: dur.fast, easing: ease.out });
      return;
    }

    if (!motion.reduce) {
      progress.value = withTiming(0, { duration: dur.base, easing: ease.out });
    } else {
      progress.value = 0;
    }

    // The unmount waits out the exit, so the fade completes instead of being cut off
    // one frame after it starts.
    const timer = setTimeout(() => setRendered(false), motion.reduce ? 0 : dur.base);
    return () => clearTimeout(timer);
  }, [visible, progress, motion.reduce]);

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
    transform: [{ scale: 0.96 + progress.value * 0.04 }],
  }));

  // Nothing is mounted while closed — not a scrim, not a focus target.
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
            { backgroundColor: t.surface2, borderColor: t.line },
            // rtl-ok: window coordinates from measureInWindow are PHYSICAL, so a physical
            // offset is the only correct one — a logical start would mirror a rect that
            // already did not.
            position === null
              ? styles.unplaced
              : // rtl-ok: window coords from measureInWindow are physical, not logical
                { top: position.top, left: position.left },
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
    borderWidth: border.hairline,
    paddingVertical: space[2],
    paddingHorizontal: space[2],
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

