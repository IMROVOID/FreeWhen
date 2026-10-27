/**
 * The theme picker for Settings (Style Guide §0.1 #3).
 *
 * ★ THE STORE FIELD HAD NO WRITER.
 *
 * `useAppearanceStore` shipped `themePreference` with a `'system'` default and
 * `useTheme` resolved it on every render, but nothing in the product ever set it
 * — so the field was dead and every user was stuck on whatever their OS said.
 * This is the writer.
 *
 * ★ AUTO IS THE MIDDLE, AND IT IS THE DEFAULT.
 *
 * Three mutually exclusive choices laid out Light · Auto · Dark read middle-out,
 * which is what a three-way control means: the default in the centre and the two
 * explicit overrides on either side. Auto in an end position would look like the
 * least important of the three, and it is the most common.
 *
 * ★ ICONS, NOT WORDS.
 *
 * The rail is three segments wide; "Auto / Light / Dark" in three languages made
 * it the widest control on a screen of narrow pills. The words survive as each
 * segment's accessible name, so a screen reader still hears them.
 */

import { Sun, CircleHalf, Moon } from 'phosphor-react-native';
import { useTranslation } from 'react-i18next';

import { SegmentedControl, type SegmentedOption } from '@/src/components/ui/Chip';
import { useAppearanceStore } from '@/src/theme/appearance-store';
import type { ThemePreference } from '@/src/theme/appearance-store';

export interface ThemeControlProps {
  testID?: string;
}

export function ThemeControl({ testID }: ThemeControlProps) {
  const { t } = useTranslation();
  const preference = useAppearanceStore((s) => s.themePreference);
  const setPreference = useAppearanceStore((s) => s.setThemePreference);

  const options: SegmentedOption[] = [
    {
      value: 'light',
      label: t('settings.themeLight'),
      icon: (props) => <Sun {...props} />,
    },
    {
      value: 'system',
      label: t('settings.themeSystem'),
      icon: (props) => <CircleHalf {...props} />,
    },
    {
      value: 'dark',
      label: t('settings.themeDark'),
      icon: (props) => <Moon {...props} />,
    },
  ];

  return (
    <SegmentedControl
      options={options}
      value={preference}
      onChange={(next) => setPreference(next as ThemePreference)}
      testID={testID}
      testIDPrefix={testID}
    />
  );
}
