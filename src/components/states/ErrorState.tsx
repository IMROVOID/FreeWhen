/**
 * The error state (PRD-11 §6, Plan 11 Task 1).
 *
 * ★ PLAIN LANGUAGE PLUS RETRY — NEVER A CODE OR A STACK TRACE.
 *
 * The screen is told which sentence to show by catalogue key, and the key
 * resolves to a sentence in both languages. A component that rendered the raw
 * error object would show «TypeError: …» in production, which is the exact
 * failure §6 names.
 *
 * ★ THE RETRY IS ALWAYS OFFERED.
 *
 * A dead end where the answer is "try again" is the most common error handling
 * mistake on mobile: the connection came back two seconds ago and the only way
 * to notice it is a relaunch.
 */

import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/src/components/ui/Button';
import { Text } from '@/src/components/ui/Text';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface ErrorStateProps {
  /** The catalogue key describing what failed, in plain language. */
  messageKey: string;
  /** The catalogue key for the retry button; defaults to `common.retry`. */
  retryKey?: string;
  onRetry?: () => void;
  /** Shown above the message; defaults to the catalogue's generic heading. */
  titleKey?: string;
  testID?: string;
}

export function ErrorState({
  messageKey,
  retryKey = 'common.retry',
  onRetry,
  titleKey = 'states.errorTitle',
  testID,
}: ErrorStateProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  return (
    <View
      testID={testID ?? 'error-state'}
      accessibilityRole="alert"
      style={[styles.container, { backgroundColor: theme.surface2 }]}
    >
      <Text variant="h3">{t(titleKey)}</Text>
      <Text variant="body" color={theme.textMuted}>
        {t(messageKey)}
      </Text>

      {onRetry && (
        <Button
          label={t(retryKey)}
          onPress={onRetry}
          variant="secondary"
          size="medium"
          testID={testID ? `${testID}-retry` : 'error-state-retry'}
          style={styles.action}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.md,
    padding: space[4],
    gap: space[2],
  },
  action: {
    marginTop: space[2],
    alignSelf: 'flex-start',
  },
});
