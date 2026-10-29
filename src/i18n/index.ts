import i18next, { type TFunction } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { applyDirection } from '@/src/platform/direction';
import { DEFAULT_LANGUAGE, type Language } from './types';
import fa from './fa.json';
import en from './en.json';

export type { Language } from './types';
export { DEFAULT_LANGUAGE, isRTL } from './types';

export const resources = {
  fa: { translation: fa },
  en: { translation: en },
} as const;

/**
 * Initialises i18next. Both catalogues are always bundled — English is a
 * shipping mode, not a fallback (PRD-10 D11A).
 *
 * `initAsync: false` makes the resources available synchronously, which the
 * language bootstrap depends on: the first render must already have a
 * catalogue, not a promise.
 */
export function initI18n(language: Language = DEFAULT_LANGUAGE): void {
  if (i18next.isInitialized) {
    void i18next.changeLanguage(language);
    return;
  }

  // `initReactI18next` binds this instance to react-i18next, so
  // `useTranslation` resolves the same catalogues the non-React helpers do.
  i18next.use(initReactI18next);

  void i18next.init({
    resources,
    lng: language,
    fallbackLng: 'fa',
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    initAsync: false,
    react: { useSuspense: false },
  });
}

/**
 * Switches the live language, catalogues and direction together.
 *
 * ★ THIS IS THE ONLY WRITER, AND THAT IS THE FIX.
 *
 * Switching used to persist the choice and then ask the user to restart, because
 * `I18nManager.forceRTL` cannot reflow a mounted native tree. Three things were
 * wrong with that:
 *
 *  1. On native the directory the catalogue was read from never changed, so the
 *     choice had no visible effect until the app was killed — and picking the
 *     original language again was then a no-op, which read as a dead button.
 *  2. On web the page reloaded and re-downloaded the same statically-exported
 *     document, whose `dir` was stamped at build time. The reload therefore
 *     restored the OLD direction: "the web does not turn English".
 *  3. Every layout decision in this app already goes through the i18n language
 *     (`isRtlLayout`, `Text`'s per-node `dir`, `useLayoutDirection`), so the
 *     restart was defensive rather than required.
 *
 * Changing i18next re-renders every translated consumer, and `applyDirection`
 * sets the document attribute and the native manager for the primitives that
 * read them. The root layout keys its navigator on the language so the native
 * view tree is rebuilt for the new direction instead of being reflowed in place.
 *
 * Returns the language now active, so a caller cannot report a different one.
 */
export function setLanguage(language: Language): Language {
  if (!i18next.isInitialized) {
    initI18n(language);
  } else if (i18next.language !== language) {
    void i18next.changeLanguage(language);
  }

  applyDirection(language);

  return language;
}

/** The active language, for code that must not depend on React. */
export function currentLanguage(): Language {
  const lng = i18next.language;
  return lng === 'en' ? 'en' : 'fa';
}

/** A translator bound to one locale, for non-React call sites. */
export function translatorFor(language: Language): TFunction {
  return i18next.getFixedT(language);
}

export default i18next;
