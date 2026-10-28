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

import { useTranslation } from 'react-i18next';

import { Pressy } from './Pressy';
import { isRtlLayout } from '@/src/platform/layout-direction';
import { radius, size, space } from '@/src/theme/tokens';
import { spring } from '@/src/theme/motion';
import { useMotion } from '@/src/theme/useMotion';
import { useTheme } from '@/src/theme/useTheme';

/** The track. 52×32 keeps the 48pt touch target once `Pressy`'s slop is added. */
const TRACK_WIDTH = 52;
const TRACK_HEIGHT = 32;

/**
 * The track's hairline. Named, because the knob's geometry depends on it.
 *
 * ★ THE BORDER IS INSIDE THE WIDTH.
 *
 * Both `react-native` and `react-native-web` put a border inside the box, so the
 * track's usable width is `TRACK_WIDTH - 2 * TRACK_BORDER`. Leaving it out of the
 * knob arithmetic is what made the knob sit flush at one end and inset at the
 * other — the 2px difference showed only when the switch was OFF, which read as
 * "the circle has no padding when it's off".
 */
const TRACK_BORDER = 1;

/** The knob, and the gap it keeps from the track's OUTER edge. */
const KNOB_SIZE = 24;
const KNOB_INSET = (TRACK_HEIGHT - KNOB_SIZE) / 2;

/**
 * How far the knob travels between its two positions.
 *
 * From the leading rest to the trailing rest: the track less both borders, the
 * knob, and the same air gap at each end.
 */
const KNOB_TRAVEL = TRACK_WIDTH - KNOB_SIZE - TRACK_BORDER * 2 - KNOB_INSET * 2;

/**
 * The knob's margin, measured on the track's INNER edge.
 *
 * ★ OFF/ON MUST BE MIRROR IMAGES, PADDING INCLUDED.
 *
 * The knob rests `KNOB_INSET` from the OUTER edge and the track's border takes 1
 * of it, so the margin inside the border is `KNOB_INSET - TRACK_BORDER`. Writing
 * the full inset here — which is what it did — pushed the lead face 1px off the
 * pill and, combined with the border-blind travel, left 3px of air on one side
 * against 4px on the other. Off looked like it had none.
 *
 * The result: 4px of air at both sides, matching the 4px above and below.
 */
const KNOB_MARGIN = KNOB_INSET - TRACK_BORDER;

export interface AccentSwitchProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  /** Required: a switch with no name is unusable with a screen reader. */
  accessibilityLabel: string;
  accessibilityHint?: string;
  /**
   * The id of a visually-hidden node describing this switch, for the web build.
   *
   * `accessibilityHint` has no DOM equivalent and `aria-description` is filtered by
   * react-native-web's prop allowlist, but `aria-describedby` survives — see the
   * note at the call site.
   */
  describedBy?: string;
  disabled?: boolean;
  testID?: string;
}

export function AccentSwitch({
  value,
  onValueChange,
  accessibilityLabel,
  accessibilityHint,
  describedBy,
  disabled = false,
  testID,
}: AccentSwitchProps) {
  const { t: theme } = useTheme();
  const { i18n } = useTranslation();
  const motion = useMotion();

  /**
   * ★ `translateX` IS PHYSICAL; THE KNOB'S STARTING EDGE IS LOGICAL.
   *
   * The knob rests at `marginInlineStart`, which is the RIGHT edge in Persian. A
   * positive `translateX` then pushed it further right — past the track's edge and
   * out of the pill, because `overflow: hidden` clips the track but the knob is
   * inside it and simply runs to the wall. That is the reported "the circle moved
   * too much to the sides and is overflowing".
   *
   * Flipping the sign under RTL makes the travel land on the opposite edge, which
   * is where "off" actually is in a right-to-left interface.
   */
  const travel = isRtlLayout(i18n.language) ? -KNOB_TRAVEL : KNOB_TRAVEL;

  // 0 = off, 1 = on. One value drives the knob and the track's colour progress,
  // so the two cannot disagree mid-flight.
  const progress = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    progress.value = withSpring(value ? 1 : 0, spring.snappy);
  }, [progress, value]);

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * travel }],
  }));

  // Under Reduce Motion the knob is placed rather than animated (§7.7).
  const restingKnob = motion.reduce
    ? { transform: [{ translateX: value ? travel : 0 }] }
    : undefined;

  /**
   * ★ THE HINT NEEDS A SECOND CHANNEL ON WEB, AND `aria-description` IS NOT IT.
   *
   * `accessibilityHint` is a React Native property with no DOM equivalent, so
   * react-native-web drops it and every switch hint was silent in the browser.
   * `aria-description` looks like the answer but is filtered out by the same prop
   * allowlist. `aria-describedby` is forwarded, so callers pass the id of a
   * visually-hidden description node and the sentence reaches the DOM.
   */
  const describedByProp = describedBy ? { 'aria-describedby': describedBy } : {};

  return (
    <Pressy
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      {...(describedByProp as Record<string, unknown>)}
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
    borderWidth: TRACK_BORDER,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  knob: {
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: radius.pill,
    // Logical, so the knob starts at the leading edge in both directions. It is
    // measured from the border's inner edge, which is why `KNOB_INSET` also
    // subtracts the border from the travel: both rest positions sit one inset
    // from the track's OUTER edge.
    marginInlineStart: KNOB_MARGIN,
  },
});

/** Exported for the style guide's fixed dimensions, and for tests. */
export const ACCENT_SWITCH_METRICS = {
  width: TRACK_WIDTH,
  height: TRACK_HEIGHT,
  border: TRACK_BORDER,
  knob: KNOB_SIZE,
  travel: KNOB_TRAVEL,
  touchHeight: TRACK_HEIGHT + space[2] * 2,
} as const;

/** The switch's height, so a caller can reserve the space it takes. */
export const ACCENT_SWITCH_HEIGHT = size.chip;
