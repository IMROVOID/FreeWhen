/**
 * The excluded venues (Plan 08 Task 4, PRD-04 FR-4.14, OQ-4.2).
 *
 * ★ EXCLUDED VENUES ARE SHOWN, NOT HIDDEN.
 *
 * `«حذف شد: دسترسی بدون پله برای داریا تایید نشده است.»` — seeing what was
 * excluded and why is exactly the transparency the product promises. Hiding
 * the exclusion hides the reason for the decision, and a user who cannot see
 * the reason cannot contest it.
 *
 * ★ MUTED IS NOT INVISIBLE.
 *
 * The rows are struck and set on `surface3`, and they carry their reason in
 * full-strength muted text. The treatment says "not in the ranking"; it never
 * says "not worth reading".
 */

import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text } from '@/src/components/ui/Text';
import { renderExclusion } from '@/src/features/venues/services/reason-render';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Language } from '@/src/i18n/types';
import type { Exclusion } from '@/src/engine/types';

export interface ExcludedSectionProps {
  excluded: Exclusion[];
  /** Venue names by id, so a row can name the place it is about. */
  venueNames: Record<string, string>;
  /** Participant names by id, for the "who it affected" clause. */
  participantNames?: Record<string, string>;
  testID?: string;
}

export function ExcludedSection({
  excluded,
  venueNames,
  participantNames = {},
  testID,
}: ExcludedSectionProps) {
  const { t, i18n } = useTranslation();
  const { t: theme } = useTheme();

  const locale = (i18n.language === 'en' ? 'en' : 'fa') as Language;

  // An empty section is not rendered at all — but an empty section is also
  // not the same as "nothing was excluded", so the caller decides whether to
  // mount this component from the array it already has.
  if (excluded.length === 0) return null;

  return (
    <View testID={testID} style={styles.container}>
      <View style={styles.headingRow}>
        <Text variant="caption" color={theme.textFaint}>
          {t('ranking.excludedHeading')}
        </Text>
        <Text variant="caption" color={theme.textFaint} numeric>
          {excluded.length}
        </Text>
      </View>

      {excluded.map((exclusion) => {
        const venueName = venueNames[exclusion.venueId] ?? exclusion.venueId;
        const participantName = exclusion.participantId
          ? (participantNames[exclusion.participantId] ?? null)
          : null;

        // ★ The reason is plain language naming the person — not a code.
        const reason = renderExclusion(exclusion, locale, participantName);

        return (
          <View
            key={`${exclusion.venueId}-${exclusion.reason}-${exclusion.participantId ?? 'venue'}`}
            style={[styles.row, { backgroundColor: theme.surface3 }]}
            testID={testID ? `${testID}-${exclusion.venueId}` : undefined}
          >
            <Text
              variant="body"
              color={theme.textMuted}
              numberOfLines={1}
              style={styles.struck}
            >
              {venueName}
            </Text>
            <Text variant="caption" color={theme.textMuted}>
              {reason}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space[2],
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space[1],
  },
  row: {
    borderRadius: radius.sm,
    padding: space[3],
    gap: space[1],
  },
  struck: {
    textDecorationLine: 'line-through',
  },
});
