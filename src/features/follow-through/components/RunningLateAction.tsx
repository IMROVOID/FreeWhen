/**
 * "I'm running late" (Plan 10 Task 11, FR-6.21, E7).
 *
 * ★ THREE INCREMENTS, NOT A FREEFORM NUMBER.
 *
 * The server accepts only 10 / 20 / 30, so the UI offers exactly those. A picker
 * that let someone broadcast "۴۰۰۰ دقیقه" would poke every `going` participant's
 * phone for no reason.
 *
 * ★ THE STATUS IS TRANSIENT AND SAYS SO.
 *
 * A running-late badge is meaningful for two hours; the component hides itself
 * once the window closes rather than leaving a note that outlives the event.
 */

import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import { ApiFailure } from '@/src/lib/api';
import { getStoredUserId } from '@/src/lib/session';
import { apiRequest } from '@/src/lib/api';
import { border, radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

import { RUNNING_LATE_OPTIONS } from '../services/rsvp';

export interface RunningLateActionProps {
  eventId: string;
  /** Already-rendered statuses for the card, newest first per person. */
  statuses: Array<{ display_name: string; minutes: number }>;
  onReported?: () => void;
  testID?: string;
}

export function RunningLateAction({
  eventId,
  statuses,
  onReported,
  testID,
}: RunningLateActionProps) {
  const { t: theme } = useTheme();
  const { t } = useTranslation();

  const [pending, setPending] = useState<number | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const report = useCallback(
    async (minutes: number) => {
      setErrorKey(null);
      setPending(minutes);

      try {
        const userId = await getStoredUserId();
        await apiRequest(`/api/events/${eventId}/status-update`, {
          method: 'POST',
          userId,
          platform: 'app',
          body: { action: 'running_late', minutes },
        });

        onReported?.();
      } catch (error) {
        setErrorKey(
          error instanceof ApiFailure ? error.messageKey : 'followThrough.errors.generic',
        );
      } finally {
        setPending(null);
      }
    },
    [eventId, onReported],
  );

  return (
    <View style={styles.wrapper} testID={testID}>
      <Text variant="h3">{t('followThrough.late.title')}</Text>

      <View style={styles.row}>
        {RUNNING_LATE_OPTIONS.map((minutes) => (
          <Pressy
            key={minutes}
            onPress={() => void report(minutes)}
            disabled={pending !== null}
            accessibilityRole="button"
            accessibilityLabel={t('followThrough.late.action', { minutes })}
            accessibilityState={{ disabled: pending !== null, busy: pending === minutes }}
            style={styles.slot}
            testID={testID ? `${testID}-${minutes}` : undefined}
          >
            <View style={[styles.chip, { backgroundColor: theme.surface2 }]}>
              <Text variant="caption" color={theme.text} numeric align="center">
                {t('followThrough.late.option', { minutes })}
              </Text>
            </View>
          </Pressy>
        ))}
      </View>

      {statuses.length > 0 && (
        <View style={styles.statuses}>
          {statuses.map((status) => (
            <Text
              key={status.display_name}
              variant="caption"
              color={theme.textMuted}
              numeric
              accessibilityLiveRegion="polite"
            >
              {t('followThrough.late.broadcast', {
                name: status.display_name,
                minutes: status.minutes,
              })}
            </Text>
          ))}
        </View>
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
  row: {
    flexDirection: 'row',
    gap: space[2],
  },
  slot: {
    flex: 1,
  },
  chip: {
    height: size.buttonMedium,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: border.hairline,
    borderColor: 'transparent',
  },
  statuses: {
    gap: space[1],
  },
});
