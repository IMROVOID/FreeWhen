/**
 * S4's form — the acquisition screen (Plan 05 Task 9, PRD-11 S4).
 *
 * ★ ONE FIELD. NOT TWO.
 *
 * Every additional input between the link tap and the first vote costs
 * acquisition (PRD-11 §4.2, the twenty-second rule). Adding a field here is a
 * product regression, not a feature, and the component is kept small partly so
 * that is obvious.
 *
 * ★ NO PERMISSION PROMPTS LIVE ON THIS PATH.
 *
 * Not on mount, not on submit. Location is offered on S5, after the participant
 * is already in — which is what makes FR-1.22 and Apple §5.1.2(i) hold even when
 * the OS prompt is denied.
 */

import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Text } from '@/src/components/ui/Text';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import { DISPLAY_NAME_MAX } from '@/src/types/event';

export interface JoinFormProps {
  title: string;
  participantCount: number;
  name: string;
  onChangeName: (value: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  /** A catalogue key for a field error, or `null`. */
  errorKey?: string | null;
  /** The chatty greeting for someone who has been here before (FR-1.20). */
  isReturning?: boolean;
  testID?: string;
}

export function JoinForm({
  title,
  participantCount,
  name,
  onChangeName,
  onSubmit,
  isSubmitting,
  errorKey,
  isReturning = false,
  testID,
}: JoinFormProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  const canSubmit = name.trim().length > 0 && !isSubmitting;

  return (
    <View testID={testID} style={styles.container}>
      <Text variant="h1" align="start">
        {title}
      </Text>

      <Text variant="body" color={theme.textMuted} align="start" numeric style={styles.count}>
        {t('join.participantCount', { count: participantCount })}
      </Text>

      {isReturning && (
        <Text variant="caption" color={theme.success} align="start">
          {t('join.returning')}
        </Text>
      )}

      <Input
        value={name}
        onChangeText={onChangeName}
        label={t('join.nameLabel')}
        error={errorKey ? t(errorKey) : undefined}
        testID="join-name-input"
        style={styles.field}
      />

      <Button
        label={isSubmitting ? t('join.submitting') : t('join.submit')}
        onPress={onSubmit}
        disabled={!canSubmit}
        loading={isSubmitting}
        variant="primary"
        testID="join-submit"
      />

      {/* One line, not a modal (FR-1.18): the guest must be able to dismiss
          this idea by reading it, not by tapping through it. */}
      <Text variant="caption" color={theme.textFaint} align="start" style={styles.warning}>
        {t('join.deviceWarning')}
      </Text>

      <Text variant="caption" color={theme.textFaint} align="start" style={styles.limit}>
        {/* The counter is the only hint that 30 is the maximum; an error after
            typing is a worse way to learn it. */}
        {name.length}/{DISPLAY_NAME_MAX}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space[1],
  },
  count: {
    marginTop: space[2],
  },
  field: {
    marginTop: space[5],
  },
  warning: {
    marginTop: space[4],
  },
  limit: {
    marginTop: space[2],
  },
});
