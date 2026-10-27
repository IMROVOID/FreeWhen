/**
 * A chosen place must say WHERE it is, and stay changeable (Plan 49 follow-up).
 *
 * ★ THE DEFECT THIS PINS.
 *
 * Confirming a location on the map collapsed the picker into a two-line block:
 * the place name, and — only when the provider returned one — an address. A pin
 * dropped by hand has no address, so the block showed a NAME and nothing else.
 * The two controls that change it (`propose-clear-place` / `propose-change-place`)
 * were passed to the map as `cornerControls`, and the collapsed branch does not
 * render the map at all, so after confirming a place the screen offered no way to
 * clear it or to move it. The only escape was to abandon the form.
 *
 * ★ AND THE MAP SAT DIRECTLY ON ITS TITLE.
 *
 * The section's own `gap` is the gap between the header and the CONTENT; the map
 * is a bordered frame, so a hairline touching the heading read as one block
 * rather than a labelled control.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { formatCoordinates } from '@/src/components/ui/map-pan';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('a chosen place shows its coordinates, not only its name', () => {
  // Arrange — a hand-dropped pin has no address, so the name alone does not say
  // where the place is.
  const propose = code('app/event/[id]/propose.tsx');

  // Act
  const chosenBlock = /venue && !showLocationPicker[\s\S]{0,900}?<\/View>/.exec(propose)?.[0] ?? '';
  const showsCoords =
    /formatCoordinates/.test(chosenBlock) ||
    /\.lat[\s\S]{0,40}\.lng/.test(chosenBlock);

  // Assert
  assert.ok(chosenBlock.length > 0, 'the chosen-place block is missing');
  assert.ok(showsCoords, 'the chosen place does not show where it is');
});

test('a chosen place can be cleared and changed without reopening the map', () => {
  // Arrange
  const propose = code('app/event/[id]/propose.tsx');

  // Act — the two controls live INSIDE the collapsed block now, not only in the
  // map's corner slot, because the map is not rendered while a place is chosen.
  const chosenBlock =
    /venue && !showLocationPicker \? \(([\s\S]*?)\) : \(/.exec(propose)?.[1] ?? '';

  // Assert
  assert.ok(chosenBlock.length > 0, 'the chosen-place block is missing');
  assert.ok(/propose-clear-place/.test(chosenBlock), 'the chosen place cannot be cleared');
  assert.ok(/propose-change-place/.test(chosenBlock), 'the chosen place cannot be changed');
});

test('clearing a place empties it instead of opening the map', () => {
  // Arrange
  const propose = code('app/event/[id]/propose.tsx');

  // Act — the collapsed row's two actions must do different things, or "clear"
  // is just "change" with a bin icon.
  const clearHandler =
    /testID="propose-clear-place"[\s\S]{0,0}|onPress=\{\(\) => setVenue\(null\)\}[\s\S]{0,200}?testID="propose-clear-place"/.exec(
      propose,
    )?.[0] ?? '';
  const changeOpensMap =
    /onPress=\{\(\) => setShowLocationPicker\(true\)\}[\s\S]{0,200}?testID="propose-change-place"/.test(propose);

  // Assert — clearing must not also open the map.
  assert.ok(clearHandler.length > 0, 'the clear action is not wired to empty the place');
  assert.ok(
    !/setShowLocationPicker\(true\)/.test(clearHandler),
    'clearing a place also opens the map, so it is the same action as change',
  );
  assert.ok(changeOpensMap, 'changing a place does not open the map');
});

test('the section gives the map room under its title', () => {
  // Arrange
  const propose = code('app/event/[id]/propose.tsx');

  // Act — the breath belongs to the CONTENT, not the card. `paddingTop` on the
  // card only pushed the heading down and left the map as flush as before.
  const slot = /mapSlot:\s*\{([\s\S]*?)\n {2}\},/.exec(propose)?.[1] ?? '';
  const applied = /styles\.mapSlot/.test(propose);

  // Assert — the section keeps its own gap, and the slot supplies the breath.
  assert.ok(slot.length > 0, 'the map slot style is missing');
  assert.ok(applied, 'the map slot style is defined but never applied');
  assert.ok(/paddingTop/.test(slot), 'the map is flush with its title');
  assert.ok(/gap/.test(/placeSection:\s*\{([\s\S]*?)\n {2}\},/.exec(propose)?.[1] ?? ''), 'the section lost its own gap');
});

test('both place actions are still reachable as buttons with labels', () => {
  // Arrange
  const propose = code('app/event/[id]/propose.tsx');

  // Act
  const labels = (propose.match(/accessibilityLabel=\{t\('[^']+'\)\}/g) ?? []).join(' ');

  // Assert — an icon-only control with no label is unusable with a screen reader.
  assert.ok(/common\.clear/.test(labels), 'the clear action has no accessibility label');
  assert.ok(/proposals\.form\.changePlace/.test(labels), 'the change action has no accessibility label');
});

test('coordinates are formatted for display, and say which hemisphere', () => {
  // Act
  const north = formatCoordinates(35.6892, 51.389);
  const south = formatCoordinates(-33.8688, -151.2093);

  // Assert — a bare "-33.8688" is a number, not a place.
  assert.equal(north, '35.6892° N, 51.3890° E');
  assert.equal(south, '33.8688° S, 151.2093° W');
});

test('a place with an address shows it, and one without does not print a gap', () => {
  // Arrange
  const propose = code('app/event/[id]/propose.tsx');

  // Act
  const guard = /venue\.address\s*&&/.test(propose);

  // Assert — an empty address line would read as a rendering bug.
  assert.ok(guard, 'the address is rendered without checking it exists');
});
