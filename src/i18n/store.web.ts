/**
 * The persisted language preference — web implementation.
 *
 * `localStorage` is the only synchronous store available on a browser, and it
 * is absent during a static export, so every access is guarded.
 */

import type { Language, LanguageStore } from './types';

const WEB_STORAGE_KEY = 'freewhen.language';

export const isLanguage = (value: unknown): value is Language =>
  value === 'fa' || value === 'en';

function readWebStorage(): string | null {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    return storage?.getItem(WEB_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeWebStorage(language: Language): void {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    storage?.setItem(WEB_STORAGE_KEY, language);
  } catch {
    // Persistence is best-effort, as above.
  }
}

export const languageStore: LanguageStore = {
  readStoredLanguage() {
    const raw = readWebStorage();
    return isLanguage(raw) ? raw : null;
  },

  persistLanguage(language) {
    writeWebStorage(language);
  },
};

export function readStoredLanguage(): Language | null {
  return languageStore.readStoredLanguage();
}

export function persistLanguage(language: Language): void {
  languageStore.persistLanguage(language);
}
