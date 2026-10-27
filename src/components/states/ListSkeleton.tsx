/**
 * The list skeleton (PRD-11 §6, Plan 11 Task 1).
 *
 * ★ A SKELETON, NOT A SPINNER, FOR LISTS.
 *
 * A full-screen spinner on a list conveys nothing about what is coming. The
 * skeleton says "rows are arriving, roughly this tall", which is why §6 bans
 * the list spinner outright. A spinner remains correct for a discrete action,
 * because there the user asked for the wait.
 *
 * ★ A STATIC SKELETON IS INDISTINGUISHABLE FROM A BROKEN PAGE.
 *
 * This used to paint flat `surface3` bars at one opacity. On a slow connection
 * that looks like content that failed to render: the page appears finished and
 * empty rather than busy, and the user has no evidence anything is happening.
 * Every bar now breathes between two opacities on ONE shared value, so the
 * whole skeleton pulses as a single surface instead of a dozen unrelated
 * twitches — and the loop is a single animation to drive.
 *
 * ★ IT IS ANNOUNCED AS ONE BUSY REGION.
 *
 * A screen reader walking eight decorative bars is noise. The container takes
 * the label and the bars are hidden from the tree, so the announcement is one
 * sentence rather than twenty empty nodes.
 *
 * ★ REDUCE MOTION STOPS AT THE MIDPOINT.
 *
 * Style Guide §7.7: an infinite pulse is the single most likely thing to
 * trouble a motion-sensitive reader, so under Reduce Motion the bars are
 * rendered at a fixed mid opacity — still visibly placeholders, not animating.
 */

import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { dur } from '@/src/theme/motion';
import { radius, space } from '@/src/theme/tokens';
import { useMotion } from '@/src/theme/useMotion';
import { useTheme } from '@/src/theme/useTheme';

export interface ListSkeletonProps {
  /** How many placeholder rows to draw. */
  rows?: number;
  /** The announced sentence; defaults to the catalogue's generic one. */
  label?: string;
  testID?: string;
}

/** The two ends of the pulse. A dimmer bar would read as a divider. */
const PULSE_MIN = 0.55;
const PULSE_MAX = 1;

/** One full breath. Slow enough to read as waiting, not as a flicker. */
const PULSE_DURATION = dur.slow * 2;

export function ListSkeleton({ rows = 3, label, testID }: ListSkeletonProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();
  const motion = useMotion();

  // ★ ONE VALUE FOR THE WHOLE SKELETON.
  //
  // A `useSharedValue` per bar would drive up to twelve animations to convey a
  // single fact, and they would drift out of phase within a second — twelve
  // unrelated pulses is what makes a skeleton look like a glitch.
  const pulse = useSharedValue(PULSE_MAX);

  useEffect(() => {
    if (motion.reduce) {
      pulse.value = (PULSE_MIN + PULSE_MAX) / 2;
      return;
    }

    pulse.value = withRepeat(
      withTiming(PULSE_MIN, { duration: PULSE_DURATION, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [motion.reduce, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  const staticStyle = motion.reduce
    ? { opacity: (PULSE_MIN + PULSE_MAX) / 2 }
    : undefined;

  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? t('states.loading')}
      accessibilityLiveRegion="polite"
      style={styles.container}
    >
      {Array.from({ length: rows }, (_, index) => (
        <Animated.View
          key={index}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          style={[
            styles.row,
            { backgroundColor: theme.surface2 },
            staticStyle,
            motion.reduce ? undefined : pulseStyle,
          ]}
        >
          <View style={[styles.title, { backgroundColor: theme.surface3 }]} />
          <View style={[styles.line, { backgroundColor: theme.surface3 }]} />
          <View style={[styles.lineShort, { backgroundColor: theme.surface3 }]} />
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space[3],
  },
  row: {
    borderRadius: radius.md,
    padding: space[4],
    gap: space[2],
  },
  title: {
    height: space[4],
    width: '55%',
    borderRadius: radius.xs,
  },
  line: {
    height: space[3],
    width: '85%',
    borderRadius: radius.xs,
  },
  lineShort: {
    height: space[3],
    width: '40%',
    borderRadius: radius.xs,
  },
});
