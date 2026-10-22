/**
 * One participant's trip to one venue (Plan 08 Task 6, PRD-04 FR-4.17).
 *
 * ★ MODE, TIME-OR-RANGE, COST, CONFIDENCE, UNMET CONSTRAINT.
 *
 * The time goes through `displayMinutes`, so an estimate is a range here too —
 * this row is the most likely place for a false integer to appear, because
 * `ParticipantResult.minutes` is a bare number on the payload.
 *
 * ★ AN UNMET CONSTRAINT IS NAMED, NOT COUNTED.
 *
 * `unmet` is a reason template; it renders as the sentence naming what was not
 * met. A silent row for a participant who cannot use the venue would hide the
 * one thing they need to see.
 */

import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text } from '@/src/components/ui/Text';
import { ConfidenceChip } from '@/src/features/venues/components/ConfidenceChip';
import { displayMinutes, type DisplayMinutes } from '@/src/features/venues/services/display-minutes';
import { labelKey, MODE_KEY } from '@/src/features/venues/services/labels';
import {
  formatCost,
  formatMinutesWithUnit,
  formatRangeWithUnit,
  renderReasonOrEmpty,
} from '@/src/features/venues/services/reason-render';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import { translatorFor } from '@/src/i18n';
import type { Language } from '@/src/i18n/types';
import type { ParticipantResult } from '@/src/engine/types';

export interface PerPersonRowProps {
  result: ParticipantResult;
  /** The participant's identity colour, matching their avatar ring (Style Guide §2.5). */
  color?: string;
  testID?: string;
}

export function PerPersonRow({ result, color, testID }: PerPersonRowProps) {
  const { t, i18n } = useTranslation();
  const { t: theme } = useTheme();

  const locale = (i18n.language === 'en' ? 'en' : 'fa') as Language;

  const time = displayMinutes({
    confidence: result.confidence,
    minutes: result.minutes,
    minutesRange: result.minutesRange,
  });

  const unmet = renderReasonOrEmpty(result.unmet, locale);

  return (
    <View testID={testID} style={styles.row}>
      <View style={styles.header}>
        <View style={styles.identity}>
          {/* The colour is an identity aid, never the only signal (§2.7). */}
          {color && <View style={[styles.dot, { backgroundColor: color }]} />}
          {/* A participant name is DATA — never translated. */}
          <Text variant="body" color={theme.text} numberOfLines={1} style={styles.name}>
            {result.name}
          </Text>
        </View>
        <ConfidenceChip
          confidence={result.confidence}
          testID={testID ? `${testID}-confidence` : undefined}
        />
      </View>

      <View style={styles.details}>
        <Text variant="caption" color={theme.textMuted}>
          {t(labelKey(MODE_KEY, result.mode))}
        </Text>
        <Text variant="body" color={theme.text}>
          {renderTime(time, locale)}
        </Text>
        <Text variant="caption" color={theme.textFaint}>
          {formatCost(result.costIrr, locale)}
        </Text>
      </View>

      {unmet.length > 0 && (
        <Text variant="caption" color={theme.warning}>
          {unmet}
        </Text>
      )}
    </View>
  );
}

/**
 * The one place a `DisplayMinutes` becomes text for a person.
 *
 * `unknown` stays `نامشخص`: no figure, never a zero.
 */
function renderTime(value: DisplayMinutes, locale: Language): string {
  switch (value.kind) {
    case 'exact':
      return formatMinutesWithUnit(value.minutes, locale);
    case 'range':
      return formatRangeWithUnit(value.low, value.high, locale);
    case 'unknown':
      return translatorFor(locale)('venue.notMeasured');
  }
}

const styles = StyleSheet.create({
  row: {
    gap: space[2],
    paddingVertical: space[3],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    flex: 1,
  },
  dot: {
    width: space[2],
    height: space[2],
    borderRadius: radius.pill,
  },
  name: {
    flex: 1,
  },
  details: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space[3],
  },
});
