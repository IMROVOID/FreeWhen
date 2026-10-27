/**
 * A text field, in the direction its user reads.
 *
 * ★ THE FIELD'S DIRECTION IS A PROPERTY OF THE INTERFACE, NOT OF ITS VALUE.
 *
 * This used to decide with `isPersian(value || label)`. An EMPTY field therefore
 * had no Persian character to find, so it fell back to LTR: the caret sat on
 * the wrong side and the placeholder was pinned left until enough Persian had
 * been typed for the guess to flip. The invite-address box («کد یا نشانی
 * دعوت») and the event-name box on the create screen are both empty by
 * definition when the user arrives, which is why they looked broken and the
 * filled ones did not.
 *
 * The locale already knows the answer, so it is asked. A field in a Persian
 * interface is rtl whether or not it has been typed in — and an invite code, a
 * URL or a Latin name entered into it still reads correctly inside the field's
 * own bidi context.
 *
 * ★ BOTH `dir` AND `writingDirection` ARE NEEDED, FOR DIFFERENT PLATFORMS.
 *
 * `writingDirection` is a React Native style: native honours it for the caret
 * and the default alignment. On web, `react-native-web` reads `dir` from the
 * PROP and emits the DOM attribute; a style alone leaves the node `dir="auto"`
 * and the browser then infers from the first strong character, which is an
 * empty string on mount. So the prop is declared here and the style is kept for
 * native.
 */

import { useState } from 'react';
import { StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text } from './Text';
import { fonts } from '@/src/theme/fonts';
import { isRtlLayout } from '@/src/platform/layout-direction';
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
  /**
   * Forces the direction of the CONTENT when it is not the interface's.
   *
   * A phone number, a code or an email address is a left-to-right run even in a
   * Persian interface. Left unset, the field follows the interface.
   */
  direction?: 'rtl' | 'ltr';
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
  direction,
  testID,
  style,
}: InputProps) {
  const { t } = useTheme();
  const { i18n } = useTranslation();
  const [isFocused, setIsFocused] = useState(false);

  const rtl = direction ? direction === 'rtl' : isRtlLayout(i18n.language);
  const hasError = Boolean(error);
  const isFloating = isFocused || value.length > 0;

  const borderColor = hasError ? t.danger : isFocused ? t.text : 'transparent';
  const borderWidth = hasError || isFocused ? 2 : 0;

  /**
   * `react-native`'s `TextInputProps` does not declare `dir` — it is a
   * `react-native-web` extension — so the component type is widened once here
   * rather than at every call site. Native ignores the prop.
   */
  const WebTextInput = TextInput as unknown as React.ComponentType<
    React.ComponentProps<typeof TextInput> & { dir?: 'rtl' | 'ltr' }
  >;

  return (
    <View style={[styles.container, style]}>
      <View style={[styles.field, { backgroundColor: t.surface2, borderColor, borderWidth }]}>
        {isFloating && (
          <Text variant="caption" color={hasError ? t.danger : t.textMuted}>
            {label}
          </Text>
        )}
        <WebTextInput
          dir={rtl ? 'rtl' : 'ltr'}
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
              fontFamily: rtl ? fonts.persian[500] : fonts.latin[500],
              // `start` rather than a literal side: the field's `dir` decides
              // which edge that is, so the caret follows the direction instead
              // of a hardcoded side that would not mirror.
              textAlign: 'start',
              writingDirection: rtl ? 'rtl' : 'ltr',
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
