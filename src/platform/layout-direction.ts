/**
 * The direction the interface is currently laid out in.
 *
 * ★ `I18nManager.isRTL` IS ALWAYS FALSE ON WEB.
 *
 * `react-native-web`'s `I18nManager` is a stub whose `isRTL` is the literal
 * `false` — there is no native layout manager to ask. Five screens chose their
 * back-chevron with `I18nManager.isRTL ? CaretRight : CaretLeft`, so every one
 * of them drew the LTR arrow on the web build even though the document was
 * `dir="rtl"` and the text ran right-to-left. That is why the Back icons point
 * the wrong way on web only.
 *
 * The document direction is the truth on web, and the i18n locale is the truth
 * everywhere else, so this asks the resolved direction rather than a platform
 * manager.
 */

import { I18nManager, Platform } from 'react-native';

import type { Language } from '@/src/i18n/types';

/**
 * Whether the interface reads right-to-left.
 *
 * `language` is the live i18n language. On web the document element is
 * consulted first, because `app/+html.tsx` puts `dir` in the markup before
 * first paint and the app sets it again on a language switch.
 */
export function isRtlLayout(language: string): boolean {
  if (Platform.OS === 'web') {
    if (typeof document !== 'undefined') {
      const attr = document.documentElement?.getAttribute('dir');
      if (attr === 'rtl') return true;
      if (attr === 'ltr') return false;
    }
    // No document (static render), or no attribute: fall back to the locale.
    return language !== 'en';
  }

  return I18nManager.isRTL || language !== 'en';
}

/** The back-chevron direction for a language: RTL points the other way. */
export function backIconIsRtl(language: Language | string): boolean {
  return isRtlLayout(String(language));
}
