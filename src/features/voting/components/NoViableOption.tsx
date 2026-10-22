/**
 * The no-viable-option and all-rejected states (Plan 07 Task 12, E3, PRD-05 §5.3).
 *
 * ★ ALWAYS ACTIONABLE, NEVER A DEAD END.
 *
 * When the engine filters every venue out, or the group has voted "no" on
 * everything, an empty panel reads as a bug and gives nobody anything to do. The
 * honest answer is the prompt plus the two moves that change the outcome: add an
 * option, or relax a constraint.
 *
 * ★ EVERY EXCLUSION CARRIES ITS REASON (PRD-05 §5.2).
 *
 * "Ruled out" with no account of why is the same silence the lens name exists to
 * prevent. Each excluded venue renders its `{templateId, params}` detail in the
 * reader's own language.
 */

import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Text } from '@/src/components/ui/Text';
import { renderReason } from '@/src/lib/format';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Language } from '@/src/i18n/types';

export interface NoViableProps {
  /** `true` when every vote was "no", `false` when the engine excluded everything. */
  rejectedByEveryone?: boolean;
  /** The engine's exclusions, each with a reason. */
  excluded?: Array<{
    venueId: string;
    venueName?: string;
    detail: { templateId: string; params: Record<string, unknown> };
  }>;
  onAddOption?: () => void;
  onRelaxConstraints?: () => void;
  testID?: string;
}

export function NoViableOption({
  rejectedByEveryone = false,
  excluded = [],
  onAddOption,
  onRelaxConstraints,
  testID,
}: NoViableProps) {
  const { t: theme } = useTheme();
  const { t, i18n } = useTranslation();
  const locale: Language = i18n.language === 'en' ? 'en' : 'fa';

  return (
    <Card variant="raised" testID={testID} style={styles.card}>
      <Text variant="h3">{t('decision.noViableTitle')}</Text>
      <Text variant="body" color={theme.textMuted}>
        {t('decision.noViableBody')}
      </Text>

      {/* ★ E3 — the all-no case says so in its own words. */}
      {rejectedByEveryone && (
        <Text variant="body" color={theme.warning} testID={testID ? `${testID}-rejected` : undefined}>
          {t('decision.addOptionAfterRejection')}
        </Text>
      )}

      {excluded.length > 0 && (
        <View style={styles.reasons}>
          {excluded.slice(0, 5).map((entry) => (
            <View key={entry.venueId} style={[styles.reason, { backgroundColor: theme.surface2 }]}>
              {entry.venueName && (
                <Text variant="caption" color={theme.text} numberOfLines={1}>
                  {entry.venueName}
                </Text>
              )}
              <Text variant="caption" color={theme.textMuted} numberOfLines={2}>
                {renderReason(
                  {
                    templateId: entry.detail.templateId as never,
                    params: entry.detail.params as never,
                  },
                  locale,
                )}
              </Text>
            </View>
          ))}
        </View>
      )}

      <Button
        label={t('decision.noViableAdd')}
        onPress={onAddOption}
        variant="brand"
        testID={testID ? `${testID}-add` : undefined}
      />
      <Button
        label={t('decision.noViableRelax')}
        onPress={onRelaxConstraints}
        variant="secondary"
        size="medium"
        testID={testID ? `${testID}-relax` : undefined}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space[3],
    borderRadius: radius.lg,
  },
  reasons: {
    gap: space[2],
  },
  reason: {
    borderRadius: radius.sm,
    padding: space[3],
    gap: space[1],
  },
});
