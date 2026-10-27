/**
 * The map picker's controls and the submit spacing (Plan 49 T17, amended).
 *
 * ★ THE CORNER-CONTROL SLOT WAS RETIRED, NOT MOVED.
 *
 * It was added so "clear" and "change" could sit over the tiles, where a map
 * application normally puts them. But the picker is only on screen while a place
 * is being CHOSEN, and the moment one is chosen the picker collapses — so the
 * controls lived in the one state that did not need them, and vanished in the
 * state that did. Every caller stopped passing the slot, and it is gone.
 *
 * What replaces it: the chosen-place row in `app/event/[id]/propose.tsx` carries
 * both actions itself (see `map-chosen-place.test.ts`). What remains the picker's
 * job is the map itself, its search bar, and its confirm.
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

test('the picker no longer exposes a corner-control slot', () => {
  // Arrange
  const picker = code('src/components/ui/LocationMapPicker.tsx');

  // Act / Assert — a slot no caller fills is dead surface that reads as a
  // supported extension point.
  assert.ok(!/cornerControls/.test(picker), 'the retired corner-control slot is still defined');
});

test('the search bar spans the frame now that nothing shares its row', () => {
  // Arrange
  const picker = code('src/components/ui/LocationMapPicker.tsx');

  // Act
  const search = /searchBarWrapper:\s*\{([\s\S]*?)\n {2}\},/.exec(picker)?.[1] ?? '';

  // Assert — it used to stop short of the two corner buttons.
  assert.ok(search.length > 0, 'the search bar style is missing');
  assert.ok(/end:\s*space\[3\]/.test(search), 'the search bar still reserves room for the corner slot');
});

test('the picker still offers a way to confirm the dropped pin', () => {
  // Arrange
  const picker = code('src/components/ui/LocationMapPicker.tsx');
  const propose = code('app/event/[id]/propose.tsx');

  // Act / Assert — this is the only path from "map open" to "place chosen".
  assert.ok(/-confirm/.test(picker), 'the picker has no confirm control');
  assert.ok(/<LocationMapPicker/.test(propose), 'the propose screen does not render the picker');
});

test('the submit has its own block with padding', () => {
  // Arrange
  const propose = code('app/event/[id]/propose.tsx');

  // Act / Assert — at the form's normal gap the submit read as another field.
  assert.ok(/submitBlock/.test(propose), 'the submit is not in its own block');
  assert.ok(/submitBlock:\s*\{[\s\S]*?paddingTop/.test(propose), 'the submit block has no top padding');
});
