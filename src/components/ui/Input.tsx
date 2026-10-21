import { useState } from 'react';
import { StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from './Text';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface InputProps {
  value: string;
  onChangeText: (value: string) => void;
  label: string;
  error?: string;
  secureTextEntry?: boolean;
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
  testID,
  style,
}: InputProps) {
  const { t } = useTheme();
  const [isFocused, setIsFocused] = useState(false);

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
          placeholder={isFloating ? undefined : label}          placeholderTextColor={t.textFaint}
          secureTextEntry={secureTextEntry}
          testID={testID}
          accessibilityLabel={label}
          style={[styles.input, { color: t.text }]}
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
  input: {
    fontSize: 15,
    lineHeight: 22,
    // The field's own padding provides the inset; the text must not add to it.
    padding: 0,
  },
});
