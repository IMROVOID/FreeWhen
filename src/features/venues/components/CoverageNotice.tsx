/**
 * How much of the group the ranking actually covers (Plan 08 Task 5,
 * PRD-04 FR-4.7 / AC-4.7.1, PRD-05 §11.2).
 *
 * ★ A RANKING OVER 6 OF 8 IS NEVER PRESENTED AS IF IT COVERED 8.
 *
 * The notice is mandatory, not a nicety. `coverage.compared` and
 * `coverage.total` both arrive on every result — including the
 * no-viable-option path — so this component never has to guess whether the
 * comparison was complete.
 *
 * ★ NAME THE MISSING, WHERE PRIVACY ALLOWS.
 *
 * Naming them lets the organizer act on the gap ("ask Darya to share her
 * area"). `coverage.missing` carries participant names, not ids, so this
 * renders them directly. When the list is long the names are truncated by the
 * text component, and the count still carries the message.
 */

import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text } from '@/src/components/ui/Text';
import { digits } from '@/src/lib/format';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Language } from '@/src/i18n/types';
import type { Coverage } from '@/src/engine/types';

export interface CoverageNoticeProps {
  coverage: Coverage;
  testID?: string;
}

export function CoverageNotice({ coverage, testID }: CoverageNoticeProps) {
  const { t, i18n } = useTranslation();
  const { t: theme } = useTheme();

  const locale = (i18n.language === 'en' ? 'en' : 'fa') as Language;

  const missingCount = Math.max(0, coverage.total - coverage.compared);
  const isComplete = missingCount === 0;

  // Nothing to say and nothing to warn about: a complete comparison with
  // one participant needs no notice at all.
  if (isComplete && !coverage.wideGeography) return null;

  return (
    <View testID={testID} style={styles.container} accessible>
      {!isComplete && (
        <View
          style={[styles.notice, { backgroundColor: theme.surface2, borderColor: theme.warning }]}
          testID={testID ? `${testID}-gap` : undefined}
        >
          <Text variant="body" color={theme.text}>
            {/* The count is formatted BEFORE interpolation: i18next stringifies
                a number with `toString()`, which would print Latin digits in a
                Persian sentence. */}
            {coverage.missing.length > 0
              ? t('ranking.coverageGapNamed', {
                  count: digits(missingCount, locale),
                  names: coverage.missing.join('، '),
                })
              : t('ranking.coverageGap', { count: digits(missingCount, locale) })}
          </Text>
        </View>
      )}

      {/* Different cities make the comparison itself questionable, which is a
          separate statement from "someone is missing". */}
      {coverage.wideGeography && (
        <Text
          variant="caption"
          color={theme.textMuted}
          testID={testID ? `${testID}-wide` : undefined}
        >
          {t('ranking.wideGeography')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space[2],
  },
  notice: {
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: space[3],
  },
});
