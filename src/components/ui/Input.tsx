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
import { resolveLanguageFrom } from '@/src/i18n/resolve';
import { readStoredLanguage } from '@/src/i18n/store';
import { isRtlLayout } from '@/src/platform/layout-direction';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

/**
 * The interface language, asked WITHOUT the bootstrap module.
 *
 * `src/app-bootstrap.ts` imports `expo-localization`, which pulls
 * `expo-modules-core` — a native module the Node test runner cannot load, so a
 * static import of it from here makes this component unrenderable in the UI suite.
 * `resolveLanguageFrom` plus the lazy-reading store answer the same question for
 * the cases that matter: a stored preference, else the Persian default.
 *
 * The value is consulted only when `i18n.language` is empty, which is exactly the
 * static-prerender situation described at the call site.
 */
function fallbackLanguage(): string {
  try {
    return resolveLanguageFrom({ stored: readStoredLanguage(), deviceLanguageCode: undefined });
  } catch {
    return 'fa';
  }
}

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

  /**
   * ★ THE FIELD ASKS THE RESOLVED LANGUAGE, NOT THE LIVE ONE.
   *
   * `i18n.language` is set by `initI18n`, which runs at module scope on the client
   * but is not consulted during the static export that prerenders the web document.
   * So the served markup for the join box contained `dir="ltr"` and a Latin family
   * inside a `dir="rtl"` page — the Persian placeholder was pinned to the wrong
   * edge and set in the wrong typeface.
   *
   * `fallbackLanguage()` answers the same question from the same inputs
   * (`localStorage` on web, the file store elsewhere) without depending on React
   * or on i18next having initialised.
   */
  const rtl = direction
    ? direction === 'rtl'
    : isRtlLayout(i18n.language || fallbackLanguage());
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

  /**
   * ★ THE TYPEFACE FOLLOWS THE INTERFACE; THE DIRECTION CAN FOLLOW THE CONTENT.
   *
   * These were one flag, so a `direction="ltr"` field — an invite code, an email, a
   * phone number — dropped to the Latin family on a Persian screen, while every
   * label around it stayed Vazirmatn. The field looked like a stranger in the form.
   *
   * Vazirmatn covers Latin, so a Persian interface can use it for every field
   * regardless of that field's own reading direction. The reverse is not true, so an
   * English interface keeps Jakarta.
   */
  const interfaceIsPersian = (i18n.language || fallbackLanguage()) !== 'en';
  const fieldFont = interfaceIsPersian ? fonts.persian[500] : fonts.latin[500];

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
              fontFamily: fieldFont,
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
