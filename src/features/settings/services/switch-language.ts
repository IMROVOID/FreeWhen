/**
 * Switching language (PRD-11 S15, Plan 11 Task 6a).
 *
 * ★ IT CANNOT BE A LIVE SWITCH, AND PRETENDING OTHERWISE IS WORSE THAN SAYING SO.
 *
 * `fa ↔ en` changes the app's layout DIRECTION, and `I18nManager.forceRTL` does
 * not apply to a live view tree — the native views were already measured for the
 * old direction (PRD-10 D11A, §15.9). A segmented control that appears instant
 * and then renders English text in a Persian layout is worse than an honest
 * restart prompt, so the order here is fixed: persist, flush, confirm with the
 * REASON stated, then rely on the documented restart.
 *
 * ★ FLUSH BEFORE THE RELOAD, NEVER AFTER.
 *
 * An in-flight optimistic vote lost to a language change is a data bug that
 * gets attributed to the wrong feature (PRD-02 §6). The flush is awaited and its
 * failure is surfaced BEFORE the user is invited to restart, because a restart
 * over an unflushed write is exactly that bug.
 *
 * ★ THE MODULE IS PLATFORM-AGNOSTIC.
 *
 * It takes the flush as a callback rather than importing the mutation layer, so
 * the same service serves Settings and the join screen, and the web sibling
 * (owned by Phase 18) can reuse it without a native import.
 */

import { persistLanguage, readStoredLanguage } from '@/src/i18n/store';
import type { Language } from '@/src/i18n/types';

export interface SwitchLanguageOptions {
  /** Sends any queued writes. Awaited BEFORE the restart is offered. */
  flush?: () => Promise<void>;
  /** Persists the choice; the default writes the language store. */
  persist?: (language: Language) => void;
  /** The language currently on screen. */
  current: Language;
}

export interface SwitchLanguageResult {
  /** False when the choice matched what is already shown. */
  changed: boolean;
  /** The language now persisted. */
  language: Language;
  /**
   * Whether the user must restart for the change to take effect.
   *
   * Always `true` for a real change on native: direction cannot be applied to a
   * live tree. It is surfaced as data rather than assumed so the screen's copy
   * and the service can never disagree.
   */
  restartRequired: boolean;
  /** Why the restart is required — the reason the prompt must state. */
  reasonKey: string;
  /** A catalogue key when the flush failed; the restart must not be offered. */
  flushErrorKey: string | null;
}

/**
 * Persists the choice and flushes queued writes.
 *
 * Order is the contract: persist first (so a crash between the steps still lands
 * in the chosen language), then flush. A flush failure keeps the persisted
 * choice — the user asked for it — but reports the error so the caller can hold
 * the restart and let them retry the send.
 */
export async function switchLanguage({
  current,
  flush,
  persist = persistLanguage,
}: SwitchLanguageOptions): Promise<SwitchLanguageResult> {
  if (current === readStoredLanguage()) {
    // Nothing to do: re-selecting the active language must not prompt for a
    // restart, because a pointless restart reads as a crash.
    return {
      changed: false,
      language: current,
      restartRequired: false,
      reasonKey: '',
      flushErrorKey: null,
    };
  }

  const next: Language = current === 'fa' ? 'en' : 'fa';

  persist(next);

  try {
    await flush?.();
  } catch {
    return {
      changed: true,
      language: next,
      restartRequired: false,
      reasonKey: '',
      flushErrorKey: 'errors.unknown',
    };
  }

  return {
    changed: true,
    language: next,
    restartRequired: true,
    reasonKey: next === 'en' ? 'states.languageRestartReasonEn' : 'states.languageRestartReasonFa',
    flushErrorKey: null,
  };
}

/**
 * The restart prompt's body (PRD-11 S15).
 *
 * ★ THE PROMPT MUST STATE THE REASON.
 *
 * "Restart required" with no explanation reads as a crash or a bug. The reason is
 * the direction change, said in the language the user is switching TO's terms —
 * so it is a catalogue key, resolved by the caller in whichever language is on
 * screen when the prompt appears.
 */
export function restartPromptKey(language: Language): string {
  return language === 'en' ? 'states.languageRestartReasonEn' : 'states.languageRestartReasonFa';
}
