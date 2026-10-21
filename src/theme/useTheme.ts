import { useColorScheme } from 'react-native';

import { themes, type Theme, type ThemeName } from './tokens';
import { useAppearanceStore } from './appearance-store';

/**
 * Dynamic styles go through `useTheme()`; static styles stay in
 * `StyleSheet.create` but still reference tokens (Style Guide §13).
 */
export function useTheme(): { t: Theme; name: ThemeName } {
  const system = useColorScheme() ?? 'dark';
  const override = useAppearanceStore((s) => s.themePreference);

  const name: ThemeName = override === 'system' ? (system === 'light' ? 'light' : 'dark') : override;
  return { t: themes[name], name };
}
