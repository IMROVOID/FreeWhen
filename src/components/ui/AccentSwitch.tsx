/**
 * The toggle switch, themed and mirrored.
 *
 * ★ THE PLATFORM SWITCH WAS THE ONLY UNTHEMED CONTROL LEFT.
 *
 * `react-native`'s `<Switch>` is the OPERATING SYSTEM's switch. On Android it
 * is a Material pill in Google's teal; on iOS it is an Apple switch; on web,
 * `react-native-web` renders a bare checkbox. None of the three reads a theme
 * token, so the control the user touches most in Settings was the one control
 * on the screen that did not look like the app — and on web it did not look
 * like a switch at all.
 *
 * ★ THE ACCESSIBLE CONTROL IS THE PRESSABLE, NOT A WRAPPER AROUND IT.
 *
 * The drawn pill is decoration. `role="switch"` and `aria-checked` belong on
 * the element a screen reader focuses and activates, so they are declared on the
 * `Pressy` and not on the track or the knob. `Pressy` maps
 * `accessibilityState.selected` to `aria-checked` for a switch role, which is
 * the only path that survives react-native-web's prop filtering.
 *
 * ★ THE KNOB MOVES FROM THE LEADING EDGE, NOT FROM `left`.
 *
 * A physical `left`/`translateX` pair would slide the knob the same way in both
 * directions, so in a Persian layout the "on" position would sit on the wrong
 * side of the track. The knob is anchored with `insetInlineStart` and travels on
 * the X axis of the row, which react-native-web resolves from the document
 * direction.
 */

import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { Pressy } from './Pressy';
import { radius, size, space } from '@/src/theme/tokens';
import { spring } from '@/src/theme/motion';
import { useMotion } from '@/src/theme/useMotion';
import { useTheme } from '@/src/theme/useTheme';

/** The track. 52×32 keeps the 48pt touch target once `Pressy`'s slop is added. */
const TRACK_WIDTH = 52;
const TRACK_HEIGHT = 32;

/** The knob, and the gap it keeps from the track's edge. */
const KNOB_SIZE = 24;
const KNOB_INSET = (TRACK_HEIGHT - KNOB_SIZE) / 2;

/** How far the knob travels between its two positions. */
const KNOB_TRAVEL = TRACK_WIDTH - KNOB_SIZE - KNOB_INSET * 2;

export interface AccentSwitchProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  /** Required: a switch with no name is unusable with a screen reader. */
  accessibilityLabel: string;
  accessibilityHint?: string;
  disabled?: boolean;
  testID?: string;
}

export function AccentSwitch({
  value,
  onValueChange,
  accessibilityLabel,
  accessibilityHint,
  disabled = false,
  testID,
}: AccentSwitchProps) {
  const { t: theme } = useTheme();
  const motion = useMotion();

  // 0 = off, 1 = on. One value drives the knob and the track's colour progress,
  // so the two cannot disagree mid-flight.
  const progress = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    progress.value = withSpring(value ? 1 : 0, spring.snappy);
  }, [progress, value]);

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * KNOB_TRAVEL }],
  }));

  // Under Reduce Motion the knob is placed rather than animated (§7.7).
  const restingKnob = motion.reduce
    ? { transform: [{ translateX: value ? KNOB_TRAVEL : 0 }] }
    : undefined;

  return (
    <Pressy
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected: value, disabled }}
      testID={testID}
      style={styles.hit}
    >
      <View
        style={[
          styles.track,
          {
            backgroundColor: value ? theme.primary : theme.surface3,
            borderColor: value ? theme.primary : theme.line,
            opacity: disabled ? 0.5 : 1,
          },
        ]}
      >
        <Animated.View
          style={[
            styles.knob,
            {
              backgroundColor: value ? theme.onPrimary : theme.surface1,
            },
            restingKnob,
            motion.reduce ? undefined : knobStyle,
          ]}
        />
      </View>
    </Pressy>
  );
}

const styles = StyleSheet.create({
  hit: {
    // The track is shorter than a touch target; the padding supplies the rest.
    paddingVertical: space[2],
    paddingHorizontal: space[1],
  },
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  knob: {
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: radius.pill,
    // Logical, so the knob starts at the leading edge in both directions.
    marginInlineStart: KNOB_INSET,
  },
});

/** Exported for the style guide's fixed dimensions, and for tests. */
export const ACCENT_SWITCH_METRICS = {
  width: TRACK_WIDTH,
  height: TRACK_HEIGHT,
  knob: KNOB_SIZE,
  travel: KNOB_TRAVEL,
  touchHeight: TRACK_HEIGHT + space[2] * 2,
} as const;

/** The switch's height, so a caller can reserve the space it takes. */
export const ACCENT_SWITCH_HEIGHT = size.chip;
