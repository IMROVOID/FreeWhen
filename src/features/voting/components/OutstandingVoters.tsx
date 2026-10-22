/**
 * The outstanding-voters list (Plan 07 Task 5, FR-2.16).
 *
 * ★ THIS IS THE ORGANIZER'S MOST VALUABLE SIGNAL, SO IT IS NOT IN A MENU.
 *
 * "Who has not answered" is the one thing that turns a stalled event into a
 * nudge. It sits in the status area itself, as a count that expands in place —
 * not behind a three-dot menu nobody opens.
 *
 * ★ A NON-VOTER IS NOT A "NO".
 *
 * The list is about OUTSTANDING RESPONSES, not dissent. Its copy says
 * "have not voted", never "against", because the two mean opposite things and
 * conflating them is the bug the tally is built to avoid (PRD-02 §13.2).
 */

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text } from '@/src/components/ui/Text';
import { Pressy } from '@/src/components/ui/Pressy';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface OutstandingVotersProps {
  /** The participants with no vote. */
  outstanding: string[];
  /** The number of participants eligible to vote. */
  total: number;
  /** How many have answered. */
  answered: number;
  testID?: string;
}

/**
 * `۷ از ۱۰ نفر رأی داده‌اند ▾`, expanding to the names.
 *
 * The count is ALWAYS derived from `answered`/`total` rather than from the
 * length of `outstanding`, so a participant who left mid-event cannot make the
 * two disagree.
 */
export function OutstandingVoters({
  outstanding,
  total,
  answered,
  testID,
}: OutstandingVotersProps) {
  const { t: theme } = useTheme();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const hasOutstanding = outstanding.length > 0;

  return (
    <View testID={testID} style={styles.container}>
      <Pressy
        onPress={hasOutstanding ? () => setExpanded((open) => !open) : undefined}
        disabled={!hasOutstanding}
        haptic="light"
        accessibilityRole={hasOutstanding ? 'button' : undefined}
        accessibilityLabel={t('voting.tallySummary', { voted: answered, total })}
        accessibilityHint={hasOutstanding ? t('voting.outstandingHint') : undefined}
        accessibilityState={{ expanded: hasOutstanding ? expanded : undefined }}
        testID={testID ? `${testID}-toggle` : undefined}
      >
        <View style={styles.summary}>
          <Text variant="body" color={theme.text} numeric>
            {t('voting.tallySummary', { voted: answered, total })}
          </Text>
          {hasOutstanding && (
            <Text variant="caption" color={theme.brand}>
              {expanded ? '▴' : '▾'}
            </Text>
          )}
        </View>
      </Pressy>

      {expanded && hasOutstanding && (
        <View
          style={[styles.names, { backgroundColor: theme.surface2 }]}
          testID={testID ? `${testID}-names` : undefined}
          accessibilityRole="list"
        >
          <Text variant="caption" color={theme.textMuted}>
            {t('voting.outstandingTitle')}
          </Text>
          {outstanding.map((name) => (
            <Text key={name} variant="body" color={theme.text} accessibilityRole="text">
              {name}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space[2],
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: space[8],
  },
  names: {
    borderRadius: radius.md,
    padding: space[3],
    gap: space[1],
  },
});
