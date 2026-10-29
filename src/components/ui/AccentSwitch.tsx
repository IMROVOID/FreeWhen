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
 * ★ NO TRACK BORDER, AND THAT IS WHAT MAKES THE TWO RESTS SYMMETRIC.
 *
 * The track carried a hairline so an OFF switch had an edge. It made the
 * geometry direction-dependent in a way that was invisible while reviewing and
 * obvious in the hand: the border is inside the box, so the knob's usable travel
 * was `width − knob − 2·border`, and subtracting it in one place and not the
 * other left three pixels of air at one end and four at the other — "the circle
 * has no spacing with the switch edge when it is off". The fill (`surface3` when
 * off, `primary` when on) is enough separation on its own, so the border is gone
 * and the arithmetic is simply `(width − knob) / 2` at each rest.
 *
 * ★ AND THE INSET IS APPLIED PHYSICALLY, OR IT IS NOT APPLIED AT ALL.
 *
 * See `startInset` at the call site: `marginInlineStart` is dropped by `Pressy`'s
 * layout whitelist, so the OFF knob lost its air entirely. That was the reported
 * defect, and it is why the evidence for it is an assertion about the STYLE KEY
 * rather than about a rendered pixel.
 *
 * ★ THE DIRECTION IS SUBSCRIBED TO, NOT READ ONCE.
 *
 * The knob is anchored at the leading margin and moved by a PHYSICAL
 * `translateX`, so the sign has to flip in a right-to-left layout. Reading the
 * direction during render left the knob on stale geometry after a live language
 * switch: it started at the RIGHT margin and translated NEGATIVE, i.e. straight
 * out of the track — "the circle overflows the switch, almost out of it". The
 * shared value below is rebuilt whenever the direction changes, so the two
 * cannot disagree.
 */

import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { Pressy } from './Pressy';
import { useLayoutDirection } from '@/src/platform/use-layout-direction';
import { radius, size, space } from '@/src/theme/tokens';
import { spring } from '@/src/theme/motion';
import { useMotion } from '@/src/theme/useMotion';
import { useTheme } from '@/src/theme/useTheme';

/** The track. 52×32 keeps the 48pt touch target once `Pressy`'s slop is added. */
const TRACK_WIDTH = 52;
const TRACK_HEIGHT = 32;

/** The knob, and the air it keeps at EVERY rest — above, below and at both ends. */
const KNOB_SIZE = 24;
const KNOB_INSET = (TRACK_HEIGHT - KNOB_SIZE) / 2;

/**
 * How far the knob travels between its two rests.
 *
 * The track has no border, so the whole width is usable: from `KNOB_INSET` off
 * the leading edge to `KNOB_INSET` off the trailing one.
 */
const KNOB_TRAVEL = TRACK_WIDTH - KNOB_SIZE - KNOB_INSET * 2;

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
  const motion = useMotion();
  const rtl = useLayoutDirection();

  // Positive travel is towards the physical right; in a right-to-left layout
  // "on" is the other end, so the sign flips.
  const travel = rtl ? -KNOB_TRAVEL : KNOB_TRAVEL;

  /**
   * ★ THE OFF REST IS A PHYSICAL MARGIN, BECAUSE A LOGICAL ONE IS DROPPED.
   *
   * `marginInlineStart` is the correct spelling for this inset — the OFF rest is
   * the leading edge in both directions. But `Pressy` sorts a style into a layout
   * object and a visual one with a whitelist of layout keys, and that whitelist is
   * physical: `marginLeft`/`marginRight` are on it and `marginInlineStart` is not.
   * The inset therefore travelled to the INNER pressable, whose width is the whole
   * track, so it did nothing — and the knob sat hard against the track's edge with
   * its declared air missing: "the circle is too much to the right with no spacing
   * between it and the switch edge".
   *
   * It looked like a web-only, OFF-only bug: the ON rest is reached by the travel,
   * which lands the knob inside the track regardless, and the asymmetry read as
   * "the OFF state is wrong". Native lost the inset the same way — the whitelist is
   * platform-independent — it is simply less obvious there.
   *
   * One physical margin, chosen from the resolved direction, so nothing is lost
   * between the two nodes.
   */
  // The side is chosen EXPLICITLY from the resolved direction, so there is nothing
  // for a logical property to mirror — and `marginInlineStart` was the key `Pressy`
  // dropped, which is the defect this fixes.
  // rtl-ok: physical on purpose; the direction is resolved above
  const startInset = rtl ? { marginRight: KNOB_INSET } : { marginLeft: KNOB_INSET };

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
            opacity: disabled ? 0.5 : 1,
          },
        ]}
      >
        <Animated.View
          style={[
            styles.knob,
            startInset,
            { backgroundColor: value ? theme.onPrimary : theme.surface1 },
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
    justifyContent: 'center',
    overflow: 'hidden',
  },
  knob: {
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: radius.pill,
    // The leading-edge inset is applied PHYSICALLY at the call site (see
    // `startInset`) — a logical key here was discarded by `Pressy`'s layout
    // whitelist, which is what put the OFF knob against the track's edge.
  },
});

/** Exported for the style guide's fixed dimensions, and for tests. */
export const ACCENT_SWITCH_METRICS = {
  width: TRACK_WIDTH,
  height: TRACK_HEIGHT,
  knob: KNOB_SIZE,
  inset: KNOB_INSET,
  travel: KNOB_TRAVEL,
  touchHeight: TRACK_HEIGHT + space[2] * 2,
} as const;

/** The switch's height, so a caller can reserve the space it takes. */
export const ACCENT_SWITCH_HEIGHT = size.chip;
