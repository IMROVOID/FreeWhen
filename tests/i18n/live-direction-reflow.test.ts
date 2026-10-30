/**
 * Switching language must reflow the interface, not just its strings.
 *
 * ★ THE DEFECT THIS PINS, OBSERVED ON THE EMULATOR AGAINST THE SHIPPED BUILD.
 *
 * Settings → English swapped every string to English and left every layout
 * mirrored: headings still right-aligned, the back chevron still pointing the RTL
 * way, `fa` still on the right of the language rail and `en` on the left, the OFF
 * switch knob still against the left edge. Restarting the app made it lay out
 * correctly — which is what "it should do it without restart" is asking for, and
 * what proves the direction SOURCE was already right.
 *
 * So the fault is not the resolution rule. It is that nothing forces the mounted
 * native view tree to be laid out again:
 *
 *  - `I18nManager.forceRTL` is documented — correctly — as next-launch-only, and
 *    React Native caches `isRTL` at module load. Calling it changes nothing that
 *    is already on screen.
 *  - `app/_layout.tsx` keyed the `<Stack>` on the direction. That rebuilds the
 *    NAVIGATOR, not the app: the views that host it (`GestureHandlerRootView`,
 *    `SafeAreaProvider`, `AppFrame`) and every screen already mounted keep the
 *    measurements they were given under the old direction.
 *
 * The fix is to key the app's ROOT — a keyed remount is React Native's supported
 * way to rebuild a view tree, and it is exactly what a restart does, minus the
 * process.
 *
 * ★ WHY THIS SUITE ASSERTS ON SOURCE FOR THE LAYOUT.
 *
 * The root layout cannot be mounted in the Node runner: it imports
 * `expo-router`, `expo-font`, `expo-splash-screen` and the native direction
 * module, none of which the runner can transform. The property that matters here
 * is structural — WHERE the key is applied — and that is readable from the file.
 * The behavioural half (i18next, the store, `isRtlLayout`) is executed for real.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import i18next, { initI18n, setLanguage } from '@/src/i18n';
import { isRtlLayout } from '@/src/platform/layout-direction';

function source(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const LAYOUT = 'app/_layout.tsx';

test('a language switch flips the direction without a restart, in both directions', () => {
  // Arrange
  initI18n('fa');

  try {
    // Act + Assert — fa → en
    assert.equal(isRtlLayout(), true, 'Persian must be right-to-left');
    setLanguage('en');
    assert.equal(i18next.language, 'en');
    assert.equal(isRtlLayout(), false, 'English must be left-to-right immediately');

    // Act + Assert — and back
    setLanguage('fa');
    assert.equal(i18next.language, 'fa');
    assert.equal(isRtlLayout(), true, 'Persian must return to right-to-left immediately');
  } finally {
    initI18n('fa');
  }
});

test('the ROOT of the app is keyed on the direction, so the tree is rebuilt', () => {
  // Arrange
  const layout = source(LAYOUT);

  // Act — the keyed node must be the outermost element the layout returns.
  const rootKeyed = /<GestureHandlerRootView\s+key=\{directionKey\}/.test(layout);

  // Assert
  assert.ok(
    rootKeyed,
    'the direction key must be on the root view — keying only <Stack> rebuilds the ' +
      'navigator while the views around it keep their old-direction measurements',
  );
});

test('the navigator is not the only thing the direction rebuilds', () => {
  // Arrange — a `key` on <Stack> alone is the shipped defect.
  const layout = source(LAYOUT);

  // Act
  const stackKeyed = /<Stack\s+key=\{directionKey\}/.test(layout);

  // Assert — keying the Stack is allowed (it is harmless), but it must not be the
  // ONLY key: the root must carry one too.
  if (stackKeyed) {
    assert.match(
      layout,
      /<GestureHandlerRootView\s+key=\{directionKey\}/,
      'keying <Stack> alone does not reflow the app',
    );
  }
});

test('the direction key is derived from the resolved direction, not from the raw language', () => {
  // Arrange — a third LTR locale should not pay for a remount it does not need,
  // and one direction must never produce two different keys.
  const layout = source(LAYOUT);

  // Act
  const derived = /const directionKey\s*=\s*rtl\s*\?\s*'rtl'\s*:\s*'ltr'/.test(layout);

  // Assert
  assert.ok(derived, 'directionKey must collapse to rtl/ltr');
});

test('a restart is never requested from the user', () => {
  // Arrange — the prompt was the visible symptom of the old design.
  const layout = source(LAYOUT);
  const toggle = source('src/features/settings/components/LanguageToggle.tsx');

  // Assert
  for (const [name, text] of [
    [LAYOUT, layout],
    [toggle, toggle],
  ] as const) {
    assert.doesNotMatch(text, /restartRequired\s*[!=]==?\s*true/, `${name} asks for a restart`);
  }
});
