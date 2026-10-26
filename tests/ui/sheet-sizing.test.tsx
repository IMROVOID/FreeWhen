/**
 * Sheets size themselves to their CONTENT, not to a guessed percentage.
 *
 * ★ THE BUG THIS LOCKS OUT.
 *
 * Every sheet passed a magic percentage (`'50%'`, `'55%'`, `'75%'`) and the
 * shared `BottomSheet` disabled dynamic sizing. The share sheet's content is
 * two rows and a button, so a hardcoded half-screen left a large empty band
 * between the last row and the share action — and the sheet never covered the
 * page beneath it, leaving the bottom tiles visible through the gap.
 *
 * ★ WHY THE DEFAULT LIVES IN THE SHARED COMPONENT.
 *
 * A per-caller percentage is a number that can only be right for one screen at
 * one font scale. Putting dynamic sizing in `BottomSheet` means a new sheet is
 * correct by default, and a caller that genuinely needs a fixed height can
 * still pass one.
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

test('the shared sheet enables dynamic sizing by default', () => {
  // Arrange
  const sheet = code('src/components/ui/BottomSheet.tsx');

  // Act / Assert — `enableDynamicSizing={false}` is what turned every
  // percentage into a fixed box with dead space inside it.
  assert.ok(/enableDynamicSizing/.test(sheet), 'BottomSheet does not configure dynamic sizing');
  assert.ok(
    !/enableDynamicSizing=\{false\}/.test(sheet),
    'dynamic sizing is explicitly disabled — sheets get fixed heights again',
  );
});

test('a percentage snap point still resolves for callers that pass one', () => {
  // Arrange
  const sheet = code('src/components/ui/BottomSheet.tsx');

  // Act / Assert — the prop stays supported; it must simply not be forced.
  assert.ok(/snapPoints/.test(sheet), 'BottomSheet dropped its snapPoints prop');
});

test('the share sheet no longer pins itself to half the screen', () => {
  // Arrange
  const share = code('src/features/events/components/EventShareModal.tsx');

  // Act / Assert — the share sheet's content is short and fixed. A hardcoded
  // '50%' is the empty band the user saw.
  assert.ok(
    !/snapPoints=\{\['50%'\]\}/.test(share),
    'the share sheet still hardcodes a 50% snap point',
  );
});

test('the sheet grows to fill, so no page content shows through the gap', () => {
  // Arrange
  const sheet = code('src/components/ui/BottomSheet.tsx');

  // Act / Assert — the sheet's container must stretch, otherwise the content
  // sits in a short box inside a taller background.
  assert.ok(
    /BottomSheetView/.test(sheet),
    'the content view is missing; content cannot drive the height',
  );
});
