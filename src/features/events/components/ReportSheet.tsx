/**
 * The message report sheet (Apple §1.2, D23).
 *
 * ★ REPORTING MUST NEVER REQUIRE AN EXPLANATION.
 *
 * The reason field is optional and clearly marked so. Requiring one before a
 * participant can flag abuse puts friction on exactly the person already having
 * a bad experience, and the moderator reading the queue has the message either
 * way. The field exists because a short note helps triage, not because the
 * report is incomplete without it.
 *
 * ★ THE SHEET NEVER HOLDS THE MESSAGE BODY.
 *
 * It is handed a message ID, not the text. There is nothing here that could
 * carry someone's words into a log, an error, or a crash report — the same rule
 * the server applies to the stored row.
 */

import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BottomSheet } from '@/src/components/ui/BottomSheet';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Text } from '@/src/components/ui/Text';
import { reportMessage } from '@/src/features/events/services/chat';
import { getStoredUserId } from '@/src/lib/session';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface ReportSheetProps {
  /** The message being reported, or `null` when the sheet is closed. */
  messageId: string | null;
  visible: boolean;
  onDismiss: () => void;
  testID?: string;
}

export function ReportSheet({ messageId, visible, onDismiss, testID }: ReportSheetProps) {
  const { t: theme } = useTheme();
  const { t } = useTranslation();

  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = useCallback(async () => {
    if (!messageId || pending) return;

    setPending(true);
    setErrorKey(null);

    try {
      const userId = await getStoredUserId();
      await reportMessage(messageId, userId, reason.trim() || undefined);

      setDone(true);
      setReason('');
    } catch {
      setErrorKey('chat.reportFailed');
    } finally {
      setPending(false);
    }
  }, [messageId, pending, reason]);

  const close = useCallback(() => {
    setDone(false);
    setErrorKey(null);
    setReason('');
    onDismiss();
  }, [onDismiss]);

  return (
    <BottomSheet visible={visible} onDismiss={close} testID={testID}>
      <View style={styles.body}>
        {done ? (
          <>
            {/* The confirmation is what tells the participant their report
                counted. Reporting into a void is why people stop reporting. */}
            <Text variant="h3">{t('chat.reportDone')}</Text>
            <Button label={t('common.close')} onPress={close} testID="report-done" />
          </>
        ) : (
          <>
            <Text variant="h3">{t('chat.report')}</Text>

            <Input
              value={reason}
              onChangeText={setReason}
              label={t('chat.reportReason')}
              testID="report-reason"
            />

            {errorKey !== null && (
              <Text variant="caption" color={theme.danger} accessibilityLiveRegion="polite">
                {t(errorKey)}
              </Text>
            )}

            <Button
              label={t('chat.reportSubmit')}
              onPress={() => void submit()}
              loading={pending}
              testID="report-submit"
            />
            <Button
              label={t('chat.cancel')}
              variant="ghost"
              size="medium"
              onPress={close}
              testID="report-cancel"
            />
          </>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: space[3], paddingHorizontal: space[5] },
});
