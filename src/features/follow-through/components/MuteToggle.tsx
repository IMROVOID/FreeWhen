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
import { getStoredUserId } from '@/src/lib/session';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

import { toggleMute } from '../services/mute';

/**
 * The transport, loaded on demand.
 *
 * See the note in `toggle`: a static import of `src/lib/api` drags
 * `expo-modules-core` into any process that renders this component, which the
 * Node test runner cannot satisfy.
 */
async function loadTransport() {
  return import('@/src/lib/api');
}

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
      setPending(true);

      // The optimistic flip and its revert live in `toggleMute`, so the pair is
      // exercised by the test suite rather than only by this component.
      //
      // ★ THE TRANSPORT IS LOADED INSIDE THE HANDLER, NOT IMPORTED AT THE TOP.
      //
      // `src/lib/api.ts` imports `expo-constants`, which pulls
      // `expo-modules-core` — a native module the Node test runner cannot load.
      // A static import would make this component unrenderable in the UI suite,
      // and the mounted-render assertions are the ones that catch a switch that
      // draws correctly and does nothing.
      const { apiRequest, ApiFailure } = await loadTransport();

      const result = await toggleMute({
        eventId,
        userId: await getStoredUserId(),
        next,
        onChange,
        request: apiRequest,
        messageKeyOf: (error) => (error instanceof ApiFailure ? error.messageKey : null),
      });

      if (!result.ok) setErrorKey(result.messageKey);
      setPending(false);
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
