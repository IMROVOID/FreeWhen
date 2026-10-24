import { useColorScheme } from 'react-native';

import { themes, type Theme, type ThemeName } from './tokens';
import { useAppearanceStore } from './appearance-store';
import { applyDeviceAccent } from './monet';

/**
 * Dynamic styles go through `useTheme()`; static styles stay in
 * `StyleSheet.create` but still reference tokens (Style Guide §13).
 */
export function useTheme(): { t: Theme; name: ThemeName } {
  const system = useColorScheme() ?? 'dark';
  const override = useAppearanceStore((s) => s.themePreference);
  const useDeviceAccent = useAppearanceStore((s) => s.useDeviceAccent);

  const name: ThemeName = override === 'system' ? (system === 'light' ? 'light' : 'dark') : override;
  const baseTheme = themes[name];
  const t = applyDeviceAccent(baseTheme, name, useDeviceAccent);

  return { t, name };
}
