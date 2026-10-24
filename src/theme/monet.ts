/**
 * Device Accent Colors / Material You Monet integration.
 *
 * Resolves dynamic Android Material You accent and neutral colors (Android 12+, API 31+)
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
 * Resolves wallpaper-tinted background (system_neutral1).
 */
export function resolveDeviceBg(themeName: ThemeName, fallbackBg: string): string {
  if (!isMonetSupported()) return fallbackBg;
  try {
    const token =
      themeName === 'dark'
        ? '@android:color/system_neutral1_900'
        : '@android:color/system_neutral1_50';
    return PlatformColor(token) as unknown as string;
  } catch {
    return fallbackBg;
  }
}

/**
 * Resolves wallpaper-tinted surface 1 (cards, primary containers).
 */
export function resolveDeviceSurface1(themeName: ThemeName, fallbackSurface1: string): string {
  if (!isMonetSupported()) return fallbackSurface1;
  try {
    const token =
      themeName === 'dark'
        ? '@android:color/system_neutral1_800'
        : '@android:color/system_neutral1_100';
    return PlatformColor(token) as unknown as string;
  } catch {
    return fallbackSurface1;
  }
}

/**
 * Resolves wallpaper-tinted surface 2 (inputs, raised cards).
 */
export function resolveDeviceSurface2(themeName: ThemeName, fallbackSurface2: string): string {
  if (!isMonetSupported()) return fallbackSurface2;
  try {
    const token =
      themeName === 'dark'
        ? '@android:color/system_neutral2_800'
        : '@android:color/system_neutral2_100';
    return PlatformColor(token) as unknown as string;
  } catch {
    return fallbackSurface2;
  }
}

/**
 * Resolves wallpaper-tinted surface 3 (chips, pressed states).
 */
export function resolveDeviceSurface3(themeName: ThemeName, fallbackSurface3: string): string {
  if (!isMonetSupported()) return fallbackSurface3;
  try {
    const token =
      themeName === 'dark'
        ? '@android:color/system_neutral2_700'
        : '@android:color/system_neutral2_200';
    return PlatformColor(token) as unknown as string;
  } catch {
    return fallbackSurface3;
  }
}

/**
 * Resolves wallpaper-tinted line / border token.
 */
export function resolveDeviceLine(themeName: ThemeName, fallbackLine: string): string {
  if (!isMonetSupported()) return fallbackLine;
  try {
    const token =
      themeName === 'dark'
        ? '@android:color/system_neutral2_500'
        : '@android:color/system_neutral2_400';
    return PlatformColor(token) as unknown as string;
  } catch {
    return fallbackLine;
  }
}

/**
 * Enhances a base theme with device Monet accents and wallpaper-tinted neutrals if enabled.
 */
export function applyDeviceAccent(theme: Theme, themeName: ThemeName, enabled: boolean): Theme {
  if (!enabled || !isMonetSupported()) {
    return theme;
  }

  return {
    ...theme,
    bg: resolveDeviceBg(themeName, theme.bg),
    surface1: resolveDeviceSurface1(themeName, theme.surface1),
    surface2: resolveDeviceSurface2(themeName, theme.surface2),
    surface3: resolveDeviceSurface3(themeName, theme.surface3),
    line: resolveDeviceLine(themeName, theme.line),
    primary: resolveDevicePrimary(themeName, theme.primary),
    brand: resolveDeviceBrand(themeName, theme.brand),
  };
}
