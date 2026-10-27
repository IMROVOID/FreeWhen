/**
 * The theme-name decision, kept free of React Native imports.
 *
 * ★ WHY THIS IS A SEPARATE MODULE.
 *
 * `src/theme/useTheme.ts` imports `react-native` for the `useColorScheme` hook,
 * and the Node test runner cannot transform that module graph (it fails with
 * `Unexpected "typeof"`). Anything a unit test needs to import therefore cannot
 * live beside the hook, or the test cannot run at all — the same constraint that
 * produced `src/lib/api-base-url.ts`.
 *
 * ★ AN UNRESOLVED SCHEME IS DARK, AND THAT IS A REAL BUG FIX.
 *
 * `useColorScheme()` was read with `?? 'dark'`, which looked like a dark
 * fallback and was dead code: react-native-web's `Appearance.getColorScheme()`
 * returns the STRING `'light'` whenever its media query is null —
 *
 *     getColorScheme() { return query && query.matches ? 'dark' : 'light'; }
 *
 * — and the query IS null during the static export, where `canUseDOM` is false.
 * So `?? 'dark'` never fired and every server-rendered page was painted light:
 * a cream page with dark cards on a dark system.
 *
 * ★ SO THE CALLER HAS TO SAY WHEN THE PLATFORM CANNOT ANSWER.
 *
 * `schemeKnown` is false when the platform has no opinion — during the static
 * render, or before a browser has reported a preference. An unknown scheme
 * resolves to dark, per Style Guide §0.1 #3, which is also what the canvas CSS
 * in `app/+html.tsx` already paints, so hydration cannot flash.
 *
 * A scheme the platform DID report is honoured in both directions; this must not
 * become "always dark".
 */

import type { ThemeName } from './tokens';

/** What the caller prefers, from the appearance store. */
export type ThemePreference = 'system' | 'dark' | 'light';

/**
 * The theme to paint with.
 *
 * @param scheme `useColorScheme()`'s value: `'dark'`, `'light'`, or nullish.
 * @param preference The user's explicit choice, or `'system'`.
 * @param schemeKnown Whether the platform actually reported a preference. Pass
 *   `false` during a static render, where `'light'` is a default rather than an
 *   observation.
 */
export function resolveThemeName(
  scheme: string | null | undefined,
  preference: ThemePreference,
  schemeKnown = true,
): ThemeName {
  if (preference !== 'system') return preference;

  // An unanswered platform resolves to dark, and only an explicit 'light'
  // selects light. Any value a future platform invents also resolves to dark.
  if (!schemeKnown) return 'dark';
  return scheme === 'light' ? 'light' : 'dark';
}
