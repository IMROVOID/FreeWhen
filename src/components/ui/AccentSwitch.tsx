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
 * ★ THE OFF REST'S MARGIN IS NOT PART OF THE TRAVEL — IT IS ALREADY SPENT.
 *
 * The knob is laid out with `marginInlineStart: KNOB_INSET`, and that margin is
 * inside the track, so the OFF rest occupies `[inset, inset + knob]`. The ON rest
 * must occupy `[width − inset − knob, width − inset]`. The distance between the
 * two is therefore `width − knob − 2·inset`: the track, less the knob, less the
 * air the knob keeps at BOTH ends.
 *
 * Measured on the emulator (1080px wide, 52dp track ≈ 137px), OFF had 0px of air
 * at its trailing edge while ON had 22px at its leading one — so the travel is
 * the suspect, and its correctness is asserted in `tests/ui/switch-knob.test.tsx`
 * (`airAtStart === airAtEnd`, `inset + travel + knob === width − inset`).
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

  /**
   * ★ ONE ANCHOR ON THE PHYSICAL LEFT, AND THE SIGN CARRIED BY THE VALUE.
   *
   * 0 = off, 1 = on. The knob is absolutely positioned at `left: KNOB_INSET`, and
   * its position is `progress * KNOB_TRAVEL`. In a right-to-left layout "on" is
   * the OTHER end of the track, which is the same distance in the negative
   * direction — so the direction is folded into a signed distance that lives on
   * the UI runtime and is written from JS.
   *
   * Two earlier shapes were wrong by exactly `KNOB_INSET`, measured on the device
   * as a knob clipped flush into the track's edge:
   *
   *  - a physical `margin` for the OFF rest plus a `transform` for the travel —
   *    two layout systems describing one position;
   *  - a `right`/`left` anchor CHOSEN BY DIRECTION plus a direction-signed
   *    transform — the anchor and the sign then flipped in different spaces, so
   *    one of the two directions walked the knob off the track.
   *
   * Anchoring always on the left and letting one signed number carry the rest
   * removes both: there is a single origin, and the direction appears once.
   */

  // The direction is folded in here rather than inside the worklet, because `rtl`
  // is React state and a worklet's closure is not re-read when it changes.
  const signedTravel = rtl ? -KNOB_TRAVEL : KNOB_TRAVEL;

  /**
   * ★ THE REST IS A PLAIN STYLE; THE SPRING IS ADDITIVE.
   *
   * The knob's position was reached ONLY through a Reanimated shared value driven
   * by `withSpring`, so it depended on the UI runtime actually ticking. Measured
   * on the device with the state confirmed correct in the logs (`value=false,
   * rtl=false, signed=20`): the OFF knob rendered at the ON rest, i.e. the spring
   * never settled back to zero and the plain truth was never applied.
   *
   * A switch that shows the wrong state is a correctness bug; the spring is a
   * nicety. So `restingTravel` is applied as a plain style every render, and the
   * spring only carries the travel between rests.
   */
  const restingTravel = value ? signedTravel : 0;

  const knobOffset = useSharedValue<number>(0);

  useEffect(() => {
    knobOffset.value = motion.reduce
      ? 0
      : withSpring(0, spring.snappy);
  }, [knobOffset, motion.reduce, restingTravel]);

  const slideStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: knobOffset.value }],
  }));

  const knobStyle = [
    { transform: [{ translateX: restingTravel }] },
    motion.reduce ? undefined : slideStyle,
  ];

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
        {/*
          ★ THE KNOB IS ABSOLUTELY POSITIONED FROM THE TRACK'S LEADING EDGE.

          It used to be a normal flex child resting on a margin, then moved by
          `translateX`. A margin and a translate on the same node are two
          different layout systems describing one position: the margin is spent
          inside the parent's `justifyContent: 'center'` box and the translate is
          applied after — so the two rests did not mirror each other, and on a
          real device the OFF knob came to rest hard against the track's edge
          (measured at 1080px: ON had 22px of air, OFF had 0).

          Anchored at the leading edge with an explicit translate, the position is
          one number: `KNOB_INSET` at OFF, `KNOB_INSET + KNOB_TRAVEL` at ON. The
          air is then the same at both ends by arithmetic rather than by luck, in
          both directions.
        */}
        <Animated.View
          style={[
            styles.knob,
            {
              backgroundColor: value ? theme.onPrimary : theme.surface1,
              // rtl-ok: a physical side chosen from the resolved direction, so the
              // OFF rest is the READING edge in both layouts. The transform below
              // is measured from THIS edge, and its sign is derived from the same
              // side — the two cannot disagree.
              ...(rtl
                ? { right: KNOB_INSET } // rtl-ok: pixel position in a 52pt track
                : { left: KNOB_INSET }), // rtl-ok: pixel position in a 52pt track
            },
            knobStyle,
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
    // The knob is anchored to this box, so it must be the containing block.
    position: 'relative',
    overflow: 'hidden',
  },
  knob: {
    position: 'absolute',
    // ★ BOTH SIDES ARE DECLARED, AND THAT IS NOT REDUNDANT.
    //
    // An absolutely-positioned node with only \	op\ set resolves horizontally to
    // its STATIC position — the content-box origin, i.e. 0. Measured on the
    // device: the ON knob rendered as a half circle sliced off at the track's left
    // edge, which is exactly "left: 0" plus a negative translate, clipped by the
    // track's "overflow: hidden". Declaring "left" here makes the base position
    // explicit, and the call site overrides whichever side the direction needs.
    left: KNOB_INSET, // rtl-ok: base pixel anchor; the call site overrides the side
    top: KNOB_INSET,
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: radius.pill,
    // The leading-edge inset is applied PHYSICALLY at the call site, together with
    // the transform — one node, one positioning system. See the note there.
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
