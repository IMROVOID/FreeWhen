/**
 * Switching the language — web implementation.
 *
 * ★ SAME PERSISTENCE AS NATIVE, ONE FEWER STEP.
 *
 * Native must cold-restart, because `I18nManager.forceRTL` only applies on a
 * fresh launch, so it has to warn the user. Web CAN set `dir` on a live
 * document — but every mounted route chose its direction at render, so the
 * page still has to reload. The difference is that a reload needs no dialog:
 * a prompt explaining a page refresh is worse than the refresh (PRD-18 §6
 * row 3).
 *
 * ★ THE WRITE FLUSH COMES BEFORE THE RELOAD, AND IS NOT OPTIONAL.
 *
 * A reload discards anything still in flight. Anything the user has queued but
 * the network has not accepted would be lost silently — the one failure mode a
 * language switch must never cause (AC-18.8.1). So the queue drains first, and
 * the reload happens only once it has.
 */

import { persistLanguage, readStoredLanguage } from '@/src/i18n/store';
import type { Language } from '@/src/i18n/types';
import { flushPendingWrites } from '@/src/lib/pending-writes';

/**
 * Persists the choice, drains queued writes, then reloads.
 *
 * Returns `false` when the language is already the stored one, so a caller
 * can skip its own follow-up work. The no-op case touches neither the queue
 * nor the document.
 */
export async function switchLanguage(next: Language): Promise<boolean> {
  if (readStoredLanguage() === next) return false;

  persistLanguage(next);

  // Data safety before navigation — the reload cannot be undone.
  await flushPendingWrites();

  if (typeof window !== 'undefined') {
    window.location.reload();
  }

  return true;
}
