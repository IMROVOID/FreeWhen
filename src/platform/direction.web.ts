import type { Language } from '@/src/i18n/types';

/**
 * Applies a language's direction to the document.
 *
 * ★ THE EXPORTED DOCUMENT IS STAMPED AT BUILD TIME, SO IT MUST BE CORRECTED.
 *
 * `app/+html.tsx` runs in Node during `expo export`, where there is no
 * `localStorage`, so every page leaves the build with the BUILD-time language's
 * `dir`. A visitor who has chosen English then reloaded got `dir="rtl"` again —
 * the reported "the web doesn't turn English". This is called on boot (before
 * first paint, from the module scope of the root layout) and on every switch, so
 * the attribute always matches the catalogue actually rendering.
 */
export function applyDirection(language: Language): void {
  if (typeof document === 'undefined') return;

  const dir = language === 'fa' ? 'rtl' : 'ltr';
  const root = document.documentElement;

  if (root.getAttribute('dir') !== dir) root.setAttribute('dir', dir);
  if (root.getAttribute('lang') !== language) root.setAttribute('lang', language);
}
