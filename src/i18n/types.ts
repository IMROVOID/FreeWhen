export type Language = 'fa' | 'en';

export const LANGUAGES: readonly Language[] = ['fa', 'en'] as const;

/** Persian is the default. English is opt-in via Settings (PRD-10 D11). */
export const DEFAULT_LANGUAGE: Language = 'fa';

export const isRTL = (language: Language): boolean => language === 'fa';

/**
 * The persisted language store. Implemented per platform — `store.ts` for
 * native, `store.web.ts` for web — so the shared module never imports
 * React Native.
 */
export interface LanguageStore {
  readStoredLanguage(): Language | null;
  persistLanguage(language: Language): void;
}
