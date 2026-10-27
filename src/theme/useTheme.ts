import { Platform, useColorScheme } from 'react-native';

import { themes, type Theme, type ThemeName } from './tokens';
import { useAppearanceStore } from './appearance-store';
import { applyDeviceAccent } from './monet';
import { resolveThemeName } from './resolve-theme-name';

export { resolveThemeName } from './resolve-theme-name';

/**
 * Dynamic styles go through `useTheme()`; static styles stay in
 * `StyleSheet.create` but still reference tokens (Style Guide §13).
 *
 * ★ THE SCHEME IS PASSED THROUGH, NOT DEFAULTED HERE.
 *
 * `useColorScheme() ?? 'dark'` was dead code: react-native-web returns the
 * string `'light'` when its media query is null, which is the case during the
 * static export where there is no `window`. Every server-rendered page was
 * painted light as a result. `resolveThemeName` treats an unresolved scheme as
 * dark, which is what Style Guide §0.1 #3 requires and what the canvas CSS in
 * `app/+html.tsx` already paints.
 */
export function useTheme(): { t: Theme; name: ThemeName } {
  const system = useColorScheme();
  const override = useAppearanceStore((s) => s.themePreference);
  const useDeviceAccent = useAppearanceStore((s) => s.useDeviceAccent);

  /**
   * Whether the platform actually observed a preference.
   *
   * On web the hook asks `window.matchMedia`. During the static export there is
   * no `window`, so react-native-web answers with the default `'light'` — a
   * value that LOOKS like an observation and is not. Treating it as unknown is
   * what stops the export from baking a cream page for dark-mode users.
   *
   * Native always has an answer, so it is trusted there.
   */
  const schemeKnown = Platform.OS !== 'web' || typeof window !== 'undefined';

  const name = resolveThemeName(system, override, schemeKnown);
  const baseTheme = themes[name];
  const t = applyDeviceAccent(baseTheme, name, useDeviceAccent);

  return { t, name };
}
