/**
 * The WEB sheet must be visible, and must slide from the bottom.
 *
 * ★ THE BUG THIS LOCKS OUT.
 *
 * On the web build Metro resolves `BottomSheet.web.tsx`, not `BottomSheet.tsx`.
 * Four commits (`2b11784`, `383373e`, `0d96b62`, `b9a73ee`) chased an invisible
 * sheet by editing the NATIVE file, so none of them touched the file the web
 * build actually renders. Meanwhile the web sheet painted its scrim with
 * `theme.bg` at 0.72 opacity: a page-coloured rectangle, not a dim scrim. The
 * panel sat on a `flex: 1` root whose parent is React Native Web's portal
 * wrapper, which does not reliably give `flex` a height to resolve against — so
 * the panel could collapse to the top of the viewport while the scrim blocked
 * every click. That is the reported "it is there but invisible, and I cannot
 * click anything".
 *
 * ★ THE FADE WAS THE PLATFORM'S, NOT OURS.
 *
 * `react-native-web`'s `Modal` implements `animationType="fade"` as an opacity
 * keyframe on the whole container (ModalAnimation.js). Asking for the requested
 * slide means not using that animation at all and driving the panel ourselves.
 *
 * ★ WHY SOURCE-TEXT ASSERTIONS.
 *
 * The same reason `sheet-sizing.test.tsx` uses them: these are layout and
 * animation properties of a platform-specific file that no pure unit test can
 * exercise without a DOM. Asserting the properties keeps the two failure modes
 * — a `flex: 1` root and a page-coloured scrim — from coming back.
 */

import './support/register';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

/** Reads a source file with comments stripped, so prose cannot satisfy a test. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const WEB_SHEET = 'src/components/ui/BottomSheet.web.tsx';

test('the web sheet does not rely on `flex: 1` for its root to fill the viewport', () => {
  // Arrange
  const sheet = code(WEB_SHEET);

  // Act — isolate the `root` style block.
  const root = /root:\s*\{([\s\S]*?)\n {2}\}/.exec(sheet)?.[1] ?? '';

  // Assert — a `flex: 1` inside a portal wrapper is what let the panel collapse
  // to the top of the screen. The root must be absolutely positioned instead.
  assert.ok(root.length > 0, 'the web sheet has no `root` style to check');
  assert.ok(
    /position:\s*'absolute'/.test(root),
    'the web sheet root is not absolutely positioned — `flex: 1` has no parent height to resolve against',
  );
  assert.ok(!/\bflex:\s*1/.test(root), 'the web sheet root still relies on `flex: 1`');
});

test('the web sheet scrim dims the page instead of repainting it', () => {
  // Arrange
  const sheet = code(WEB_SHEET);
  const tokens = code('src/theme/tokens.ts');

  // Act — the scrim must read a token that is not the page background.
  const scrimBackground = /backgroundColor:\s*t\.bg/.test(sheet);
  const scrimToken = /backgroundColor:\s*t\.scrim/.test(sheet);

  // Assert — `theme.bg` at 0.72 opacity is indistinguishable from the page, so
  // the sheet looked like "nothing happened". `gate:design` also forbids a
  // hardcoded colour here, so the token is the only correct answer.
  assert.ok(
    !scrimBackground,
    'the scrim is painted with the page background — it cannot read as a dim layer',
  );
  assert.ok(scrimToken, 'the scrim does not use the scrim token');

  // Assert — and the token itself is translucent and dark, in both themes.
  assert.ok(/scrim:\s*'rgba\(/.test(tokens), 'the scrim token is not a translucent overlay');
});

test('the web sheet animates with a vertical translate, not the platform fade', () => {
  // Arrange
  const sheet = code(WEB_SHEET);

  // Act / Assert — `animationType="fade"` is the fade the user asked to replace.
  assert.ok(
    !/animationType="fade"/.test(sheet),
    'the web sheet still asks the platform for a fade animation',
  );
  assert.ok(
    /translateY/.test(sheet),
    'the panel has no vertical translate, so it cannot slide from the bottom',
  );
  assert.ok(
    /withTiming|withSpring/.test(sheet),
    'the panel animation is not driven by reanimated',
  );
});

test('the web sheet keeps its panel mounted long enough to animate out', () => {
  // Arrange
  const sheet = code(WEB_SHEET);

  // Act / Assert — returning `null` the instant `visible` flips false would cut
  // the exit animation off at frame one, so a local rendered flag is required.
  assert.ok(
    /rendered/.test(sheet),
    'the web sheet unmounts immediately on close; the exit animation can never run',
  );
});

test('the web sheet honours Reduce Motion', () => {
  // Arrange
  const sheet = code(WEB_SHEET);

  // Act / Assert — Style Guide §7.7: motion collapses, but the sheet still opens.
  assert.ok(/useMotion/.test(sheet), 'the web sheet ignores Reduce Motion');
  assert.ok(
    /reduce/.test(sheet),
    'the web sheet reads no `reduce` flag from the motion config',
  );
});

test('a sheet can opt out of dismissal, for a gate the user must answer', () => {
  // Arrange
  const sheet = code(WEB_SHEET);
  const native = code('src/components/ui/BottomSheet.tsx');

  // Act / Assert — the nickname gate must block the app, so it cannot offer a
  // scrim press, Escape, or any other way out. Both implementations need it.
  assert.ok(/dismissible/.test(sheet), 'the web sheet has no way to disable dismissal');
  assert.ok(/dismissible/.test(native), 'the native sheet has no way to disable dismissal');
});
