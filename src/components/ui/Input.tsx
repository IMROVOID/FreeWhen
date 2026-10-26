import { useState } from 'react';
import { StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text } from './Text';
import { fonts, isPersian } from '@/src/theme/fonts';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface InputProps {
  value: string;
  onChangeText: (value: string) => void;
  label: string;
  error?: string;
  secureTextEntry?: boolean;
  /**
   * Grows to a paragraph field.
   *
   * A 300-character comment does not fit a single line, and a one-line field
   * makes the user scroll horizontally through their own sentence.
   */
  multiline?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A text field with a floating label and a 2px strong border on focus
 * (Style Guide §11.5).
 */
export function Input({
  value,
  onChangeText,
  label,
  error,
  secureTextEntry = false,
  multiline = false,
  testID,
  style,
}: InputProps) {
  const { t } = useTheme();
  const { i18n } = useTranslation();
  const [isFocused, setIsFocused] = useState(false);

  const isFa = i18n.language === 'fa' || isPersian(value || label);
  const hasError = Boolean(error);
  const isFloating = isFocused || value.length > 0;

  const borderColor = hasError ? t.danger : isFocused ? t.text : 'transparent';
  const borderWidth = hasError || isFocused ? 2 : 0;

  return (
    <View style={[styles.container, style]}>
      <View
        style={[
          styles.field,
          { backgroundColor: t.surface2, borderColor, borderWidth },
        ]}
      >
        {isFloating && (
          <Text variant="caption" color={hasError ? t.danger : t.textMuted}>
            {label}
          </Text>
        )}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={isFloating ? undefined : label}
          placeholderTextColor={t.textFaint}
          secureTextEntry={secureTextEntry}
          multiline={multiline}
          testID={testID}
          accessibilityLabel={label}
          style={[
            styles.input,
            multiline ? styles.inputMultiline : null,
            hiddenOutline,
            {
              color: t.text,
              fontFamily: isFa ? fonts.persian[500] : fonts.latin[500],
              // `start` rather than a literal side: the field already declares
              // `direction` from its content, so the caret follows the text
              // instead of a hardcoded side that would not mirror.
              textAlign: 'start',
              writingDirection: isFa ? 'rtl' : 'ltr',
            },
          ]}
        />
      </View>

      {hasError && (
        <Text variant="caption" color={t.danger}>
          {error}
        </Text>
      )}
    </View>
  );
}

/**
 * ★ ONLY THE COMPONENT'S OWN FOCUS BORDER.
 *
 * On web the `<input>` drew the browser's default outline AND the field's
 * styled `borderWidth: 2` on focus, so a black box framed the themed one.
 *
 * Two constraints shape this: `outline` is a rejected shortform in
 * react-native-web's validator (longhands only), and React Native types
 * `outlineStyle` without a `none` member, so the value is asserted locally.
 * Native ignores both keys.
 */
const hiddenOutline = {
  outlineStyle: 'none',
  outlineWidth: 0,
} as unknown as import('react-native').TextStyle;

const styles = StyleSheet.create({
  container: {
    gap: space[1],
  },
  field: {
    minHeight: 56,
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    justifyContent: 'center',
  },
  inputMultiline: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  input: {
    fontSize: 15,
    lineHeight: 22,
    // The field's own padding provides the inset; the text must not add to it.
    padding: 0,
  },
});
