/**
 * The mute toggle (Plan 10 Task 6, FR-6.19, AC-6.4.1).
 *
 * ★ MUTING SILENCES N1–N3 (AND N5/N6). IT NEVER SILENCES N4.
 *
 * This is the product's core promise, and the copy says so plainly rather than
 * leaving the user to discover it. The bypass itself lives in
 * `server/routes/notifications.ts` (`MUTABLE_TYPES` omits N4) — this component
 * only states the rule and records the preference.
 *
 * ★ THE SUBTITLE IS NOT OPTIONAL POLISH.
 *
 * A user who mutes expecting silence and then receives a notification assumes the
 * toggle is broken. Telling them, at the moment they mute, that the decision will
 * still arrive is what makes the exception read as a feature.
 */

import { useCallback, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text } from '@/src/components/ui/Text';
import { ApiFailure, apiRequest } from '@/src/lib/api';
import { getStoredUserId } from '@/src/lib/session';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface MuteToggleProps {
  eventId: string;
  muted: boolean;
  onChange: (muted: boolean) => void;
  testID?: string;
}

export function MuteToggle({ eventId, muted, onChange, testID }: MuteToggleProps) {
  const { t: theme } = useTheme();
  const { t } = useTranslation();

  const [pending, setPending] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const toggle = useCallback(
    async (next: boolean) => {
      setErrorKey(null);
      // Optimistic: a switch that lags behind the finger feels broken.
      onChange(next);
      setPending(true);

      try {
        const userId = await getStoredUserId();
        await apiRequest(`/api/participants/me`, {
          method: 'PATCH',
          userId,
          platform: 'app',
          body: {
            preferences: {
              muted_events: next ? 'mute' : 'unmute',
              event_id: eventId,
            },
          },
        });
      } catch (error) {
        // Revert visibly — the switch must not claim a preference was saved when
        // it was not.
        onChange(!next);
        setErrorKey(
          error instanceof ApiFailure ? error.messageKey : 'notifications.errors.muteFailed',
        );
      } finally {
        setPending(false);
      }
    },
    [eventId, onChange],
  );

  return (
    <View style={styles.wrapper} testID={testID}>
      <View style={styles.row}>
        <View style={styles.labels}>
          <Text variant="body">{t('notifications.mute.label')}</Text>
          {/* ★ The exception, stated where the user decides. */}
          <Text
            variant="caption"
            color={theme.textMuted}
            testID={testID ? `${testID}-hint` : undefined}
          >
            {t('notifications.mute.hint')}
          </Text>
        </View>

        <Switch
          value={muted}
          onValueChange={(next) => void toggle(next)}
          disabled={pending}
          accessibilityLabel={t('notifications.mute.label')}
          accessibilityHint={t('notifications.mute.hint')}
          testID={testID ? `${testID}-switch` : undefined}
        />
      </View>

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
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  labels: {
    flex: 1,
    gap: space[1],
  },
});
