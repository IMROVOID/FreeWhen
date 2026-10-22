/**
 * "I can't make it" (Plan 10 Task 11, FR-6.22).
 *
 * ★ THIS IS A ONE-TAP RSVP WRITE, NOT A SEPARATE STATE.
 *
 * It sets `rsvp = 'cannot'`, so the attendee counts on the card and the record of
 * who said what cannot disagree. A parallel `status` column would be a second
 * source of truth for one fact.
 *
 * ★ IT CONFIRMS BEFORE IT SENDS.
 *
 * Dropping out is visible to the whole group, so a stray tap should not do it.
 * The confirmation is inline rather than a modal — one extra tap, no dialog to
 * dismiss.
 */

import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/src/components/ui/Button';
import { Text } from '@/src/components/ui/Text';
import { ApiFailure, apiRequest } from '@/src/lib/api';
import { getStoredUserId } from '@/src/lib/session';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface CantMakeItActionProps {
  eventId: string;
  /** Already `cannot` — the action is spent and shows as such. */
  alreadyCannot: boolean;
  onChanged?: () => void;
  testID?: string;
}

export function CantMakeItAction({
  eventId,
  alreadyCannot,
  onChanged,
  testID,
}: CantMakeItActionProps) {
  const { t: theme } = useTheme();
  const { t } = useTranslation();

  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const send = useCallback(async () => {
    setErrorKey(null);
    setPending(true);

    try {
      const userId = await getStoredUserId();
      await apiRequest(`/api/events/${eventId}/status-update`, {
        method: 'POST',
        userId,
        platform: 'app',
        body: { action: 'cannot_make_it' },
      });

      setConfirming(false);
      onChanged?.();
    } catch (error) {
      setErrorKey(
        error instanceof ApiFailure ? error.messageKey : 'followThrough.errors.generic',
      );
    } finally {
      setPending(false);
    }
  }, [eventId, onChanged]);

  if (alreadyCannot) {
    return (
      <View testID={testID}>
        <Text variant="caption" color={theme.textMuted}>
          {t('followThrough.cannot.already')}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.wrapper} testID={testID}>
      {confirming ? (
        <>
          <Text variant="caption" color={theme.textMuted}>
            {t('followThrough.cannot.confirmBody')}
          </Text>
          <Button
            label={t('followThrough.cannot.confirmAction')}
            onPress={() => void send()}
            variant="danger"
            size="medium"
            loading={pending}
            testID={testID ? `${testID}-confirm` : undefined}
          />
          <Button
            label={t('common.cancel')}
            onPress={() => setConfirming(false)}
            variant="ghost"
            size="small"
            testID={testID ? `${testID}-cancel` : undefined}
          />
        </>
      ) : (
        <Button
          label={t('followThrough.cannot.action')}
          onPress={() => setConfirming(true)}
          variant="secondary"
          size="medium"
          testID={testID ? `${testID}-action` : undefined}
        />
      )}

      {errorKey !== null && (
        <Text variant="caption" color={theme.danger} accessibilityLiveRegion="polite">
          {t(errorKey)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: space[2],
  },
});
