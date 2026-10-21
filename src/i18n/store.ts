/**
 * The persisted language preference — native implementation.
 *
 * `readStoredLanguage()` is SYNCHRONOUS on purpose: the language decides the
 * app's direction, and `I18nManager.forceRTL` only takes effect on a full
 * restart (PRD-10 D11). An async read would let the first frame render in the
 * wrong direction.
 *
 * The store is a small file rather than AsyncStorage because AsyncStorage has
 * no synchronous read. The web sibling uses `localStorage`; `expo-file-system`
 * is not supported on web.
 */

import type { Language, LanguageStore } from './types';

const LANGUAGE_FILE_NAME = 'freewhen-language.txt';

export const isLanguage = (value: unknown): value is Language =>
  value === 'fa' || value === 'en';

function readLanguageFile(): string | null {
  try {
    // Required lazily so the native module is never pulled into the web bundle.
    const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
    const file = new File(Paths.document, LANGUAGE_FILE_NAME);
    if (!file.exists) return null;
    return file.textSync();
  } catch {
    return null;
  }
}

function writeLanguageFile(language: Language): void {
  try {
    const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
    const file = new File(Paths.document, LANGUAGE_FILE_NAME);
    if (file.exists) {
      file.writeSync(language);
      return;
    }
    file.create({ overwrite: true, intermediates: true });
    file.writeSync(language);
  } catch {
    // Persistence is best-effort; an unwritable store must not break startup.
  }
}

export const languageStore: LanguageStore = {
  readStoredLanguage() {
    const raw = readLanguageFile();
    return isLanguage(raw) ? raw : null;
  },

  persistLanguage(language) {
    writeLanguageFile(language);
  },
};

export function readStoredLanguage(): Language | null {
  return languageStore.readStoredLanguage();
}

export function persistLanguage(language: Language): void {
  languageStore.persistLanguage(language);
}
