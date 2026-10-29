/**
 * Switching the language — web implementation.
 *
 * ★ NO RELOAD, FOR THE SAME REASON NATIVE HAS NO RESTART.
 *
 * The web build used to persist the choice, drain queued writes, then
 * `window.location.reload()`. That looked safe because "web can set `dir` on a
 * live document" — but the document it reloaded was the STATICALLY EXPORTED one,
 * stamped `dir="rtl" lang="fa"` at build time by `app/+html.tsx` (which runs in
 * Node, with no `localStorage`). So the reload faithfully restored the OLD
 * language: the reported "when I click English it restarts but stays on
 * Persian".
 *
 * `setLanguage` changes the i18next catalogue, applies the direction to the
 * document, and lets `useLayoutDirection` re-render every consumer — the same
 * live path native uses. The write flush still comes first, because a reload
 * used to be the only thing that could discard an in-flight vote and a live
 * switch must not inherit that risk.
 *
 * ★ THIS FILE MUST EXPORT THE SAME SHAPE AS ITS NATIVE SIBLING.
 *
 * It did not. `switch-language.ts` grew `chooseLanguage`, the web sibling kept
 * only `switchLanguage(next)`, and Settings imports `chooseLanguage` — so on the
 * web build the import resolved to `undefined` and the first tap threw
 * `undefined is not a function` inside the component's `async` handler. The
 * `await` never settled, so `busy` stayed true and BOTH options rendered
 * `aria-disabled="true"`: the language control was dead for the rest of the
 * session. Metro picks a file by NAME, so a shape that drifts between the two is
 * a platform-only crash with no type error — `tsc` sees this file, not that one.
 */

import { persistLanguage, readStoredLanguage } from '@/src/i18n/store';
import { setLanguage } from '@/src/i18n';
import type { Language } from '@/src/i18n/types';
import { flushPendingWrites } from '@/src/lib/pending-writes';

export interface SwitchLanguageOptions {
  /** Sends any queued writes. Awaited BEFORE the catalogue changes. */
  flush?: () => Promise<void>;
  /** Persists the choice; the default writes the language store. */
  persist?: (language: Language) => void;
  /** The language currently on screen. */
  current: Language;
}

export interface SwitchLanguageResult {
  changed: boolean;
  language: Language;
  /**
   * Always `false`.
   *
   * Kept so the result shape matches the native service — a caller must not have
   * to know which platform it is running on to read this.
   */
  restartRequired: boolean;
  reasonKey: string;
  flushErrorKey: string | null;
}

/** The other language, for a two-value control. */
export function otherLanguage(current: Language): Language {
  return current === 'fa' ? 'en' : 'fa';
}

/**
 * Persists the choice, drains queued writes, then swaps the catalogue.
 *
 * The default flush is the real queue; a caller may inject one (the tests do).
 */
export async function switchLanguage({
  current,
  flush = flushPendingWrites,
  persist = persistLanguage,
}: SwitchLanguageOptions): Promise<SwitchLanguageResult> {
  return chooseLanguageImpl(otherLanguage(current), { current, flush, persist });
}

/** Picks a language directly, for a control that names one rather than toggling. */
export async function chooseLanguage(
  target: Language,
  options: SwitchLanguageOptions,
): Promise<SwitchLanguageResult> {
  return chooseLanguageImpl(target, {
    ...options,
    flush: options.flush ?? flushPendingWrites,
  });
}

async function chooseLanguageImpl(
  target: Language,
  { current, flush = flushPendingWrites, persist = persistLanguage }: SwitchLanguageOptions,
): Promise<SwitchLanguageResult> {
  if (target === current) {
    return {
      changed: false,
      language: current,
      restartRequired: false,
      reasonKey: '',
      flushErrorKey: null,
    };
  }

  persist(target);

  let flushErrorKey: string | null = null;
  try {
    await flush();
  } catch {
    flushErrorKey = 'errors.unknown';
  }

  setLanguage(target);

  return {
    changed: true,
    language: target,
    restartRequired: false,
    reasonKey: '',
    flushErrorKey,
  };
}

/** Kept for a caller reading the stored value directly (the no-op guard). */
export { readStoredLanguage };
