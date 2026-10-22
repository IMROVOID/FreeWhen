/**
 * The language control for the join screen.
 *
 * ★ WHY IT IS ON THE JOIN SCREEN AT ALL.
 *
 * A first-time English-speaking guest arrives from a link and finds a Persian
 * form. Making them hunt for Settings — which they may never open, because
 * they are one field away from joining — is the difference between a guest
 * who joins and a guest who leaves (PRD-10 D11A, PRD-11 S4).
 *
 * ★ WHY IT PROMPTS FOR A RESTART.
 *
 * The language decides the app's DIRECTION, and `I18nManager.forceRTL` only
 * takes effect on a full restart (PRD-10 D11). Switching the catalogue
 * in-place would give English text in a Persian layout — worse than either
 * language alone. So the choice is persisted and the guest is told what to
 * expect.
 *
 * The control is deliberately QUIET: a text link, not a button. It must not
 * compete with the one field and the one button that make up the funnel.
 */

import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text } from '@/src/components/ui/Text';
import { Pressy } from '@/src/components/ui/Pressy';
import { persistLanguage } from '@/src/i18n/store';
import type { Language } from '@/src/i18n/types';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface LanguageToggleProps {
  /** The language the app is currently rendering in. */
  current: Language;
  /**
   * Called with the chosen language, after it has been persisted.
   *
   * The screen owns the restart prompt; the toggle only reports the choice.
   */
  onChange: (language: Language) => void;
  testID?: string;
}

export function LanguageToggle({ current, onChange, testID }: LanguageToggleProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  const other: Language = current === 'fa' ? 'en' : 'fa';

  const choose = () => {
    persistLanguage(other);
    onChange(other);
  };

  return (
    <View style={styles.row} testID={testID}>
      <Pressy
        onPress={choose}
        accessibilityRole="button"
        accessibilityLabel={
          other === 'en' ? t('app.languageEnglish') : t('app.languagePersian')
        }
        testID="language-toggle"
      >
        <Text variant="caption" color={theme.textMuted} align="start">
          {/* The control names the language it switches TO, not the one in
              use — a guest who cannot read the current language cannot read
              a label naming it. */}
          {other === 'en' ? t('app.languageEnglish') : t('app.languagePersian')}
        </Text>
      </Pressy>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: space[4],
  },
});
