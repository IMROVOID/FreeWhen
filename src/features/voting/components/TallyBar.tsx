/**
 * The tally display (Plan 07 Task 7, FR-2.15).
 *
 * ★ COUNTS **AND** NAMES.
 *
 * Named attribution is what makes voting feel accountable rather than
 * anonymous, and perceived fairness rises with it (OQ-2.1). Showing names is the
 * default here, not a setting to be added later — a participant whose visibility
 * is `private` gets the aggregate-only rendering, which this component honours.
 *
 * ★ NEVER COLOUR-ONLY (PRD-11 §8).
 *
 * Every value carries its text label. The coloured dot is a second channel, not
 * the channel: a reader who cannot distinguish the dot still reads «۴ موافق».
 *
 * ★ DIGITS GO THROUGH THE LOCALE.
 *
 * Counts are numbers in the payload and Persian numerals on screen. `Text` with
 * `numeric` does the conversion, so a Persian reader sees «۷ از ۱۰» and an
 * English reader sees "7 of 10" from the same data.
 */

import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text } from '@/src/components/ui/Text';
import { border, radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Tally } from '@/src/types/vote';

export interface TallyBarProps {
  tally: Tally;
  /** Whether the participants' names may be shown (FR-2.15). */
  showNames?: boolean;
  testID?: string;
}

interface Row {
  key: 'yes' | 'maybe' | 'no' | 'unanswered';
  labelKey: string;
  count: number;
  names: string[];
  color: string;
}

/**
 * The counts row with names underneath each value.
 *
 * `unanswered` is rendered as its own row with its own colour, never merged into
 * `no` — that distinction is the whole point of the tally (PRD-02 §13.2), and a
 * UI that hid it would undo the correctness underneath.
 */
export function TallyBar({ tally, showNames = true, testID }: TallyBarProps) {
  const { t: theme } = useTheme();
  const { t } = useTranslation();

  const rows: Row[] = [
    {
      key: 'yes',
      labelKey: 'voting.yes',
      count: tally.yes,
      names: tally.voters.yes,
      color: theme.success,
    },
    {
      key: 'maybe',
      labelKey: 'voting.maybe',
      count: tally.maybe,
      names: tally.voters.maybe,
      color: theme.warning,
    },
    {
      key: 'no',
      labelKey: 'voting.no',
      count: tally.no,
      names: tally.voters.no,
      color: theme.danger,
    },
    {
      key: 'unanswered',
      labelKey: 'voting.outstandingCount',
      count: tally.unanswered,
      names: tally.outstanding,
      color: theme.textFaint,
    },
  ];

  return (
    <View testID={testID} style={styles.container}>
      <View style={styles.rows}>
        {rows.map((row) => {
          const label =
            row.key === 'unanswered'
              ? t('voting.outstandingCount', { count: row.count })
              : `${row.count} ${t(row.labelKey)}`;

          return (
            <View key={row.key} style={styles.row}>
              <View style={[styles.dot, { backgroundColor: row.color }]} />
              <Text variant="caption" color={theme.textMuted} numeric>
                {label}
              </Text>
            </View>
          );
        })}
      </View>

      {showNames ? (
        <View style={styles.names}>
          {rows
            .filter((row) => row.names.length > 0 && row.key !== 'unanswered')
            .map((row) => (
              <Text
                key={row.key}
                variant="caption"
                color={theme.textFaint}
                style={styles.nameLine}
                numberOfLines={3}
              >
                {row.names.join('، ')}
              </Text>
            ))}
        </View>
      ) : (
        <Text variant="caption" color={theme.textFaint}>
          {t('voting.privateAggregate')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space[2],
  },
  rows: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space[3],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
  },
  dot: {
    width: space[2],
    height: space[2],
    borderRadius: radius.pill,
    borderWidth: border.hairline,
    borderColor: 'transparent',
  },
  names: {
    gap: space[1],
  },
  nameLine: {
    lineHeight: 18,
  },
});
