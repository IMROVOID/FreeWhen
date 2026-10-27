/**
 * The chosen place's two actions are icon buttons, and the map has air above it.
 *
 * ★ THE DEFECT THIS PINS.
 *
 * "Clear" and "Change place" were bordered pills with a text label each. Two
 * labelled pills and a three-line place description do not fit on one row of a
 * phone, so the row had to wrap or squeeze and the place's own name lost.
 * They are a pair of single-purpose actions on a value that is already named in
 * the row, so the words were repeating the heading — the standards' icon-button
 * pattern. The label moves to `accessibilityLabel`, which the previous tests
 * already require, so nothing is lost to assistive tech.
 *
 * ★ AND THE MAP STILL NEEDED AIR.
 *
 * `placeSection` gained `paddingTop`, whose comment claimed to separate the map
 * from its title. The padding is applied to the CARD, so it pushed the title
 * down inside the card and left the map exactly as flush as before — a fix that
 * reads as done and changes nothing. The gap has to sit between the heading and
 * the content, which in this layout means the content's own top margin.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('both place actions are circular icon buttons', () => {
  // Arrange
  const propose = code('app/event/[id]/propose.tsx');

  // Act
  const style = /chosenAction:\s*\{([\s\S]*?)\n {2}\},/.exec(propose)?.[1] ?? '';

  // Assert — a circle is a square with a full-radius corner, and both actions
  // must be square: one pill and one circle would read as two controls from
  // different screens.
  assert.ok(style.length > 0, 'the chosen-action style is missing');
  assert.ok(/width:/.test(style), 'the action has no explicit width, so it is not a circle');
  assert.ok(/height:/.test(style), 'the action has no explicit height, so it is not a circle');
  assert.ok(
    /borderRadius:\s*radius\.pill/.test(style),
    'the action is not pill-round, so a square would read as a rounded rectangle',
  );
  assert.ok(!/paddingHorizontal:\s*space\[3\]/.test(style), 'the action is still sized by its label');
});

test('the icon buttons carry no visible text label', () => {
  // Arrange
  const propose = code('app/event/[id]/propose.tsx');

  // Act — each action used to render a `<Text>` child. `Pressy` closes with a
  // newline before the ``,[object Object]`, so the terminator has to allow it.
  const changeBlock = /testID="propose-change-place"[\s\S]*?<\/Pressy>/.exec(propose)?.[0] ?? '';
  const clearBlock = /testID="propose-clear-place"[\s\S]*?<\/Pressy>/.exec(propose)?.[0] ?? '';

  // Assert
  assert.ok(changeBlock.length > 0, 'the change action is missing');
  assert.ok(clearBlock.length > 0, 'the clear action is missing');
  assert.ok(!/<Text\b/.test(changeBlock), 'the change action still renders a text label');
  assert.ok(!/<Text\b/.test(clearBlock), 'the clear action still renders a text label');
});

test('both icon buttons keep a non-empty accessibility label', () => {
  // Arrange — the words moved off the screen, so they must survive on the node.
  const propose = code('app/event/[id]/propose.tsx');

  // Act
  const labelled = (propose.match(/accessibilityLabel=\{[^}]+\}/g) ?? []).join(' ');

  // Assert
  assert.ok(/proposals\.form\.changePlace/.test(labelled), 'change lost its accessible name');
  assert.ok(/common\.clear/.test(labelled), 'clear lost its accessible name');
});

test('the map gets its spacing between the title and the map, not inside the card', () => {
  // Arrange
  const propose = code('app/event/[id]/propose.tsx');

  // Act — `paddingTop` on the card pushed the TITLE down; the map stayed flush.
  const section = /placeSection:\s*\{([^}]*)\}/.exec(propose)?.[1] ?? '';
  const pickerSlot = /mapSlot:\s*\{([^}]*)\}/.exec(propose)?.[1] ?? '';

  // Assert
  assert.ok(!/paddingTop/.test(section), 'the card padding is still standing in for the gap');
  assert.ok(pickerSlot.length > 0, 'the map has no slot of its own to space');
  assert.ok(/paddingTop/.test(pickerSlot), 'the map is still flush with its title');
});

test('the spacing is applied to whatever fills the slot', () => {
  // Arrange — the slot wraps the picker AND the collapsed row, so switching
  // between them cannot move the heading.
  const propose = code('app/event/[id]/propose.tsx');

  // Act
  const wrapped = /style=\{styles\.mapSlot\}/.test(propose);

  // Assert
  assert.ok(wrapped, 'the map slot style is defined and never applied');
});
