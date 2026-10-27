/**
 * The map's place controls and the submit spacing (Plan 49 T17).
 *
 * ★ TWO ACTIONS ON THE MAP BELONGED IN TWO UNRELATED PLACES.
 *
 * Clearing a chosen place was a text button in the section header; changing it was
 * an outlined button UNDER the venue name, below the content it described. Both act
 * on the map, so both now sit as background-only icon buttons in the map's own
 * top-trailing corner — where every map application puts them, and reachable
 * without scrolling past the venue name first.
 *
 * ★ AND THE SUBMIT NEEDED AIR.
 *
 * The submit sat at the same gap as every input, so the control that commits the
 * form read as a third field.
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

test('the picker accepts corner controls', () => {
  // Arrange
  const picker = code('src/components/ui/LocationMapPicker.tsx');

  // Act / Assert
  assert.ok(/cornerControls/.test(picker), 'the picker has no corner-control slot');
});

test('the corner controls sit above the search bar', () => {
  // Arrange
  const picker = code('src/components/ui/LocationMapPicker.tsx');

  // Act
  const corner = /cornerControls:\s*\{([\s\S]*?)\n {2}\},/.exec(picker)?.[1] ?? '';
  const search = /searchBarWrapper:\s*\{([\s\S]*?)\n {2}\},/.exec(picker)?.[1] ?? '';

  const cornerZ = Number(/zIndex:\s*(\d+)/.exec(corner)?.[1] ?? 0);
  const searchZ = Number(/zIndex:\s*(\d+)/.exec(search)?.[1] ?? 0);

  // Assert — being under the search bar would make them unclickable where the two
  // overlap on a narrow screen.
  assert.ok(cornerZ > searchZ, `corner zIndex ${cornerZ} is not above search ${searchZ}`);
});

test('the corner controls are placed with logical insets, so they mirror', () => {
  // Arrange
  const picker = code('src/components/ui/LocationMapPicker.tsx');

  // Act
  const corner = /cornerControls:\s*\{([\s\S]*?)\n {2}\},/.exec(picker)?.[1] ?? '';

  // Assert — the request asks for top-right in English and top-left in Persian,
  // which is exactly what a logical trailing inset does.
  assert.ok(
    /insetInlineEnd|end:/.test(corner),
    'the corner controls are not placed with a logical trailing inset',
  );
});

test('the search bar leaves room for the corner controls', () => {
  // Arrange
  const picker = code('src/components/ui/LocationMapPicker.tsx');

  // Act
  const search = /searchBarWrapper:\s*\{([\s\S]*?)\n {2}\},/.exec(picker)?.[1] ?? '';

  // Assert — the bar spanned the full width, so it would sit UNDER the buttons.
  assert.ok(/CORNER_CONTROLS_WIDTH/.test(search), 'the search bar runs under the corner controls');
});

test('the place actions are icon buttons in the map corner, not text buttons elsewhere', () => {
  // Arrange
  const propose = code('app/event/[id]/propose.tsx');

  // Act — the two controls are passed TO the picker.
  const passesCorner = /cornerControls=/.test(propose);
  const hasBoth = /propose-clear-place/.test(propose) && /propose-change-place/.test(propose);

  // Assert
  assert.ok(passesCorner, 'the propose screen does not use the map corner');
  assert.ok(hasBoth, 'one of the two place actions is missing');
});

test('the map controls carry no border', () => {
  // Arrange
  const propose = code('app/event/[id]/propose.tsx');

  // Act
  const inner = /mapControlInner:\s*\{([\s\S]*?)\n {2}\},/.exec(propose)?.[1] ?? '';

  // Assert — an outline over map tiles competes with the map itself.
  assert.ok(inner.length > 0, 'the map control style is missing');
  assert.ok(!/borderWidth/.test(inner), 'the map control still draws a border');
});

test('the submit has its own block with padding', () => {
  // Arrange
  const propose = code('app/event/[id]/propose.tsx');

  // Act / Assert — at the form's normal gap the submit read as another field.
  assert.ok(/submitBlock/.test(propose), 'the submit is not in its own block');
  assert.ok(/submitBlock:\s*\{[\s\S]*?paddingTop/.test(propose), 'the submit block has no top padding');
});
