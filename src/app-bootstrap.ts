/**
 * The language bootstrap.
 *
 * This module runs at MODULE SCOPE, before any component renders, because
 * `I18nManager.forceRTL` only takes effect after a full app restart
 * (PRD-10 D11). Calling it inside a component body or a `useEffect` is too
 * late — the first frame has already rendered LTR and the user sees a broken
 * layout until a manual reload.
 *
 * The resolution RULES live in `src/i18n/resolve.ts`, which is pure and
 * testable; this module only supplies the real inputs.
 */

import * as Localization from 'expo-localization';

import { resolveLanguageFrom } from '@/src/i18n/resolve';
import { readStoredLanguage } from '@/src/i18n/store';
import type { Language } from '@/src/i18n/types';

/** The device's language code, or `undefined` when it cannot be read. */
export function deviceLanguageCode(): string | undefined {
  try {
    return Localization.getLocales()[0]?.languageCode ?? undefined;
  } catch {
    return undefined;
  }
}

/** The language the app starts in. */
export function resolveLanguage(): Language {
  return resolveLanguageFrom({
    stored: readStoredLanguage(),
    deviceLanguageCode: deviceLanguageCode(),
  });
}

export { resolveLanguageFrom };
