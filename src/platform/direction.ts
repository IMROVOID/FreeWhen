/**
 * The direction interface.
 *
 * As with haptics, this shared file holds the interface only; the
 * implementation lives in the `.native.ts` / `.web.ts` siblings.
 */

import type { Language } from '@/src/i18n/types';

/**
 * Applies the app's text direction for a language.
 *
 * On native this sets `I18nManager`, which only takes effect after a full
 * restart (PRD-10 D11). On web it sets the document's `dir`/`lang` — but the
 * served document already carries them, because `app/+html.tsx` puts
 * direction in the markup before first paint (PRD-18 AC-18.7.1).
 */
export function applyDirection(_language: Language): void {
  // Replaced at runtime by `direction.native.ts` or `direction.web.ts`.
}
