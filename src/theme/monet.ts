/**
 * Device Accent Colors / Material You Monet integration.
 *
 * Resolves dynamic Android Material You accent colors (Android 12+, API 31+)
 * using PlatformColor, falling back gracefully to FreeWhen's vibrant palette.
 */

import { Platform, PlatformColor } from 'react-native';
import type { Theme, ThemeName } from './tokens';

/**
 * Checks if the runtime platform supports Material You dynamic coloring.
 */
export function isMonetSupported(): boolean {
  if (Platform.OS !== 'android') return false;
  const version = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  return Number.isFinite(version) && version >= 31;
}

/**
 * Resolves the primary accent color:
 * On Android 12+, uses native Monet accent color tokens.
 * In dark mode, uses system_accent1_300 for high contrast.
 * In light mode, uses system_accent1_700 for high contrast.
 */
export function resolveDevicePrimary(themeName: ThemeName, fallbackPrimary: string): string {
  if (!isMonetSupported()) {
    return fallbackPrimary;
  }

  try {
    const token =
      themeName === 'dark'
        ? '@android:color/system_accent1_300'
        : '@android:color/system_accent1_700';

    // PlatformColor returns an OpaqueColorValue which React Native styles accept
    return PlatformColor(token) as unknown as string;
  } catch {
    return fallbackPrimary;
  }
}

/**
 * Resolves the secondary / brand accent color.
 */
export function resolveDeviceBrand(themeName: ThemeName, fallbackBrand: string): string {
  if (!isMonetSupported()) {
    return fallbackBrand;
  }

  try {
    const token =
      themeName === 'dark'
        ? '@android:color/system_accent2_300'
        : '@android:color/system_accent2_700';

    return PlatformColor(token) as unknown as string;
  } catch {
    return fallbackBrand;
  }
}

/**
 * Enhances a base theme with device Monet accents if enabled.
 */
export function applyDeviceAccent(theme: Theme, themeName: ThemeName, enabled: boolean): Theme {
  if (!enabled || !isMonetSupported()) {
    return theme;
  }

  return {
    ...theme,
    primary: resolveDevicePrimary(themeName, theme.primary),
    brand: resolveDeviceBrand(themeName, theme.brand),
  };
}
