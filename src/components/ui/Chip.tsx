import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { IconWeight } from 'phosphor-react-native';

import { Text } from './Text';
import { Pressy } from './Pressy';
import { indicatorLeftFor, segmentWidthFor } from './segmented-geometry';
import { isRtlLayout } from '@/src/platform/layout-direction';
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
 * ★ THE INDICATOR SLIDES; THE OPTIONS DO NOT CHANGE COLOUR FIRST.
 *
 * The selection used to be a ternary background swap on the selected segment, so
 * switching "List" to "Grid" was an instantaneous jump with no visual cause — the
 * new pill simply existed. A single indicator, positioned by `translateX` and
 * animated with `withTiming`, makes the change read as one control moving rather
 * than two controls swapping appearance.
 *
 * The indicator is measured from the container rather than each segment: segments
 * are `flex: 1`, so `width / count` IS the segment width, and measuring per
 * segment would need a layout pass per child for the same number.
 *
 * ★ THE SLIDE'S SIGN IS THE LAYOUT DIRECTION, AND IT IS NOT COSMETIC.
 *
 * The pill is anchored at a PHYSICAL `left` and moved by `indicatorOffsetFor`,
 * which negates the travel in a right-to-left layout. Anchoring with a logical
 * inline inset instead made the anchor direction-dependent while the translate
 * stayed positive, so in Persian the pill walked off the rail entirely — the
 * defect `tests/ui/segmented-indicator.test.ts` pins.
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
  const { i18n } = useTranslation();
  const motion = useMotion();

  // `I18nManager.isRTL` is a hardcoded `false` on react-native-web, so the
  // resolved direction is asked instead — see `src/platform/layout-direction.ts`.
  const rtl = isRtlLayout(i18n.language);

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

  // The horizontal padding inside `segmented`, so the indicator covers only the
  // inner track and not the rail's own border area.
  const segmentWidth = segmentWidthFor({ trackWidth, inset: space[1], count: options.length });

  /**
   * The pill's ABSOLUTE left edge, not a delta from a logical start edge.
   *
   * A signed translate from `insetInlineStart` disagreed with itself about which
   * way "start" pointed once the document was `dir="rtl"`, which is how the
   * selection ended up outside the rail. An absolute position has no such
   * ambiguity — see `segmented-geometry.ts`.
   */
  // Seeded at the rail's own inset, which is where the first option's pill sits
  // before the track has measured. The explicit `number` keeps the shared value
  // assignable — `space[1]` alone infers a literal.
  const offset = useSharedValue<number>(space[1]);

  useEffect(() => {
    const target = indicatorLeftFor(selectedIndex, {
      trackWidth,
      inset: space[1],
      count: options.length,
      rtl,
    });

    offset.value = motion.reduce
      ? target
      : withTiming(target, { duration: dur.fast, easing: ease.out });
  }, [trackWidth, segmentWidth, selectedIndex, offset, motion.reduce, rtl, options.length]);

  const indicatorStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  return (
    <View
      testID={testID}
      accessibilityRole="radiogroup"
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      style={[styles.segmented, { backgroundColor: t.surface2 }, style]}
    >
      {/* Rendered first so it sits under the labels, and hidden until the track
          has measured — a zero-width pill at the leading edge would flash on
          mount. `pointerEvents="none"` keeps it out of the press path. */}
      {segmentWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.indicator,
            { width: segmentWidth, backgroundColor: t.primary },
            indicatorStyle,
          ]}
        />
      ) : null}

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
    // ★ ANCHORED AT PHYSICAL ZERO, NOT AT A LOGICAL INSET.
    //
    // The offset now carries the pill's absolute left edge, so the anchor has to
    // be 0 for the two not to add up. `insetInlineStart` resolved against the
    // document direction, which is what put the selection outside the rail in a
    // right-to-left layout.
    left: 0, // rtl-ok: the offset carries the position; this anchor is direction-free
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
