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
import { indicatorLeftFor, indicatorPlacementFor, segmentWidthFor } from './segmented-geometry';
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
   * The pill's placement: ONE physical side, and the distance from it.
   *
   * ★ NEVER BOTH SIDES, AND NEVER A SIDE CHOSEN INDEPENDENTLY OF THE VALUE.
   *
   * The pill has to rest at the edge of the segment that is selected, and a
   * right-to-left rail puts its first segment at its RIGHT end. Two shapes were
   * tried before this one and both shipped a wrong pill:
   *
   *  1. a logical `insetInlineStart` anchor plus a positive translate — the anchor
   *     and the travel disagreed about which way "start" pointed, so in Persian the
   *     pill walked off the rail;
   *  2. a physical `left: 0` in the base style plus a `{ right }` override under
   *     RTL — React Native merges those two objects, the node carried BOTH keys,
   *     and CSS gives `left` precedence. The mirror was silently discarded and the
   *     pill was laid out from the physical left on a right-to-left rail, which put
   *     it over the OPPOSITE option: "Auto is selected but the knob is on Light".
   *     Measured from the rendered markup as `right: -4px` with no `left` override.
   *
   * `indicatorPlacementFor` returns both keys every time, one of them `auto`, so
   * the pair cannot disagree and nothing downstream has to know which way the
   * layout reads beyond the number it is given.
   */
  const indicatorPlacement = indicatorPlacementFor(selectedIndex, {
    trackWidth,
    inset: space[1],
    count: options.length,
    rtl,
  });

  const motion = useMotion();

  /** The in-flight travel, in pixels; 0 at rest. */
  const slide = useSharedValue<number>(0);

  /**
   * Where the pill rested before this render, as a PHYSICAL left edge.
   *
   * ★ ONE COORDINATE SPACE FOR THE REST AND THE TRAVEL.
   *
   * The slide is a `translateX` — a physical delta — so the difference it
   * animates has to be a difference of physical positions. `indicatorLeftFor`
   * answers exactly that in both directions (it already returns the LEFT edge for
   * an RTL rail), so the delta needs no direction sign of its own. Multiplying it
   * by a sign as well — which this used to do — double-counted the mirror: the
   * rest landed correctly and the pill then started one whole segment-width from
   * the wrong side and slid back into place, which on a slow device reads as the
   * knob jumping from the neighbouring option.
   */
  const restingLeft = indicatorLeftFor(selectedIndex, {
    trackWidth,
    inset: space[1],
    count: options.length,
    rtl,
  });

  const previousRest = useRef<number>(restingLeft);

  /**
   * ★ THE SLIDE IS A TRANSFORM ON TOP OF A CORRECT REST, NOT THE POSITION ITSELF.
   *
   * The pill used to be positioned ONLY by a Reanimated `translateX`, so its
   * geometry depended on the UI-runtime mapper having run — and on the device it
   * never appeared, in either language, while the labels laid out normally.
   *
   * The plain placement above is the truth: it is computed from the measured rail
   * and the resolved direction, and it is applied whether or not any animation
   * runs. This transform then animates the travel from the PREVIOUS rest to the
   * new one, so a working pill never depends on it. When motion is reduced the
   * slide collapses to nothing and the plain placement alone is correct.
   *
   * The travelled distance is a delta measured along the physical x axis between
   * two physical rests, so it carries no direction sign of its own.
   */
  const slideStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: slide.value }],
  }));

  const animateTo = useCallback(
    (target: number) => {
      if (motion.reduce) {
        slide.value = 0;
        previousRest.current = target;
        return;
      }

      const delta = target - previousRest.current;
      previousRest.current = target;
      slide.value = delta;
      slide.value = withTiming(0, { duration: dur.fast, easing: ease.out });
    },
    [motion.reduce, slide],
  );

  useEffect(() => {
    animateTo(restingLeft);
  }, [animateTo, restingLeft]);

  const indicatorStyle = motion.reduce ? undefined : slideStyle;

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
            indicatorPlacement,
            // The slide, when motion is allowed. The placement above is already
            // the correct rest, so this can only ever add travel — never position.
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
    top: space[1],
    bottom: space[1],
    // ★ NO HORIZONTAL ANCHOR HERE, AND THAT IS THE FIX FOR THE RTL PILL.
    //
    // This used to declare `left: 0` "so the offset has an anchor". A `left`
    // here is MERGED with the call site's override rather than replaced, and a
    // node carrying both `left: 0` and `right: n` resolves by giving `left`
    // precedence — so the right-to-left mirror was silently discarded and the
    // pill was laid out from the wrong edge. `indicatorPlacementFor` now emits
    // BOTH keys (`left`/`right`, one of them `auto`) together, so the anchor and
    // the offset are always one decision.
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
