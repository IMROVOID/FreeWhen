/**
 * A language switch must reflow the app WITHOUT a restart — including the parts
 * the platform owns.
 *
 * ★ THE HALF THAT WAS STILL BROKEN AFTER THE REMOUNT FIX.
 *
 * `app/_layout.tsx` keys the app's root on the resolved direction, and that is
 * genuinely necessary: it discards every piece of React state and the stale
 * `onLayout` measurements taken under the old direction. It is also not enough.
 *
 * `flexDirection: 'row'` is not resolved by React. The platform's layout engine
 * reads the parent's `layoutDirection`, which belongs to the Activity's window,
 * and React Native resolves it once when the hierarchy is created —
 * `I18nManager.forceRTL` only writes a `SharedPreferences` boolean that nothing
 * re-reads while a surface is alive (`react-native/.../I18nUtil.kt`), and its own
 * docs say "takes effect on the next app reload".
 *
 * So switching to English swapped every string (the catalogue is JS) and moved
 * every `align="start"` (the app sets an absolute `textAlign`), while every ROW
 * kept its Persian order until the process was killed. That is the report.
 *
 * ★ THE FIX IS A WINDOW REBUILD, AND IT MUST BE CONDITIONAL.
 *
 * Recreating the Activity makes the window re-read the direction — the same thing
 * the OS does on a locale change, and what the user was doing by hand with a
 * force-stop. It is only worth doing when the direction actually flips, so the
 * test below pins both the call and its guard.
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

test('a direction flip asks the platform to rebuild its window', () => {
  // Arrange
  const i18n = code('src/i18n/index.ts');

  // Act
  const compares = /isRtlLanguage\(i18next\.language\)\s*!==\s*isRtlLanguage\(language\)/.test(i18n);
  const calls = /if \(flipped\) reloadForDirection\(\);/.test(i18n);

  // Assert — the comparison is what keeps a same-direction switch free.
  assert.ok(compares, 'the direction is not compared before and after the switch');
  assert.ok(calls, 'the platform window is never rebuilt on a direction change');
});

test('the rebuild is behind the direction guard, not run on every switch', () => {
  // Arrange — an unconditional call would recreate the Activity every time the
  // language control is touched, including between two locales that read the same
  // way — a visible window teardown for no reason.
  const i18n = code('src/i18n/index.ts');

  // Act
  const flips = i18n.match(/reloadForDirection\(\)/g) ?? [];

  // Assert — exactly one call site, and it is guarded.
  assert.equal(flips.length, 1, `reloadForDirection is called ${flips.length} times`);
  assert.match(i18n, /if \(flipped\)\s*reloadForDirection\(\);/);
});

test('the native implementation recreates the Activity, and only on Android', () => {
  // Arrange — iOS resolves row order from the semantic content attribute, which
  // `RCTRootView` re-reads on a remount, so its half of this defect does not
  // exist; recreating there would be a needless flash.
  const native = code('src/platform/direction-reload.native.ts');

  // Assert
  assert.match(native, /Platform\.OS !== 'android'/, 'the reload is not limited to Android');
  assert.match(native, /module\.recreate\(\)/, 'the native module is never asked to recreate');
  assert.match(
    native,
    /typeof module\?\.recreate !== 'function'/,
    'a missing native module would throw on a language switch',
  );
});

test('the web implementation does nothing, because the browser is already live', () => {
  // Arrange
  const web = code('src/platform/direction-reload.web.ts');

  // Assert — `applyDirection` sets `dir` on `<html>` and every logical CSS
  // property re-resolves on the next style pass. A page reload here would be the
  // regression the web build was already fixed out of.
  assert.doesNotMatch(web, /location\.reload/, 'the web build reloads the page');
  assert.match(web, /export function reloadForDirection/, 'the sibling lost its export');
});

test('the Android module is delivered by a config plugin, not by editing android/', () => {
  // Arrange — ★ `/android/` IS GITIGNORED AND REGENERATED.
  //
  // `.gitignore` ignores it wholesale and `scripts/build/build-apk.sh` runs
  // `expo prebuild` before Gradle, so a Kotlin file written directly into
  // `android/app/src/main/java/...` exists only in the working copy that wrote it
  // — it never reaches CI and never reaches the APK.
  const plugin = read('plugins/with-direction-reload.js');
  const appJson = read('app.json');

  // Assert — the plugin is registered...
  assert.match(
    appJson,
    /"\.\/plugins\/with-direction-reload\.js"/,
    'the config plugin is not registered in app.json',
  );

  // ...it writes both sources...
  assert.match(plugin, /DirectionReloadModule\.kt/, 'the module source is not written');
  assert.match(plugin, /DirectionReloadPackage\.kt/, 'the package source is not written');

  // ...it registers the package with the React host, and refuses to do it blindly.
  assert.match(plugin, /add\(DirectionReloadPackage\(\)\)/, 'the package is not registered');
  assert.match(
    plugin,
    /PackageList\\\(this\\\)\\\.packages\\\.apply/,
    'the registration is not anchored on the generated template',
  );

  // ...the module name matches what the JS side looks up...
  assert.match(plugin, /"DirectionReload"/, 'the module name does not match the JS lookup');

  // ...and it declares a recreate method.
  assert.match(plugin, /fun recreate\(\)/, 'the module has no recreate method');
});

test('the plugin does not import TypeScript-only syntax, which Expo cannot parse', () => {
  // Arrange — Expo loads a config plugin through a bare Babel transform that does
  // not strip types; an `import type` there is a hard parse error at prebuild.
  const plugin = read('plugins/with-direction-reload.js');

  // Assert
  assert.doesNotMatch(
    plugin,
    /^\s*import\s+type\s/m,
    'the plugin uses `import type`, which fails to parse when Expo loads it',
  );
  assert.doesNotMatch(
    plugin,
    /:\s*ConfigPlugin\s*=/,
    'the plugin uses a TypeScript type annotation, which fails to parse',
  );
});
