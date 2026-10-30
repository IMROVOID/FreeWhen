import { useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { IconWeight } from 'phosphor-react-native';

import { Text } from './Text';
import { Pressy } from './Pressy';
import { indicatorLeftFor, segmentWidthFor } from './segmented-geometry';
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

  const [trackWidth, setTrackWidth] = useState(0);

  /**
   * ★ THE RAIL ALSO MEASURES ITSELF FROM THE NODE.
   *
   * `onLayout` is the sanctioned signal, but it is delivered once per mount and
   * the app now REMOUNTS its whole tree when the language's direction changes
   * (`app/_layout.tsx`). On that remount the layout callback can land before this
   * component is ready to record it, leaving `trackWidth` at 0 — and the pill is
   * only rendered when the track has measured, so the selection silently
   * disappeared in BOTH languages. Measured: 10,259 pill pixels before the
   * remount change, 0 after.
   *
   * A ref read on mount and on every resize makes the measurement independent of
   * when the callback arrives. `onLayout` stays for native.
   */
  const railRef = useRef<ComponentRef<typeof View> | null>(null);

  /** Records a width, ignoring a non-positive or unchanged one. */
  const recordWidth = useCallback((width: number) => {
    if (!Number.isFinite(width) || width <= 0) return;
    setTrackWidth((prev) => (prev === width ? prev : width));
  }, []);

  /**
   * The WEB measurement: reads the element's box directly.
   *
   * ★ IT MUST NOT BE THE `onLayout` HANDLER.
   *
   * This used to be wired to `onLayout` as well, and it returns early whenever the
   * node has no `getBoundingClientRect` — which is ALWAYS true on native, where a
   * view is a native peer rather than a DOM element. So the native layout event
   * was received and thrown away, `trackWidth` stayed 0, and the rail rendered its
   * track and both labels with NO pill — in both languages, on every device.
   *
   * `onLayout` now reads its own event (below); this path is web-only.
   */
  const measureFromNode = useCallback(() => {
    const node = railRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.getBoundingClientRect !== 'function') return;

    recordWidth(node.getBoundingClientRect().width);
  }, [recordWidth]);

  useEffect(() => {
    measureFromNode();

    const node = railRef.current as unknown as HTMLElement | null;
    if (!node || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => measureFromNode());
    observer.observe(node);
    return () => observer.disconnect();
  }, [measureFromNode]);

  // The horizontal padding inside `segmented`, so the indicator covers only the
  // inner track and not the rail's own border area.
  const segmentWidth = segmentWidthFor({ trackWidth, inset: space[1], count: options.length });

  /**
   * ★ THE PILL IS ALWAYS PLACED FROM ITS PHYSICAL LEFT EDGE.
   *
   * Three shapes were tried and the first two shipped a wrong pill:
   *
   *  1. a logical `insetInlineStart` anchor plus a positive translate — the anchor
   *     and the travel disagreed about which way "start" pointed, so in Persian the
   *     pill walked off the rail;
   *  2. a base `left: 0` plus a `{ right }` override under RTL — React Native
   *     MERGES those, the node carried BOTH keys, and CSS resolves that pair by
   *     giving `left` precedence, so the mirror was silently discarded. Measured
   *     from the rendered markup as `right: -4px` with no `left` override, and
   *     visible as "Auto is selected but the knob is on Light";
   *  3. the current one — a single physical `left`, in both directions.
   *
   * `indicatorLeftFor` already answers "left edge" for an RTL rail (it knows the
   * first segment sits at the right end), so nothing here needs to name a side or
   * carry a direction sign. `indicatorPlacementFor` remains in the geometry module
   * for callers that need the pair, but this component does not: one side that is
   * always right cannot disagree with itself.
   */

  const motion = useMotion();

  /**
   * The pill's left edge, IN THE SIDE THE PLACEMENT NAMES, as one animated value.
   *
   * ★ THE ANIMATED VALUE HAS TO *BE* THE POSITION.
   *
   * The previous shape kept `left` static (the correct rest, applied in style) and
   * animated a `translateX` delta on top of it:
   *
   * ```js
   * slide.value = delta;                    // ①
   * slide.value = withTiming(0, { … });     // ②
   * ```
   *
   * Two assignments to one shared value in the same synchronous block. ② replaced
   * ① before any frame could render, so nothing ever travelled FROM the old
   * option: `left` had already moved to the new rest and the transform animated
   * from an overshoot of `delta` back to `0`. Visibly that is a jump to the new
   * option followed by a wobble toward the old one — "it just teleports and shakes
   * when changing the value".
   *
   * A translation cannot animate a position that is also being rewritten in style
   * on the same commit. So the position itself is the animated value, and the
   * transform is gone entirely.
   */
  const restLeft = indicatorLeftFor(selectedIndex, {
    trackWidth,
    inset: space[1],
    count: options.length,
    rtl,
  });

  /**
   * The animated value carries the PHYSICAL LEFT EDGE, in both directions.
   *
   * ★ ONE COORDINATE SPACE, AND IT IS ALWAYS `left`.
   *
   * `indicatorLeftFor` already answers "where is the pill's left edge" for an RTL
   * rail too — a right-to-left rail puts its first segment at its right end, and
   * the function returns the corresponding left coordinate. So the animated value,
   * the style key and the interpolation are all in the same space and no direction
   * sign appears anywhere.
   *
   * Writing the RTL distance-from-the-right into `left` (an earlier attempt in
   * this very change) would have put the Persian pill at the FAR LEFT for option 0
   * — re-introducing the reported "Language knob sits on English, not Persian".
   */
  const animatedLeft = useSharedValue<number>(restLeft);

  /**
   * The option the last placement was made for.
   *
   * ★ THE PILL SLIDES ON A SELECTION, NOT ON A RE-MEASURE.
   *
   * `restLeft` moves for two reasons: the selected option changed (a gesture — the
   * pill should travel), or the rail was re-measured by a rotation, a font-scale
   * change or a split-screen reflow (not a gesture — the pill should be re-placed).
   * Comparing the RESULTING PIXEL cannot tell them apart, so this compares the
   * option instead.
   *
   * `null` until the first placement, so the first measurement snaps.
   */
  const placedIndex = useRef<number | null>(null);

  /** The direction the last placement was made in, so a flip snaps. */
  const placedRtl = useRef<boolean>(rtl);

  /**
   * The rail width the last placement was made against.
   *
   * ★ A RE-MEASURE IS NOT A GESTURE, AND THE PIXEL CANNOT TELL THEM APART.
   *
   * `restLeft` changes for two reasons: the selected option changed (the pill
   * should travel to it), or the rail was re-measured by a rotation, a font-scale
   * change or a split-screen reflow (the same option now sits at a different pixel,
   * and the pill should be re-PLACED). Comparing the resulting pixel conflates
   * them — and once a selection has been placed, a later resize looks identical to
   * another selection change.
   *
   * So the slide is decided by the WIDTH, which only a re-measure moves.
   */
  const placedWidth = useRef<number | null>(null);

  const measured = trackWidth > 0;

  useEffect(() => {
    if (!measured) return;

    /**
     * ★ THE PILL ANIMATES ONLY WHEN THE USER PICKED AN OPTION.
     *
     * Everything else is placed outright:
     *
     *  - the FIRST placement, because the rail's first measurement is a
     *    correction and animating it slides the pill in from the leading edge on
     *    every mount;
     *  - a RESIZE, because the option did not change and the rail was re-measured;
     *  - a DIRECTION FLIP, because the rail was re-laid-out around the mirrored
     *    coordinate and travelling from the old one would wipe across it;
     *  - Reduce Motion, because the transitions are gone (Style Guide §7.7).
     *
     * ★ AND THE POSITION IS ALWAYS WRITTEN.
     *
     * Leaving the assignment out of a branch stranded the pill: `animatedLeft`
     * kept the previous option and the "nothing to do" return below then pinned it
     * there permanently. Assigning in every branch is what keeps a sweep of these
     * cases correct.
     */
    const first = placedWidth.current === null;
    const resized = placedWidth.current !== trackWidth;
    const directionChanged = rtl !== placedRtl.current;
    const selectionChanged = selectedIndex !== placedIndex.current;

    if (first || resized || directionChanged || motion.reduce || !selectionChanged) {
      placedWidth.current = trackWidth;
      placedIndex.current = selectedIndex;
      placedRtl.current = rtl;
      animatedLeft.value = restLeft;
      return;
    }

    placedIndex.current = selectedIndex;
    animatedLeft.value = withTiming(restLeft, {
      duration: dur.fast,
      easing: ease.out,
    });
  }, [measured, restLeft, selectedIndex, rtl, motion.reduce, trackWidth, animatedLeft]);

  const indicatorStyle = useAnimatedStyle(() => ({
    // rtl-ok: the physical LEFT edge, in both directions. `indicatorLeftFor`
    // already mirrored the coordinate for an RTL rail, so this side never flips.
    left: animatedLeft.value, // rtl-ok: physical left edge, resolved by the geometry
    right: 'auto', // rtl-ok: the unused side is parked; left carries the position
  }));

  return (
    <View
      ref={railRef}
      testID={testID}
      accessibilityRole="radiogroup"
      onLayout={(event) => recordWidth(event.nativeEvent.layout.width)}
      style={[styles.segmented, { backgroundColor: t.surface2 }, style]}
    >
      {/*
        ★ THE PILL RENDERS FIRST AND IS NEVER GATED ON THE MEASUREMENT.

        It sits under the labels, and `pointerEvents="none"` keeps it out of the
        press path.

        It used to render only when the measured segment width was above zero, so
        a track that had not measured produced NO selection at all rather than a
        misplaced one — while the labels still rendered, which is why it looked
        like the pill had simply disappeared. A zero-width pill is invisible on
        its own, so the gate only turned a transient measurement into a permanent
        absence.
      */}
      {(
        <Animated.View
          pointerEvents="none"
          style={[
            styles.indicator,
            {
              width: segmentWidth,
              backgroundColor: t.primary,
              // Hidden until measured, but RENDERED — see the note above. `opacity`
              // avoids the sliver without making the pill's existence depend on
              // the measurement arriving.
              opacity: segmentWidth > 0 ? 1 : 0,
            },
            // The animated value carries the position on the side the direction
            // resolved to, so this replaces — not supplements — the placement
            // numbers. `indicatorPlacement` is still what decides WHICH side and
            // what the resting numbers are; the style below is the only thing
            // that ever writes them to the node, which is what makes a slide
            // possible at all.
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
    // ★ ZERO INSETS, BECAUSE THE CONTAINING BLOCK IS ALREADY THE PADDING BOX.
    //
    // The rail is `position: relative` with `padding: space[1]`, so an
    // absolutely-positioned child is laid out against the rail's PADDING box —
    // which is already inset by `space[1]` on every side. `top: space[1]` and
    // `bottom: space[1]` here inset it a SECOND time: measured on the theme rail
    // (padding 4, segment 36) the pill was 28pt tall inside a 36pt segment and sat
    // 8pt from the rail's top edge. That is the reported "the knob is offset / has
    // too much padding, needs to be closer to the edge".
    //
    // Zero puts the pill exactly on the track the labels are laid out in, which is
    // the whole point of the control.
    top: 0,
    bottom: 0,
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
