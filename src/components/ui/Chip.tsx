import { type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { IconWeight } from 'phosphor-react-native';

import { Text } from './Text';
import { Pressy } from './Pressy';
import { radius, size, space } from '@/src/theme/tokens';
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
 * A group of mutually exclusive options (Style Guide 11.4).
 *
 * ★ THE SELECTED CELL PAINTS ITS OWN FILL.
 *
 * Five attempts placed a separate "pill" as an absolutely-positioned overlay on
 * top of a flex row, and every one shipped something wrong on the device:
 *
 *  1. a logical `insetInlineStart` plus a positive translate — walked off the rail
 *     in Persian;
 *  2. a base `left: 0` plus a `{ right }` override — React Native MERGES those, so
 *     the node carried both keys and the mirror was silently discarded;
 *  3. a pixel `left` derived from `onLayout` — the measurement never arrived, so
 *     the pill rendered at width 0 and painted nothing at all;
 *  4. a pixel `translateX`, same dependency, same invisibility;
 *  5. a percentage `left` — the width came out right (318px, one segment) but the
 *     position sat 11px to the LEFT of its option, because a `left` percentage
 *     resolves against the rail's BORDER box while the labels live in its PADDING
 *     box. Measured on the device: option `[382,834]..[700,929]`, pill
 *     `[371,834]..[689,929]`.
 *
 * The common fault is structural, not arithmetic: an overlay has to REPRODUCE the
 * flex layout's result, and it will keep disagreeing with it — on padding, on
 * direction, on rounding, on which box a percentage resolves against.
 *
 * So there is no overlay. The selected option's own cell carries the accent
 * background, which means the fill cannot be offset from its label, cannot be
 * mirrored separately from it, needs no measurement, and behaves identically on
 * native and web. The rail's `padding` is the only inset involved.
 *
 * ★ A DIRECTION CHANGE NEEDS NOTHING FROM THIS COMPONENT.
 *
 * The row mirrors its children itself, and the fill travels with the cell it
 * belongs to, so switching language re-lays-out the control with no recomputed
 * geometry — there is none to recompute.
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
  /**
   * ★ THERE IS NO PILL GEOMETRY, AND THAT IS THE FIX.
   *
   * Five attempts sized and placed an absolutely-positioned pill and all five
   * shipped something wrong. `uiautomator dump` on the device explained the last
   * one precisely:
   *
   * ```
   * theme rail     : [53,823]..[1028,938]    W=975       (border box)
   * system option  : [382,834]..[700,929]    w=318       (padding box)
   * pill           : [371,834]..[689,929]    w=318   <-- 11px LEFT of its option
   * ```
   *
   * The width was right; the position was off by exactly the rail's padding,
   * because a `left` percentage resolves against the rail's BORDER box while the
   * labels live in its PADDING box. Each earlier attempt corrected that difference
   * with arithmetic, and each correction was right in one combination of platform
   * and language.
   *
   * An overlay that has to REPRODUCE a flex layout will keep disagreeing with it.
   * The fill is now the selected cell's own background, so the layout engine
   * places it exactly where it places the label — no offset to get wrong, no
   * direction to mirror twice, identical on native and web.
   */

  return (
    <View
      testID={testID}
      accessibilityRole="radiogroup"
      style={[styles.segmented, { backgroundColor: t.surface2 }, style]}
    >
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
            <View
              style={[
                styles.segmentInner,
                // ★ THE FILL IS THE SELECTED CELL'S OWN BACKGROUND.
                //
                // This is the whole fix: the pill used to be an absolutely
                // positioned sibling that had to REPRODUCE the flex layout's
                // result, and five attempts at that arithmetic were each right in
                // one platform-and-direction combination and wrong in another.
                //
                // `uiautomator dump` on the shipped build showed why: the pill was
                // exactly one segment wide (318px, correct) but sat 11px — one
                // padding step — to the left of its option, because a `left`
                // percentage resolves against the rail's BORDER box while the
                // labels live in its PADDING box.
                //
                // Painted here, that difference cannot exist. The fill is inside
                // the cell it marks, so it is where the label is, at whatever size
                // the layout gives it, mirrored with it, on every platform.
                isSelected && { backgroundColor: t.primary },
              ]}
            >
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
