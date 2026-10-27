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
  /**
   * Fills the space it is given and centres its content.
   *
   * ★ FOR A WHOLE SCREEN, NOT FOR A CARD IN A LIST.
   *
   * A full-page failure used to render as a top-aligned card, so the message sat
   * against the header with the rest of the viewport empty beneath it — the
   * layout said "there is more content below" when there was none. A list of
   * inline failures keeps the compact card, which is why this is opt-in.
   */
  centered?: boolean;
  testID?: string;
}

export function ErrorState({
  messageKey,
  retryKey = 'common.retry',
  onRetry,
  titleKey = 'states.errorTitle',
  centered = false,
  testID,
}: ErrorStateProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  return (
    <View
      testID={testID ?? 'error-state'}
      accessibilityRole="alert"
      style={[
        styles.container,
        centered && styles.centered,
        { backgroundColor: theme.surface2 },
      ]}
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
          // A centred card centres its one control; the compact card keeps the
          // button on the leading edge under the text.
          style={centered ? styles.actionCentered : styles.action}
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
  centered: {
    // `flex: 1` claims the space the screen gave it; the two centring rules put
    // the card in the middle of that space rather than at its top.
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
  },
  action: {
    marginTop: space[2],
    alignSelf: 'flex-start',
  },
  actionCentered: {
    marginTop: space[2],
    alignSelf: 'center',
  },
});
