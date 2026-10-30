/**
 * The language control must show the language that is rendering.
 *
 * ★ THE DEFECT THIS PINS, OBSERVED ON THE EMULATOR.
 *
 * Settings → فارسی. The whole screen laid out right-to-left and every string
 * became Persian — and the selection pill stayed under "English". The control
 * disagreed with the interface it controls.
 *
 * The cause was a private `useState` seeded from `current` once, written only by
 * a successful `choose()`. A component's own copy of a fact that the app already
 * publishes is the whole bug: `current` is derived from `i18n.language` on every
 * render the catalogue changes, so the selection has to be DERIVED too.
 *
 * ★ WHY THIS ASSERTS ON SOURCE.
 *
 * The component cannot be mounted in the Node runner (it pulls `react-native`,
 * reanimated and the chip primitive's animated style). What is being pinned is a
 * single structural property — the control reads `current`, it does not keep its
 * own copy — and that is exact from the file. The behaviour of the underlying
 * switch is executed for real in `tests/i18n/live-direction-reflow.test.ts`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const TOGGLE = 'src/features/settings/components/LanguageToggle.tsx';

function source(): string {
  return readFileSync(TOGGLE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('the selection is derived from the live language, not kept in state', () => {
  // Arrange
  const text = source();

  // Act
  const derived = /const\s+shown\s*=\s*current\s*;/.test(text);
  const ownState = /useState<Language>/.test(text);

  // Assert
  assert.ok(derived, 'the control must derive its selection from `current`');
  assert.ok(
    !ownState,
    'the control must not keep its own copy of the language — that copy is what ' +
      'went stale and left the pill on the previous option',
  );
});

test('nothing writes the selection directly', () => {
  // Arrange
  const text = source();

  // Assert — `setShown` was the write that raced the catalogue change.
  assert.doesNotMatch(text, /setShown\s*\(/, 'the selection must only come from props');
});

test('the control still reports a failed flush without rolling the language back', () => {
  // Arrange
  const text = source();

  // Assert — a lost write is reported; the user asked for the catalogue.
  assert.match(text, /flushErrorKey/, 'a failed flush must still be surfaced');
  assert.match(text, /language-flush-retry|flush-retry/, 'the failure must offer a retry');
});
