/**
 * A participant's start point as an AREA, never a pin
 * (Plan 08 Task 7, FR-4.7, FR-8.16, AC-4.1.1).
 *
 * ★ THE RADIUS IS SIZED TO `accuracyM`.
 *
 * Drawing a precise-looking pin at a fuzzed coordinate is both misleading —
 * the person is not there — and a compliance exposure (Apple §1.1.6). The
 * circle's size is the accuracy, and the label says `محدودهٔ تقریبی`, so the
 * imprecision is visible rather than implied.
 *
 * This component renders the model, not the map: it produces the circle's
 * geometry and label as data, and the adapter draws it. That keeps the
 * privacy rule testable without a renderer.
 */

import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text } from '@/src/components/ui/Text';
import { radiusForAccuracy } from '@/src/features/map/level';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { ApproxArea } from '@/src/features/map/types';

export interface ParticipantMarkerProps {
  area: ApproxArea;
  /** The drawable circle radius, reported to the adapter. */
  onRadiusChange?: (radiusM: number) => void;
  testID?: string;
}

/**
 * The view-model for one approximate area.
 *
 * Exported separately so the rule can be asserted without rendering:
 * a coarse fix must produce a LARGER circle, never a tighter one.
 */
export interface AreaViewModel {
  radiusM: number;
  opacity: number;
  color: string;
  label: string;
  isCoarse: boolean;
}

/** The fill opacity of the area. Low enough to read pins through. */
const AREA_OPACITY = 0.18;

/** Above this accuracy, the fix is explicitly coarse. */
const COARSE_ACCURACY_M = 500;

export function areaViewModel(area: ApproxArea, label: string): AreaViewModel {
  return {
    radiusM: radiusForAccuracy(area.accuracyM),
    opacity: AREA_OPACITY,
    color: area.color,
    label,
    isCoarse: area.accuracyM >= COARSE_ACCURACY_M,
  };
}

export function ParticipantMarker({ area, onRadiusChange, testID }: ParticipantMarkerProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  const label = t('venue.approximateArea');
  const model = areaViewModel(area, label);

  // Reported in an effect, never during render — a setState from a render
  // callback is an infinite loop, and the radius is a side effect of the props.
  const { radiusM } = model;
  useEffect(() => {
    onRadiusChange?.(radiusM);
  }, [onRadiusChange, radiusM]);

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`${area.name}. ${label}`}
      style={styles.row}
    >
      {/* The identity colour, matching the avatar ring (§2.5) — and the name
          is present as text, so colour is never the only signal (§2.7). */}
      <View style={[styles.swatch, { backgroundColor: area.color, borderColor: theme.line }]} />
      <Text variant="caption" color={theme.textMuted} numberOfLines={1} style={styles.name}>
        {area.name}
      </Text>
      <Text variant="caption" color={theme.textFaint}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  swatch: {
    width: space[3],
    height: space[3],
    borderRadius: radius.pill,
    borderWidth: 1,
    opacity: 0.7,
  },
  name: {
    flex: 1,
  },
});
