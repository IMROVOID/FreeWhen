/**
 * The platform direction preference must be WRITTEN on every switch, not diffed
 * against a value that React Native cached at module load.
 *
 * ★ THE SHIPPED DEFECT: `applyDirection` compared against `I18nManager.isRTL`.
 *
 * `react-native`'s `I18nManager.js` reads the native constants ONCE:
 *
 * ```js
 * const i18nConstants: I18nManagerConstants = getI18nManagerConstants();
 * ```
 *
 * and exports `isRTL` from that snapshot. There is no setter, and
 * `Activity.recreate()` does not reload the JS bundle — so for the whole life of
 * the process `I18nManager.isRTL` reports whatever the DEVICE locale implied at
 * launch, no matter what the user picked afterwards.
 *
 * The guard was:
 *
 * ```js
 * if (shouldBeRtl !== I18nManager.isRTL) {
 *   I18nManager.allowRTL(shouldBeRtl);
 *   I18nManager.forceRTL(shouldBeRtl);
 * }
 * ```
 *
 * On an English-locale device (`isRTL === false`), switching Persian → English
 * computes `false !== false`, so **`forceRTL(false)` is never called**. The
 * persisted preference keeps saying RTL, and the Activity recreate that follows
 * re-reads that same stale preference: the app reloads to the Home screen and
 * comes back up in the OLD direction. That is exactly the report — "the App does
 * try to reload the page and return to Home when changing the Language but the
 * Layout still not changed until restarting".
 *
 * The fix is that the preference is an OUTPUT: always write the intended value.
 * Writing `forceRTL(false)` when it is already false is free, and it is the only
 * spelling that cannot be wrong for a device whose locale disagrees with the
 * user's choice.
 */

import '../ui/support/register';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const NATIVE = 'src/platform/direction.native.ts';

test('the native preference is written unconditionally', () => {
  // Arrange
  const native = code(NATIVE);

  // Act — the exact shipped guard.
  const guardsOnCached = /if\s*\(\s*shouldBeRtl\s*!==\s*I18nManager\.isRTL\s*\)/.test(native);

  // Assert — ★ the cached compare is the bug: on an English-locale device it is
  // permanently `false`, so `forceRTL(false)` is never reached after a fa→en
  // switch and the recreate re-reads the old value.
  assert.equal(
    guardsOnCached,
    false,
    'forceRTL is skipped when the cached isRTL happens to match — a fa→en switch on an ' +
      'English-locale device then never persists the new direction',
  );

  // Assert — both writers are actually called.
  assert.match(native, /I18nManager\.allowRTL\(/, 'allowRTL is never called');
  assert.match(native, /I18nManager\.forceRTL\(/, 'forceRTL is never called');
});

test('both directions are written, in both switch directions', () => {
  // Arrange — the value must be derived from the LANGUAGE, not from any platform
  // state, so the two calls below are the only two possibilities.
  const native = code(NATIVE);

  // Act
  const derivesFromLanguage = /const shouldBeRtl\s*=\s*language\s*===\s*'fa'/.test(native);

  // Assert
  assert.ok(derivesFromLanguage, 'the direction is not derived from the language');
  assert.match(
    native,
    /I18nManager\.forceRTL\(shouldBeRtl\)/,
    'forceRTL is not given the language-derived direction',
  );
});

test('the comment does not claim the value is read back', () => {
  // Arrange — `I18nManager.isRTL` can never be the source of truth: it is a
  // module-load snapshot. Reading it is what made the guard wrong.
  const native = code(NATIVE);

  // Assert — no comparison against it anywhere.
  assert.doesNotMatch(
    native,
    /I18nManager\.isRTL/,
    'the platform snapshot is still compared against, which reintroduces the stale-pref bug',
  );
});
