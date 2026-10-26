/**
 * The reopen sheet (Plan 14 Task 2, PRD-02 FR-2.22, AC-2.6.1).
 *
 * ★ THE REASON IS REQUIRED, AND THE BUTTON DOES NOT HIDE IT.
 *
 * An empty reason is refused by the server and by the service, so the sheet's job
 * is to make the requirement obvious BEFORE the tap: the confirm stays enabled
 * and answers with a message under the field. A disabled button that never says
 * what would enable it is the worse pattern — the user taps, nothing happens, and
 * they have to work out why.
 *
 * ★ THE COPY SAYS THE HISTORY SURVIVES.
 *
 * Reopening reads as destructive ("undo the decision"), and the thing that makes
 * it safe is that nothing is erased: the old decision stays with its reason and a
 * new vote starts beside it. Saying so is the difference between an organizer who
 * reopens a wrong confirmation and one who lives with it.
 */

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BottomSheet } from '@/src/components/ui/BottomSheet';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Text } from '@/src/components/ui/Text';
import { REASON_MAX_CHARS } from '@/src/types/vote';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface ReopenSheetProps {
  visible: boolean;
  onDismiss: () => void;
  /** Called with the trimmed reason. Throws on a failed reopen. */
  onReopen: (reason: string) => Promise<void>;
  /** A catalogue key from a failed attempt, or `null`. */
  errorKey?: string | null;
  testID?: string;
}

/** The shortest reason the server accepts, mirrored for the inline message. */
const REASON_MIN_CHARS = 3;

export function ReopenSheet({
  visible,
  onDismiss,
  onReopen,
  errorKey = null,
  testID,
}: ReopenSheetProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = reason.trim();

    // The same bounds the server applies, checked here so the message appears
    // under the field rather than after a round trip.
    if (trimmed.length < REASON_MIN_CHARS) {
      setFieldError('reopen.validation.reasonRequired');
      return;
    }
    if (reason.length > REASON_MAX_CHARS) {
      setFieldError('reopen.validation.reasonTooLong');
      return;
    }

    setFieldError(null);
    setPending(true);

    try {
      await onReopen(trimmed);
      setReason('');
      onDismiss();
    } catch {
      setFieldError('errors.validationFailed');
    } finally {
      setPending(false);
    }
  };

  const shownError = fieldError ?? errorKey;

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} testID={testID}>
      <View style={styles.content}>
        <Text variant="h2">{t('reopen.sheetTitle')}</Text>

        <Text variant="body" color={theme.textMuted}>
          {t('reopen.sheetBody')}
        </Text>

        <Input
          value={reason}
          onChangeText={(value) => {
            setReason(value);
            setFieldError(null);
          }}
          label={t('reopen.reasonLabel')}
          error={shownError ? t(shownError) : undefined}
          testID={testID ? `${testID}-reason` : undefined}
        />

        <Text variant="caption" color={theme.textFaint}>
          {`${reason.length} / ${REASON_MAX_CHARS}`}
        </Text>

        <Button
          label={t('reopen.confirm')}
          onPress={() => void submit()}
          variant="danger"
          loading={pending}
          testID={testID ? `${testID}-confirm` : undefined}
        />

        <Button
          label={t('reopen.cancel')}
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
    paddingHorizontal: space[5],
    gap: space[3],
  },
});
