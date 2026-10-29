/**
 * The direction the interface is currently laid out in.
 *
 * ★ ONE SOURCE OF TRUTH, AND IT IS THE LANGUAGE.
 *
 * Three implementations of this question existed and they disagreed:
 *
 *  - `I18nManager.isRTL` on native, which only changes after an OS restart, so a
 *    live switch to English left it `true` and every back chevron kept pointing
 *    the RTL way (`CaretRight` on an LTR screen).
 *  - the document's `dir` attribute on web, which the static export stamps once
 *    from the build-time language — so a runtime switch to English left the page
 *    `dir="rtl"` and this module reported RTL for an LTR interface.
 *  - the i18n locale, which is the only one that is ever actually up to date.
 *
 * The rule is now simply "Persian reads right-to-left, everything else does
 * not", read from the live i18n language. `I18nManager` and the DOM attribute
 * are OUTPUTS of a language change, never inputs to this decision.
 *
 * `useLayoutDirection()` in `./use-layout-direction` is the component-facing
 * subscription; this module stays React-free so pure modules can use it.
 */

import i18next from 'i18next';

import type { Language } from '@/src/i18n/types';

/** The live direction, as a boolean. Persian is the only right-to-left locale. */
export function isRtlLanguage(language: string | undefined): boolean {
  return language !== 'en';
}

/**
 * Whether the interface reads right-to-left right now.
 *
 * `language` defaults to the live i18n language so a caller cannot accidentally
 * pin a stale value by passing one it captured earlier.
 */
export function isRtlLayout(language?: string): boolean {
  return isRtlLanguage(language ?? i18next.language);
}

/** The back-chevron direction for a language: RTL points the other way. */
export function backIconIsRtl(language?: Language | string): boolean {
  return isRtlLayout(language === undefined ? undefined : String(language));
}

/**
 * Subscribes to direction changes, returning an unsubscribe function.
 *
 * i18next emits `languageChanged` after it has switched its own state, which is
 * the moment every `useTranslation` consumer re-renders. Subscribing here as
 * well means a component that does NOT translate — the switch knob, the
 * segmented pill — still recomputes its geometry in the same commit.
 */
export function subscribeDirection(listener: () => void): () => void {
  i18next.on('languageChanged', listener);
  return () => {
    i18next.off('languageChanged', listener);
  };
}

/** The current direction snapshot, for `useSyncExternalStore`. */
export function directionSnapshot(): boolean {
  return isRtlLayout();
}

/**
 * The server-rendering snapshot.
 *
 * During a static export there is no live language change, and `i18next` is
 * initialised from the build-time language before any component renders, so the
 * live value is also the correct one to render. Reading it directly (rather than
 * hardcoding `true`) is what keeps the exported markup honest for an English
 * build.
 */
export function directionServerSnapshot(): boolean {
  return isRtlLayout();
}

export type LayoutDirection = 'rtl' | 'ltr';

/** The direction as a code, for `dir` attributes and docs. */
export function directionCode(language?: string): LayoutDirection {
  return isRtlLayout(language) ? 'rtl' : 'ltr';
}
