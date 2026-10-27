/**
 * Closing a sheet must retire its window, not leave it on screen.
 *
 * ★ OBSERVED ON THE EMULATOR, NOT REASONED ABOUT.
 *
 * After the nickname gate closed, the whole home screen stopped responding — the
 * gear, both event cards, and both buttons in the action row. `dumpsys window
 * windows` showed WHY:
 *
 *   Window #8  ty=APPLICATION      fmt=TRANSPARENT  shown=true   <- the sheet's Modal
 *   Window #9  ty=BASE_APPLICATION                              <- the activity
 *
 * The transparent window was a full-screen surface the app had left behind,
 * drawn above the activity and taking every touch. The page underneath looked
 * perfectly normal, so nothing about the screenshot suggested a problem.
 *
 * The cause was the teardown racing the close animation: `mounted` was cleared on
 * the same tick `visible` went false, so `return null` removed the `Modal` while
 * it was still on screen. That was survivable while every close went through
 * `onClose` (pan gesture, scrim press) — those settle first. The nickname gate
 * closes from its own callback, which made the race reachable.
 */

import './support/register';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('the native sheet defers its unmount instead of tearing down inline', () => {
  // Arrange
  const sheet = code('src/components/ui/BottomSheet.tsx');

  // Act — the close branch of the visibility effect.
  const effect = /useEffect\(\(\) => \{([\s\S]*?)\}, \[visible, mounted\]\);/.exec(sheet)?.[1] ?? '';

  // Assert — an immediate `setMounted(false)` removes the Modal mid-animation.
  assert.ok(effect.length > 0, 'the visibility effect is no longer findable');
  assert.ok(
    /setTimeout\([\s\S]*?setMounted\(false\)/.test(effect),
    'the sheet tears its Modal down on the same tick it closes',
  );
});

test('the deferred unmount is cancelled if the sheet reopens', () => {
  // Arrange
  const sheet = code('src/components/ui/BottomSheet.tsx');

  // Act
  const effect = /useEffect\(\(\) => \{([\s\S]*?)\}, \[visible, mounted\]\);/.exec(sheet)?.[1] ?? '';

  // Assert — a reopened sheet must not be unmounted by the previous close's timer.
  assert.ok(
    /clearTimeout/.test(effect),
    'a pending unmount is not cancelled, so a quick reopen could be torn down',
  );
});

test('a non-dismissible sheet still cannot be closed by the user', () => {
  // Arrange
  const sheet = code('src/components/ui/BottomSheet.tsx');

  // Act / Assert — the gate's constraint survives the teardown change.
  assert.ok(/enablePanDownToClose=\{dismissible\}/.test(sheet), 'the pan-to-close gate is gone');
  assert.ok(/if \(dismissible\) sheetRef/.test(sheet), 'the back-press gate is gone');
});
