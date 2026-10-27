/**
 * The theme a page is PAINTED with, before and after hydration.
 *
 * ★ THE BUG THIS LOCKS OUT.
 *
 * `useTheme` read `useColorScheme()` from react-native-web, which during the
 * static export has no `window`, so its media query is null and
 * `Appearance.getColorScheme()` returns the string `'light'`. The `?? 'dark'`
 * fallback in `useTheme` never applied, because `'light'` is not nullish.
 *
 * Every server-rendered page therefore shipped light: the markup carried
 * `background-color: rgba(251,245,239,1)` while the dark canvas rule sat above
 * it in the same document. On a dark system the app painted a cream page with
 * dark cards on it — half-light, exactly as reported.
 *
 * ★ WHY THE FALLBACK HAS TO BE DARK.
 *
 * The app's own rule (Style Guide §0.1 #3, and the note in `+html.tsx`) is that
 * an unknown scheme resolves to DARK. The canvas CSS defaults to dark too, so
 * making the renderer agree keeps the pre-hydration paint and the hydrated tree
 * the same colour instead of flashing.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { resolveThemeName } from '@/src/theme/resolve-theme-name';

describe('the resolved theme', () => {
  test('a scheme the platform did not observe is dark, even when it says light', () => {
    // Arrange — the exact static-render case: react-native-web returns the
    // DEFAULT 'light' when `window.matchMedia` is unavailable, so the value
    // looks like an observation and is not.
    // Act
    const scheme = resolveThemeName('light', 'system', false);

    // Assert
    assert.equal(scheme, 'dark', 'an unobserved scheme must not paint light');
  });

  test('an observed light scheme still paints light', () => {
    // Act / Assert — the fix must not become "always dark".
    assert.equal(resolveThemeName('light', 'system', true), 'light');
  });

  test('an unresolved colour scheme falls back to dark, not light', () => {
    // Arrange — the shared resolver, which both the browser and the static
    // render go through. It takes the scheme as a value so the null case is
    // testable without a DOM.

    // Act
    const scheme = resolveThemeName(null, 'system');

    // Assert — an unknown scheme must not read as light; that is what shipped a
    // cream page to a dark-mode browser.
    assert.equal(scheme, 'dark', 'an unknown scheme must resolve to dark');
  });

  test('an explicit preference beats the system scheme', () => {
    // Act / Assert
    assert.equal(resolveThemeName('light', 'dark'), 'dark');
    assert.equal(resolveThemeName('dark', 'light'), 'light');
  });

  test('a known system scheme is honoured', () => {
    // Act / Assert — the fix must not hardcode dark.
    assert.equal(resolveThemeName('dark', 'system'), 'dark');
    assert.equal(resolveThemeName('light', 'system'), 'light');
  });

  test('an undefined scheme is treated like an unresolved one', () => {
    // Act / Assert — react-native-web types the hook as possibly null; the
    // static render is the case that actually produces it.
    assert.equal(resolveThemeName(undefined, 'system'), 'dark');
  });
});
