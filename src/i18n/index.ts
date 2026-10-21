import i18next, { type TFunction } from 'i18next';
import { initReactI18next } from 'react-i18next';

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
