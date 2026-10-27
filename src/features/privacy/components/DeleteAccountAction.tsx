/**
 * In-app account deletion (Plan 09 Task 10, Apple §5.1.1(v) / B5).
 *
 * ★ UNLIKE LOCATION DELETION, THIS CONFIRMS.
 *
 * Account deletion is irreversible and takes the events the person organised
 * with it. A one-tap irreversible action is a bug, not a convenience. The
 * confirmation names the consequence before the second tap, and the destructive
 * button is the one that is NOT visually primary.
 *
 * ★ THE CONFIRMATION SAYS WHAT SURVIVES, TOO.
 *
 * "Delete my account" alone implies everything vanishes. In fact the events the
 * person merely JOINED survive, because other people's plans are not theirs to
 * delete. Saying so before the tap is the difference between an informed
 * decision and a surprise.
 */

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Text } from '@/src/components/ui/Text';
import { useTheme } from '@/src/theme/useTheme';
import { space, border } from '@/src/theme/tokens';

export interface DeleteAccountActionProps {
  onConfirm: () => void | Promise<void>;
  /** Disables the row while the request is in flight. */
  busy?: boolean;
  testID?: string;
}

export function DeleteAccountAction({ onConfirm, busy = false, testID }: DeleteAccountActionProps) {
  const { t: theme } = useTheme();
  const { t } = useTranslation();

  const [confirming, setConfirming] = useState(false);

  return (
    <View testID={testID} style={styles.root}>
      {confirming ? (
        <Card variant="raised" style={styles.confirmCard}>
          <Text variant="h3" color="danger">
            {t('privacy.deleteAccountConfirmTitle')}
          </Text>

          <Text variant="body">{t('privacy.deleteAccountConfirmBody')}</Text>

          <Text variant="caption" color="textMuted">
            {t('privacy.deleteAccountSurvivors')}
          </Text>

          <View style={[styles.actions, { borderColor: theme.line }]}>
            <Button
              label={t('privacy.deleteAccountConfirmAction')}
              variant="danger"
              size="medium"
              loading={busy}
              onPress={() => {
                void onConfirm();
              }}
              testID={testID ? `${testID}-confirm` : undefined}
            />
            <Button
              label={t('common.cancel')}
              variant="secondary"
              size="medium"
              disabled={busy}
              onPress={() => setConfirming(false)}
              testID={testID ? `${testID}-cancel` : undefined}
            />          </View>
        </Card>
      ) : (
        <>
          {/* ★ A SURFACE, IN THE DANGER TONE.
              This was `variant="ghost"`, which paints `transparent` — so the
              most consequential action on the screen was bare text, sitting
              between painted cards and painted buttons. The destructive tone
              is right; the missing fill was a bug. */}
          <Button
            label={t('privacy.deleteAccount')}
            variant="danger"
            size="medium"
            onPress={() => setConfirming(true)}
            testID={testID ? `${testID}-begin` : undefined}
            accessibilityLabel={t('privacy.deleteAccountA11y')}
          />
          <Text variant="caption" color="textFaint" style={styles.hint}>
            {t('privacy.deleteAccountHint')}
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[2] },
  confirmCard: { gap: space[3] },
  actions: {
    gap: space[2],
    marginTop: space[2],
    paddingTop: space[3],
    borderTopWidth: border.hairline,
  },
  hint: { paddingHorizontal: space[2] },
});
