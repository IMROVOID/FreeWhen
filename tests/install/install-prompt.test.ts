/**
 * The install offer's decisions, and the crash it caused on Android.
 *
 * ★ THE DEFECT THIS PINS IS A HARD CRASH ON LAUNCH, NOT A COSMETIC ONE.
 *
 * `watchInstallPrompt()` was guarded with `typeof window === 'undefined'`.
 * React Native DEFINES a global `window` for compatibility, and it is not a
 * `Window` — it has no `addEventListener`. The guard therefore passed on Android,
 * the next line threw
 *
 *     TypeError: undefined is not a function
 *         at watchInstallPrompt
 *
 * at module scope in `app/_layout.tsx`, and a throw at module scope is a FATAL
 * exception on the native main thread: the app died before its first screen. The
 * logcat tombstone named this frame exactly, which is why the guard is now on the
 * METHOD and not on the object.
 *
 * ★ AND THE OFFER ITSELF MUST BE RIGHT ON EACH SURFACE.
 *
 * A phone browser gets the APK; a desktop Chromium gets the browser's own install
 * prompt; an installed app gets nothing (it would be offering to install itself).
 * Dismissal is permanent, and the download link is the release PAGE, so a new
 * build is reachable without rebuilding the app that links to it.
 */

import '../ui/support/register';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  ANDROID_RELEASE_URL,
  INSTALL_DISMISSED_KEY,
  detectInstallEnvironment,
  installActionFor,
  installSurfaceFor,
  shouldOfferInstall,
  watchInstallPrompt,
} from '@/src/features/install/services/install-prompt';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const DESKTOP_CHROMIUM = {
  standalone: false,
  mobile: false,
  hasDeferredPrompt: true,
  chromiumDesktop: true,
};

const ANDROID_BROWSER = {
  standalone: false,
  mobile: true,
  hasDeferredPrompt: false,
  chromiumDesktop: false,
};

const INSTALLED = {
  standalone: true,
  mobile: true,
  hasDeferredPrompt: false,
  chromiumDesktop: false,
};

/* ── Who gets what ────────────────────────────────────────────────────────── */

test('a desktop Chromium gets the browser install prompt', () => {
  // Arrange / Act
  const surface = installSurfaceFor(DESKTOP_CHROMIUM);

  // Assert — this is the "Chrome install app prompt that makes a webapp
  // shortcut", which can only be fired from the captured event.
  assert.equal(surface, 'desktop-pwa');
  assert.equal(installActionFor(surface), 'prompt');
});

test('a phone browser gets the APK', () => {
  const surface = installSurfaceFor(ANDROID_BROWSER);

  assert.equal(surface, 'mobile-apk');
  assert.equal(installActionFor(surface), 'apk');
});

test('an installed app is offered nothing', () => {
  // Assert — offering to install the app the person is already inside is the
  // one answer that is certainly wrong.
  assert.equal(installSurfaceFor(INSTALLED), 'standalone');
  assert.equal(installActionFor('standalone'), 'none');
  assert.equal(shouldOfferInstall(INSTALLED, false), false);
});

test('a browser that supports neither still gets the APK link', () => {
  // Arrange — Firefox, older Safari.
  const firefox = {
    standalone: false,
    mobile: false,
    hasDeferredPrompt: false,
    chromiumDesktop: false,
  };

  // Assert — a download is a better offer than a button that does nothing.
  assert.equal(installSurfaceFor(firefox), 'unsupported');
  assert.equal(installActionFor('unsupported'), 'apk');
});

test('a dismissed offer never returns', () => {
  // Assert — "if dismissed shouldn't show it anymore again".
  assert.equal(shouldOfferInstall(DESKTOP_CHROMIUM, true), false);
  assert.equal(shouldOfferInstall(ANDROID_BROWSER, true), false);
});

test('the offer is shown before it is dismissed', () => {
  assert.equal(shouldOfferInstall(DESKTOP_CHROMIUM, false), true);
  assert.equal(shouldOfferInstall(ANDROID_BROWSER, false), true);
});

