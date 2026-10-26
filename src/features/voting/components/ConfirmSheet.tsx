/**
 * The confirmation sheet (Plan 07 Task 8, PRD-11 S6 → S12).
 *
 * ★ THE WARNING NAMES PEOPLE, AND IT DOES NOT BLOCK.
 *
 * `«۳ نفر هنوز رأی نداده‌اند. با این حال ثبت می‌کنید؟»` — with the three names
 * listed underneath — is the whole safety mechanism. There is deliberately no
 * disabled confirm button: one absent person must never hold the group hostage
 * (FR-2.20, AC-2.3.1). The organizer is informed, then decides.
 *
 * ★ ONE ACTION TO OPEN, ONE TO CONFIRM.
 *
 * The plan's "one-action organizer confirmation" means the organizer does not
 * have to select a winner first: `planConfirmation` picks the engine's leader.
 * The sheet exists to show WHICH card will be recorded, not to ask them to
 * assemble it.
 *
 * ★ THE RESULT IS ANNOUNCED TO SCREEN READERS (AC, Style Guide §8).
 *
 * Success renders `decision.confirmedAnnouncement` inside a live region, because
 * the confirmed state replaces content in place and a silent swap is invisible
 * to anyone not watching the pixels.
 */

import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BottomSheet } from '@/src/components/ui/BottomSheet';
import { Button } from '@/src/components/ui/Button';
import { Text } from '@/src/components/ui/Text';
import { border, radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

import { confirmWarning } from '../services/confirm';

export interface ConfirmSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
  /** The title of the option being recorded. */
  proposalTitle: string;
  /** The participants with no answer on that option. */
  outstanding: string[];
  /** True while the confirmation is in flight. */
  pending?: boolean;
  testID?: string;
}

export function ConfirmSheet({
  visible,
  onDismiss,
  onConfirm,
  proposalTitle,
  outstanding,
  pending = false,
  testID,
}: ConfirmSheetProps) {
  const { t: theme } = useTheme();
  const { t } = useTranslation();

  const warning = confirmWarning(outstanding);

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      testID={testID}
    >
      <View style={styles.content}>
        <Text variant="h2">{t('decision.confirmTitle')}</Text>
        <Text variant="body" color={theme.textMuted}>
          {t('decision.confirmBody')}
        </Text>

        <View style={[styles.chosen, { backgroundColor: theme.surface2 }]}>
          <Text variant="caption" color={theme.textMuted}>
            {t('decision.confirmChosen')}
          </Text>
          <Text variant="bodyL" numberOfLines={2}>
            {proposalTitle}
          </Text>
        </View>

        {/* ★ THE WARNING. Naming people, never blocking. */}
        {warning && (
          <View
            testID={testID ? `${testID}-warning` : undefined}
            accessibilityRole="alert"
            style={[styles.warning, { borderColor: theme.warning }]}
          >
            <Text variant="body" color={theme.warning} numeric>
              {t(warning.key, { count: warning.count })}
            </Text>
            <Text variant="caption" color={theme.textMuted} numberOfLines={4}>
              {warning.names.join('، ')}
            </Text>
          </View>
        )}

        <Button
          label={t('decision.confirmProceed')}
          onPress={onConfirm}
          variant="brand"
          loading={pending}
          testID={testID ? `${testID}-proceed` : undefined}
        />
        <Button
          label={t('decision.confirmCancel')}
          onPress={onDismiss}
          variant="ghost"
          size="medium"
          testID={testID ? `${testID}-cancel` : undefined}
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: space[5],
    gap: space[4],
  },
  chosen: {
    borderRadius: radius.md,
    padding: space[4],
    gap: space[1],
  },
  warning: {
    borderWidth: border.strong,
    borderRadius: radius.md,
    padding: space[3],
    gap: space[1],
  },
});
