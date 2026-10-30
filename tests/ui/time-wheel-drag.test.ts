/**
 * The time wheel must be draggable, and must not select its own text.
 *
 * ★ THE DEFECT THIS PINS, REPORTED FROM THE DEPLOYED WEB BUILD.
 *
 * "I can't drag/scroll the time wheel on web — the text gets selected when I try,
 * so I have to click the times one by one."
 *
 * `WheelColumn` is a React Native `ScrollView` with `snapToInterval`. On
 * react-native-web that compiles to a `div` with `overflow: auto`, which scrolls
 * from a mouse only when the browser decides the gesture is a scroll. Dragging
 * inside a block of text is a SELECTION gesture everywhere on the page, so the
 * wheel never moved and the labels came up highlighted instead. Touch worked,
 * which is why it survived a phone review.
 *
 * Two properties fix it, and both are asserted below:
 *
 *  1. the column refuses text selection, so a drag cannot become one;
 *  2. a pointer drag writes `scrollTop` directly, so it scrolls whether or not
 *     the browser would have treated the gesture as a scroll.
 *
 * ★ THE FOCUS RING IS A SEPARATE COMPLAINT WITH THE SAME ROOT.
 *
 * Clicking a time left the browser's focus outline around the item — the box in
 * the report's screenshot. It is removed for POINTER focus only: `:focus-visible`
 * keeps it, because a keyboard user must still see where they are. Blanket
 * `outline: none` would have been the wrong fix and is asserted against.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  clampIndex,
  indexForScroll,
  scrollForIndex,
  snapOffsetFor,
} from '@/src/components/ui/time-wheel-geometry';

const SOURCE = 'src/components/ui/TimeWheelPicker.tsx';

function source(): string {
  return readFileSync(SOURCE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The wheel's row height, as the component defines it. */
const ITEM_HEIGHT = 44;

test('an offset maps to the nearest item, clamped to the list', () => {
  // Arrange / Act / Assert
  assert.equal(indexForScroll(0, 12, ITEM_HEIGHT), 0);
  assert.equal(indexForScroll(ITEM_HEIGHT * 3, 12, ITEM_HEIGHT), 3);
  // Just past halfway rounds to the next item.
  assert.equal(indexForScroll(ITEM_HEIGHT * 3 + ITEM_HEIGHT * 0.6, 12, ITEM_HEIGHT), 4);
  // Just short of halfway rounds back.
  assert.equal(indexForScroll(ITEM_HEIGHT * 3 + ITEM_HEIGHT * 0.4, 12, ITEM_HEIGHT), 3);
});

test('an offset outside the list is clamped, not wrapped', () => {
  assert.equal(indexForScroll(-500, 12, ITEM_HEIGHT), 0, 'above the first item clamps to the first');
  assert.equal(
    indexForScroll(ITEM_HEIGHT * 999, 12, ITEM_HEIGHT),
    11,
    'past the last item clamps to the last',
  );
});

test('scrollForIndex and indexForScroll are inverses on every item', () => {
  for (let index = 0; index < 12; index += 1) {
    const offset = scrollForIndex(index, ITEM_HEIGHT);
    assert.equal(offset, index * ITEM_HEIGHT);
    assert.equal(indexForScroll(offset, 12, ITEM_HEIGHT), index);
  }
});

test('clampIndex holds any index inside the list', () => {
  assert.equal(clampIndex(-3, 12), 0);
  assert.equal(clampIndex(0, 12), 0);
  assert.equal(clampIndex(11, 12), 11);
  assert.equal(clampIndex(12, 12), 11);
  assert.equal(clampIndex(Number.NaN, 12), 0);
});

test('a drag offset snaps to the item it lands nearest', () => {
  // A drag that ends 20 px past item 2 must settle on item 2 rather than stay
  // between two of them.
  assert.equal(snapOffsetFor(ITEM_HEIGHT * 2 + 20, 12, ITEM_HEIGHT), ITEM_HEIGHT * 2);
  assert.equal(snapOffsetFor(ITEM_HEIGHT * 2 + 30, 12, ITEM_HEIGHT), ITEM_HEIGHT * 3);
});

test('the column refuses text selection, so a drag cannot become one', () => {
  // Arrange
  const text = source();

  // Assert — both spellings, because Safari only honours the prefixed one.
  assert.match(text, /userSelect:\s*'none'/, 'the column does not declare userSelect: none');
  assert.match(
    text,
    /WebkitUserSelect|user-select/,
    'the prefixed/user-select form is missing, so Safari still selects',
  );
});

test('a pointer drag scrolls the column directly', () => {
  // Arrange
  const text = source();

  // Assert — the drag handler writes scrollTop rather than relying on the browser.
  assert.match(text, /onPointerDown|onMouseDown/, 'no pointer press handler on the column');
  assert.match(text, /scrollTop/, 'the drag never writes scrollTop, so it cannot scroll');
  assert.match(text, /onPointerMove|onMouseMove/, 'no pointer move handler');
});

test('the focus ring is removed for pointer focus only', () => {
  // Arrange
  const text = source();

  // Assert — the keyboard ring survives.
  assert.match(text, /focus-visible|focusVisible/, 'the focus treatment ignores :focus-visible');
  assert.doesNotMatch(
    text,
    /outline:\s*'none'/,
    'a blanket outline: none removes the keyboard focus ring too',
  );
});