/* ── The crash ────────────────────────────────────────────────────────────── */

test('watching for the install event is safe with no DOM', () => {
  // Arrange — the Node test runner has neither `window` nor `navigator`.
  // Act / Assert — this call is the one that killed the Android build.
  assert.doesNotThrow(() => watchInstallPrompt());
});

test('reading the environment is safe with no DOM', () => {
  // Act
  const environment = detectInstallEnvironment();

  // Assert — a conservative "no" rather than a throw.
  assert.equal(environment.standalone, false);
  assert.equal(environment.mobile, false);
  assert.equal(environment.hasDeferredPrompt, false);
});

test('the guard is on the method, not on the object', () => {
  // Arrange — React Native defines a `window` with no `addEventListener`, so an
  // object check passes and the next line throws.
  const source = code('src/features/install/services/install-prompt.ts');

  // Act
  const methodChecked = /typeof window\.addEventListener === 'function'/.test(source);
  const objectChecked = /typeof window === 'undefined'\) return;/.test(source);

  // Assert
  assert.ok(methodChecked, 'the guard does not test for the method it calls');
  assert.ok(!objectChecked, 'the guard still tests the object, which exists on native');
});

test('every entry point of the module is native-safe', () => {
  // Arrange — the module is imported by the shared layout, so all of its exports
  // run on Android.
  const source = code('src/features/install/services/install-prompt.ts');

  // Act — the two functions that touch `window`/`navigator` both return early.
  const watcherGuarded = /watchInstallPrompt[\s\S]{0,200}?if \(listening \|\| !hasDomEvents\(\)\) return;/.test(
    source,
  );
  const detectorGuarded = /detectInstallEnvironment[\s\S]{0,400}?if \(!hasDomEvents\(\) \|\| typeof navigator === 'undefined'\)/.test(
    source,
  );

  // Assert
  assert.ok(watcherGuarded, 'watchInstallPrompt can still reach addEventListener on native');
  assert.ok(detectorGuarded, 'detectInstallEnvironment can still read a native navigator');
});

/* ── The download link ────────────────────────────────────────────────────── */

test('the download link is the dynamic latest release page', () => {
  // Assert — a versioned asset URL would go stale and need a new build to move.
  assert.equal(ANDROID_RELEASE_URL, 'https://github.com/IMROVOID/FreeWhen/releases/latest');
  assert.ok(/\/releases\/latest$/.test(ANDROID_RELEASE_URL), 'the link is not the moving latest page');
});

test('the dismissal is persisted under a namespaced key', () => {
  assert.ok(INSTALL_DISMISSED_KEY.startsWith('freewhen.'), 'the key is not namespaced');
});

/* ── Where it is wired ────────────────────────────────────────────────────── */

test('the offer is raised after the name gate, so the two never stack', () => {
  // Arrange
  const layout = code('app/_layout.tsx');

  // Act
  const gated = /nickname === null \? \([\s\S]*?NicknameGate[\s\S]*?\) : null/.test(layout);
  const afterGate = /nickname !== null/.test(layout);

  // Assert
  assert.ok(gated, 'the layout no longer gates on the nickname');
  assert.ok(afterGate, 'the offer is raised before the gate resolves');
});

test('the header carries a door back to the offer', () => {
  // Arrange — a permanent dismissal with no way back is a dead end.
  const home = code('app/index.tsx');

  // Act / Assert
  assert.ok(/testID="home-install"/.test(home), 'the home screen has no install control');

  const installAt = home.indexOf('testID="home-install"');
  const settingsAt = home.indexOf('testID="home-settings"');
  const between = Math.abs(home.slice(Math.min(installAt, settingsAt), Math.max(installAt, settingsAt)).length);

  assert.ok(settingsAt > 0, 'the home screen has no settings control');
  // Adjacent in the same header row: nothing but the other control's markup
  // separates them.
  assert.ok(between < 900, `the install control is ${between} characters from settings, not beside it`);

  assert.ok(/isWeb \? \(/.test(home), 'the install control is offered inside the native app');
});
