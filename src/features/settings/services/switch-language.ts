/**
 * Switching language.
 *
 * ★ IT IS A LIVE SWITCH, AND MAKING IT A RESTART PROMPT WAS THE BUG.
 *
 * The old contract was: persist, flush, then tell the user to close and reopen
 * the app, because `I18nManager.forceRTL` cannot reflow a mounted native tree.
 * Three things made that contract wrong in practice:
 *
 *  - The restart prompt was ADVISORY. Nobody restarts from inside a settings
 *    screen, so the app kept rendering the old catalogue while the store held
 *    the new one. Picking the original language then compared equal and returned
 *    `changed: false` — "clicking the button does nothing".
 *  - Every layout decision in this app already resolves from the i18n language
 *    (`src/platform/layout-direction.ts`), not from `I18nManager`, so nothing
 *    actually needed a cold start.
 *  - The root layout keys its navigator on the language, so the native tree is
 *    reconstructed under the new direction instead of being asked to reflow.
 *
 * ★ FLUSH BEFORE THE SWAP.
 *
 * An in-flight optimistic vote lost to a language change is a data bug that gets
 * attributed to the wrong feature (PRD-02 §6). The flush is awaited, and its
 * failure is surfaced as data rather than swallowed — but the language still
 * changes, because the user asked for it and the catalogue is not the queue.
 *
 * ★ THE MODULE IS PLATFORM-AGNOSTIC.
 *
 * It takes the flush as a callback rather than importing the mutation layer, so
 * the same service serves Settings and the join screen.
 */

import { persistLanguage, readStoredLanguage } from '@/src/i18n/store';
import { setLanguage } from '@/src/i18n';
import type { Language } from '@/src/i18n/types';

export interface SwitchLanguageOptions {
  /** Sends any queued writes. Awaited BEFORE the catalogue changes. */
  flush?: () => Promise<void>;
  /** Persists the choice; the default writes the language store. */
  persist?: (language: Language) => void;
  /** The language currently on screen. */
  current: Language;
}

export interface SwitchLanguageResult {
  /** False when the choice matched what is already shown. */
  changed: boolean;
  /** The language now active AND persisted. */
  language: Language;
  /**
   * Always `false`.
   *
   * Kept in the result so a caller reading the shape does not have to know that
   * the restart went away — and so the field's absence is not mistaken for a
   * missed branch.
   */
  restartRequired: boolean;
  /** Always empty: there is no prompt to explain. */
  reasonKey: string;
  /** A catalogue key when the flush failed; the language still changed. */
  flushErrorKey: string | null;
}

/** The other language, for a two-value control. */
export function otherLanguage(current: Language): Language {
  return current === 'fa' ? 'en' : 'fa';
}

/**
 * Persists the choice, flushes queued writes, then switches the live language.
 *
 * Order is the contract: persist first (so a crash between the steps still lands
 * in the chosen language), then flush, then swap. A flush failure keeps both the
 * persisted choice and the swap — the user asked for the language — and reports
 * the error so the caller can let them retry the send.
 */
export async function switchLanguage({
  current,
  flush,
  persist = persistLanguage,
}: SwitchLanguageOptions): Promise<SwitchLanguageResult> {
  const next = otherLanguage(current);

  if (next === current && readStoredLanguage() === current) {
    return {
      changed: false,
      language: current,
      restartRequired: false,
      reasonKey: '',
      flushErrorKey: null,
    };
  }

  persist(next);

  let flushErrorKey: string | null = null;
  try {
    await flush?.();
  } catch {
    flushErrorKey = 'errors.unknown';
  }

  setLanguage(next);

  return {
    changed: true,
    language: next,
    restartRequired: false,
    reasonKey: '',
    flushErrorKey,
  };
}

/** Picks a language directly, for a control that names one rather than toggling. */
export async function chooseLanguage(
  target: Language,
  options: Omit<SwitchLanguageOptions, 'current'> & { current: Language },
): Promise<SwitchLanguageResult> {
  if (target === options.current) {
    return {
      changed: false,
      language: options.current,
      restartRequired: false,
      reasonKey: '',
      flushErrorKey: null,
    };
  }

  const persist = options.persist ?? persistLanguage;
  persist(target);

  let flushErrorKey: string | null = null;
  try {
    await options.flush?.();
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
