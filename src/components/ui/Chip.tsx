import { useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { IconWeight } from 'phosphor-react-native';

import { Text } from './Text';
import { Pressy } from './Pressy';
import { useLayoutDirection } from '@/src/platform/use-layout-direction';
import { dur, ease } from '@/src/theme/motion';
import { radius, size, space } from '@/src/theme/tokens';
import { useMotion } from '@/src/theme/useMotion';
import { useTheme } from '@/src/theme/useTheme';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A pill-shaped choice. Height 40, `surface2` at rest, inverted text when
 * selected (Style Guide §11.4).
 */
export function Chip({
  label,
  selected = false,
  onPress,
  disabled = false,
  testID,
  style,
}: ChipProps) {
  const { t } = useTheme();

  const background = selected ? t.primary : t.surface2;
  const labelColor = selected ? t.onPrimary : t.text;

  return (
    <Pressy
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      style={style}
    >
      <View style={[styles.chip, { backgroundColor: background }]}>
        <Text variant="body" color={labelColor} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressy>
  );
}

export interface SegmentedOption {
  value: string;
  label: string;
  /**
   * An icon to draw instead of the label.
   *
   * ★ THE LABEL DOES NOT DISAPPEAR WHEN THERE IS AN ICON.
   *
   * An icon-only segment has no accessible name of its own, so `label` stays
   * mandatory and becomes the `accessibilityLabel`. Settings' theme control is
   * three icons wide; the words there would have made the rail a third wider
   * than the value it sets.
   */
  icon?: (props: { size: number; color: string; weight: IconWeight }) => ReactNode;
}

export interface SegmentedControlProps {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  /** Replaces each option's own testID with this prefix. */
  testID?: string;
  /** Per-option IDs, a second naming axis when the prefix reads badly. */
  testIDPrefix?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * A group of mutually exclusive options. The selection pill slides between
 * options using a shared animated indicator (Style Guide §11.4).
 *
 * ★ THE INDICATOR IS PLACED FROM MEASURED STATE, NOT FROM AN ANIMATED TRANSFORM.
 *
 * The selection used to be a ternary background swap on the selected segment, so
 * switching "List" to "Grid" was an instantaneous jump with no visual cause. A
 * single indicator replaced it — and the indicator is now positioned by an
 * explicit physical offset computed from the measured rail, the selected index
 * and the resolved direction.
 *
 * It has been through three placements, and each failure is worth knowing about:
 *
 *  1. a LOGICAL inline inset anchor plus a positive translate — the anchor and the
 *     travel disagreed about which way "start" pointed, so in Persian the pill
 *     walked off the rail;
 *  2. a physical `left` anchor plus a Reanimated transform — the pill's existence
 *     then depended on the UI-runtime mapper, and measured on the device it
 *     rendered at `opacity: 0` while the labels laid out normally, which reads as
 *     "the selection is missing";
 *  3. the current form: a physical offset on an explicitly named side.
 *
 * ★ `left` IS MIRRORED BY REACT NATIVE IN A RIGHT-TO-LEFT PARENT.
 *
 * `indicatorLeftFor` returns a physical left edge, which is what an LTR layout
 * wants. The same number set as `left` under RTL is measured FROM THE RIGHT, so
 * the pill sat over the opposite option from the selected one while the computed
 * offset was correct — observed on the device and confirmed against the rail's
 * pixel spans. The placement therefore converts to the equivalent distance from
 * the right edge and names that side, so the number and the edge always agree.
 *
 * ★ AND THE DIRECTION IS SUBSCRIBED TO, NOT READ ONCE.
 *
 * `isRtlLayout(i18n.language)` returned the right answer but the component never
 * re-ran when the direction changed under it, because `useTranslation` re-renders
 * on a CATALOGUE change and every string here is already the right word. The pill
 * therefore kept RTL geometry on an LTR rail after switching to English, which
 * put it visually over the left option while the layout had the right one where
 * the user pressed — "clicking the right button activates the left one".
 * `useLayoutDirection` subscribes, so the offset is recomputed in the same commit
 * the layout re-flows in.
 */
export function SegmentedControl({
  options,
  value,
  onChange,
  testID,
  testIDPrefix,
  disabled = false,
  style,
}: SegmentedControlProps) {
  const { t } = useTheme();

  const rtl = useLayoutDirection();

  /**
   * ★ BOTH LABELS ARE FULL-STRENGTH TEXT.
   *
   * The unselected label was `textMuted`, which is 5.47:1 on `surface2` in the
   * dark theme and reads as disabled rather than as the other half of a choice —
   * on "Suggested times" the unselected word was the faintest thing in the row.
   * The indicator already carries the selection, so the only colour that has to
   * differ is the one sitting ON the accent.
   */

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  /**
   * ★ THERE IS NO MEASUREMENT HERE ANY MORE, AND THAT IS THE FIX.
   *
   * This component used to keep `trackWidth` in state, fed by `onLayout` on native
   * and a `ResizeObserver`/`getBoundingClientRect` read on web, and derive the
   * pill's pixel size and offset from it.
   *
   * On the emulator that measurement never landed: `uiautomator dump` showed the
   * pill present with the right height and the right anchor but **width 0**, so it
   * painted nothing while the selected label was correctly tinted and the rail's
   * padding looked right. Three earlier fixes tuned the arithmetic downstream of
   * that number, and all three were fixing a value that was never arriving.
   *
   * The pill is now sized and positioned as a FRACTION of the track, which the
   * layout engine resolves itself. A control whose selection is a pure function of
   * (count, index, direction) does not need to ask the platform how wide it is.
   */

  /**
   * The pill's size and position are FRACTIONS of the rail, not pixels.
   *
   * ★ THE PILL DEPENDED ON A JS MEASUREMENT, AND THAT IS WHY IT WAS INVISIBLE.
   *
   * Measured on the emulator from `uiautomator dump` — the real view hierarchy:
   *
   * ```
   * language rail : [53,517]..[1028,633]    W=975  H=116
   * pill node     : [1028,528]..[1028,622]  W=0    H=94
   * ```
   *
   * Right height, right anchor, **zero width**: nothing painted, while the
   * selected label took its dark tint and the rail's padding looked correct. That
   * is the report — "the icons and texts correctly turn dark on selected item but
   * the Knob is not visible at all".
   *
   * Zero width can only come from `segmentWidth`, which came from `trackWidth`,
   * which came from `onLayout`. The arithmetic downstream was verified in
   * isolation and was right; the dependency was the defect. When a JS measurement
   * does not arrive the pill is not merely misplaced — it is invisible, and there
   * is nothing left in the component that can recover.
   *
   * ★ SO THE LAYOUT ENGINE COMPUTES THE GEOMETRY.
   *
   * The rail is a row of `count` equal `flex: 1` segments, so one segment is
   * exactly `1/count` of the inner track — a fact the platform already knows. The
   * pill is therefore `width: (100/count)%` and offset by `(index * 100/count)%`,
   * both relative to the track it sits in. No state, no measurement, nothing that
   * can fail to arrive, and identical on native and web.
   *
   * The rail keeps reporting its own width for anything that wants the pixels;
   * the pill simply no longer depends on them.
   */
  const segmentPercent = 100 / Math.max(1, options.length);

  /**
   * The offset, as a percentage of the track.
   *
   * ★ THE READING DIRECTION IS FOLDED INTO THE INDEX, ONCE.
   *
   * Right-to-left readers count their options from the right, and the pill is
   * positioned from the LEFT. So the RTL offset is the mirror of the LTR one:
   * `count - 1 - index` rather than `index`. This is the same statement
   * `indicatorLeftFor` makes in pixels, expressed where the layout engine can use
   * it — and because a percentage position is not mirrored by anything, both
   * platforms and both directions agree by construction.
   */
  const mirroredIndex = rtl ? options.length - 1 - selectedIndex : selectedIndex;
  const offsetPercent = mirroredIndex * segmentPercent;

  const motion = useMotion();

  /**
   * The in-flight travel, in PERCENT of the track; 0 at rest.
   *
   * ★ THE ANIMATED VALUE HAS TO *BE* THE POSITION.
   *
   * The previous shape kept the rest in style and animated a `translateX` delta on
   * top of it, with two assignments to the same shared value in one block:
   *
   * ```js
   * slide.value = delta;                    // (1)
   * slide.value = withTiming(0, { ... });   // (2)
   * ```
   *
   * (2) replaced (1) before any frame rendered, so nothing ever travelled FROM the
   * old option: the rest had already moved and the transform animated from an
   * overshoot back to zero — a jump followed by a wobble, reported as "it teleports
   * and shakes".
   *
   * The position itself is the animated value now: `left` animates from one
   * percentage to another and there is no delta.
   */
  const animatedOffset = useSharedValue<number>(offsetPercent);

  /** The option the last placement was made for, so a re-measure snaps. */
  const placedIndex = useRef<number | null>(null);

  /** The direction the last placement was made in, so a flip snaps. */
  const placedRtl = useRef<boolean>(rtl);

  useEffect(() => {
    /**
     * ★ THE PILL ANIMATES ONLY WHEN THE USER PICKED AN OPTION.
     *
     * Everything else is placed outright:
     *
     *  - the FIRST placement, so mounting does not slide the pill in from an edge;
     *  - a DIRECTION FLIP, because the rail has been re-laid-out around the
     *    mirrored coordinate and travelling from the old one would wipe across it;
     *  - Reduce Motion, because the transitions are gone (Style Guide 7.7).
     *
     * A resize needs no branch at all now: both the width and the offset are
     * percentages, so the layout engine re-resolves them without this component
     * doing anything.
     *
     * ★ AND THE POSITION IS ALWAYS WRITTEN. Leaving the assignment out of a branch
     * stranded the pill on the previous option permanently.
     */
    const first = placedIndex.current === null;
    const directionChanged = rtl !== placedRtl.current;
    const selectionChanged = selectedIndex !== placedIndex.current;

    if (first || directionChanged || motion.reduce || !selectionChanged) {
      placedIndex.current = selectedIndex;
      placedRtl.current = rtl;
      animatedOffset.value = offsetPercent;
      return;
    }

    placedIndex.current = selectedIndex;
    animatedOffset.value = withTiming(offsetPercent, {
      duration: dur.fast,
      easing: ease.out,
    });
  }, [offsetPercent, selectedIndex, rtl, motion.reduce, animatedOffset]);

  const indicatorStyle = useAnimatedStyle(() => ({
    // ★ A PERCENTAGE `left`, WHICH RESOLVES AGAINST THE TRACK ITSELF.
    //
    // `left: n%` is a fraction of the containing block's width — the inner track —
    // so the layout engine computes the position and nothing depends on a JS
    // measurement. `translateX` could not express this: it takes pixels, which is
    // what forced the measurement in the first place.
    //
    // rtl-ok: physical `left` against a PHYSICAL percentage. The mirror is folded
    // into `offsetPercent` (see `mirroredIndex`), so the number and the edge agree;
    // a logical inset here would be mirrored a second time.
    left: `${animatedOffset.value}%`, // rtl-ok: mirrored in offsetPercent, not by layout
  }));

  return (
    <View
      testID={testID}
      accessibilityRole="radiogroup"
      style={[styles.segmented, { backgroundColor: t.surface2 }, style]}
    >
      {/*
        ★ THE PILL IS A FRACTION OF THE TRACK, SO IT IS ALWAYS THERE.

        It sits under the labels, and `pointerEvents="none"` keeps it out of the
        press path.

        It used to be gated on a measured width (`opacity: segmentWidth > 0 ? 1 :
        0`) and sized in pixels from that number. When the measurement did not
        arrive it rendered at width 0 — invisible, while the labels still drew and
        took their selected tint. The size and offset are percentages now, so there
        is nothing to gate on and nothing to arrive.
      */}
      {(
        <Animated.View
          pointerEvents="none"
          style={[
            styles.indicator,
            {
              // A fraction of the track, so the layout engine sizes it.
              width: `${segmentPercent}%`,
              backgroundColor: t.primary,
            },
            // The animated `left` is the ONLY thing that positions the pill.
            indicatorStyle,
          ]}
        />
      )}

      {options.map((option, index) => {
        const isSelected = index === selectedIndex;
        const tint = isSelected ? t.onPrimary : t.text;
        const segmentTestID = testIDPrefix
          ? `${testIDPrefix}-${option.value}`
          : testID
            ? `${testID}-${option.value}`
            : undefined;

        return (
          <Pressy
            key={option.value}
            onPress={disabled ? undefined : () => onChange(option.value)}
            disabled={disabled}
            testID={segmentTestID}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: isSelected, disabled }}
            style={styles.segment}
          >
            <View style={styles.segmentInner}>
              {option.icon ? (
                option.icon({ size: 18, color: tint, weight: isSelected ? 'fill' : 'bold' })
              ) : (
                <Text variant="body" color={tint} align="center">
                  {option.label}
                </Text>
              )}
            </View>
          </Pressy>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: size.chip,
    borderRadius: radius.pill,
    paddingHorizontal: space[4],
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  segmented: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    padding: space[1],
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  indicator: {
    position: 'absolute',
    // ★ ONE HORIZONTAL ANCHOR: THE ANIMATED `left`, AND NOTHING ELSE.
    //
    // The pill's horizontal position is a PERCENTAGE `left` written by the animated
    // style, so it resolves against the containing block's width — the inner track —
    // and the layout engine computes it. Nothing here may name a horizontal inset:
    // a base `left`/`right`/`insetInlineStart` would be merged with the animated
    // value rather than replaced, and the two would then disagree about which edge
    // the number is measured from.
    //
    // ★ VERTICALLY THE INSET IS `space[1]`, MEASURED FROM THE BORDER EDGE.
    //
    // `AbsoluteLayout.cpp` resolves an absolute child that HAS an inset from
    // `inset + parent BORDER`, and one with NO inset from
    // `parent BORDER + parent PADDING`. The rail has zero border, so `space[1]`
    // here measures exactly to the top of the `size.segment` inner box and the pill
    // comes out the segment's full height — leaving the rail's own padding visible
    // above and below it.
    top: space[1],
    bottom: space[1],
    borderRadius: radius.pill,
  },
  segmentInner: {
    width: '100%',
    height: size.segment,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[2],
  },
});
