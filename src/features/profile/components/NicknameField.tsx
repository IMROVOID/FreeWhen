/**
 * The nickname field, shared by the first-launch gate and the Settings row.
 *
 * One component so the two places cannot disagree about the bounds, the trim, the
 * label or the error. `validateNickname` is the single source for the rule; the
 * server applies the same 1-30 bound on its side.
 *
 * ★ IT PREVIEWS THE COLOUR.
 *
 * The colour is derived from the name, so showing it as the person types is the
 * only honest way to present it: they are not choosing a colour, they are seeing
 * which one their name has. A colour picker here would be a lie about what is
 * stored, because nothing is.
 */

import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Input } from '@/src/components/ui/Input';
import { Text } from '@/src/components/ui/Text';
import { colorForNickname } from '@/src/features/profile/services/nickname-color';
import { validateNickname } from '@/src/features/profile/services/profile';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface NicknameFieldProps {
  value: string;
  onChangeText: (next: string) => void;
  /** Shown under the field. A catalogue key resolution is the caller's job. */
  error?: string | null;
  /** Hidden when the caller renders its own preview (the gate does). */
  showColorPreview?: boolean;
  testID?: string;
}

export function NicknameField({
  value,
  onChangeText,
  error,
  showColorPreview = true,
  testID = 'nickname-field',
}: NicknameFieldProps) {
  const { t: theme } = useTheme();
  const { t } = useTranslation();

  const trimmed = value.trim();
  const colour = trimmed.length > 0 ? colorForNickname(trimmed) : theme.textFaint;

  return (
    <View style={styles.container}>
      <Input
        value={value}
        onChangeText={onChangeText}
        label={t('profile.nicknameLabel')}
        error={error ?? undefined}
        testID={testID}
      />

      {showColorPreview ? (
        <View style={styles.previewRow}>
          <Text variant="body" color={colour} style={styles.previewName}>
            {trimmed.length > 0 ? trimmed : t('profile.nicknamePlaceholder')}
          </Text>
          <Text variant="caption" color={theme.textMuted}>
            {t('profile.nicknameColorHint')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Whether the typed value may be submitted. */
export function nicknameErrorKey(value: string): string | null {
  const result = validateNickname(value);
  return result.ok ? null : result.messageKey;
}

const styles = StyleSheet.create({
  container: {
    gap: space[2],
  },
  previewRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space[2],
    justifyContent: 'space-between',
    borderRadius: radius.sm,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  previewName: {
    flexShrink: 1,
  },
});
