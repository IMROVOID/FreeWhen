/**
 * The permission-denied state (PRD-11 §6, Plan 11 Task 8).
 *
 * ★ IT DEGRADES WITH A WORKING ALTERNATIVE, NEVER A BLOCKED PATH.
 *
 * The location case is the one that matters: a denied permission must offer
 * manual entry at equal prominence, because manual entry is not a consolation
 * message — it is the route that completes the flow (§6, B6).
 *
 * ★ THE ALTERNATIVE IS A NODE.
 *
 * Each caller's alternative is a real control — the manual area field, the area
 * picker — so this component supplies the framing and the sentence, and the
 * caller supplies the working route.
 */

import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text } from '@/src/components/ui/Text';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface PermissionDeniedStateProps {
  /** The catalogue key explaining what was not granted. */
  messageKey?: string;
  /** The working route the user still has. */
  alternative: React.ReactNode;
  /** The catalogue key above the alternative; defaults to the manual-entry line. */
  alternativeLabelKey?: string;
  testID?: string;
}

export function PermissionDeniedState({
  messageKey = 'permission.locationDenied',
  alternative,
  alternativeLabelKey = 'permission.manualAlternative',
  testID,
}: PermissionDeniedStateProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  return (
    <View
      testID={testID ?? 'permission-denied'}
      accessibilityRole="summary"
      style={[styles.container, { backgroundColor: theme.surface2 }]}
    >
      <Text variant="h3">{t('permission.title')}</Text>
      <Text variant="body" color={theme.textMuted}>
        {t(messageKey)}
      </Text>

      <View style={styles.alternative}>
        <Text variant="caption" color={theme.text}>
          {t(alternativeLabelKey)}
        </Text>
        {alternative}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.md,
    padding: space[4],
    gap: space[2],
  },
  alternative: {
    marginTop: space[2],
    gap: space[2],
  },
});
