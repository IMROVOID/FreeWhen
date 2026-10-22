/**
 * The duplicate offer (Plan 06 Task 4, FR-2.7).
 *
 * ★ "CREATE ANYWAY" IS ALWAYS AVAILABLE AND IS NEVER DISABLED.
 *
 * A false positive that blocks a legitimate proposal is worse than the duplicate
 * it tried to prevent. The existing proposal is offered first because voting on
 * one place beats splitting the group across two identical ones — but the
 * secondary action is present, enabled and equally visible. There is no state in
 * this component where the user is unable to proceed.
 */

import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Text } from '@/src/components/ui/Text';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { DuplicateHint } from '@/src/types/proposal';

export interface DuplicateOfferProps {
  duplicate: DuplicateHint;
  /** Vote on / open the existing proposal — the primary action. */
  onUseExisting: () => void;
  /** Proceed with the new one — always enabled. */
  onCreateAnyway: () => void;
  testID?: string;
}

export function DuplicateOffer({
  duplicate,
  onUseExisting,
  onCreateAnyway,
  testID,
}: DuplicateOfferProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  const existing = duplicate.proposal;

  return (
    <Card variant="raised" testID={testID} style={styles.card}>
      <Text variant="h3">{t('proposals.duplicate.title')}</Text>

      <Text variant="body" color={theme.textMuted}>
        {t('proposals.duplicate.body', { name: existing.venue?.name ?? existing.title })}
      </Text>

      {/* The measured distance, when the match was positional. */}
      {duplicate.metres !== null && (
        <Text variant="caption" color={theme.textFaint} numeric>
          {t('proposals.duplicate.distance', { metres: duplicate.metres })}
        </Text>
      )}

      <View style={styles.actions}>
        <Button
          label={t('proposals.duplicate.useExisting', { name: existing.venue?.name ?? existing.title })}
          onPress={onUseExisting}
          variant="primary"
          size="medium"
          testID={testID ? `${testID}-use-existing` : undefined}
        />

        <Button
          label={t('proposals.duplicate.createAnyway')}
          onPress={onCreateAnyway}
          variant="ghost"
          size="medium"
          testID={testID ? `${testID}-create-anyway` : undefined}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space[2],
  },
  actions: {
    gap: space[2],
    marginTop: space[2],
  },
});
