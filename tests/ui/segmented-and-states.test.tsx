/**
 * The segmented control slides, and full-screen states centre (Plan 49 T12).
 *
 * ★ A BACKGROUND SWAP IS NOT A SLIDE.
 *
 * Switching "List" to "Grid" used to be an instantaneous ternary background on
 * the selected segment, so the new pill simply existed — no visual cause, no
 * sense of one control moving. The module's own doc comment already CLAIMED a
 * sliding indicator; these tests make the claim true and keep it.
 *
 * ★ AND A FULL-SCREEN STATE MUST FILL ITS SPACE.
 *
 * "No times registered yet" and the page-level error card both sat directly under
 * the header with the rest of the viewport empty beneath them, so the layout said
 * "there is more below" when there was nothing at all. Centring needs a height to
 * centre WITHIN, which is what `flex: 1` provides.
 */

import './support/register';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const CHIP = 'src/components/ui/Chip.tsx';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('the selected segment paints its own fill', () => {
  // Arrange — ★ THE PILL IS GONE, AND THAT IS THE FIX.
  //
  // Five attempts placed a separate overlay on top of the flex row and every one
  // shipped something wrong on the device: mirrored wrong in Persian, invisible
  // (zero width) when a measurement did not arrive, and finally correct in width
  // but 11px left of its option because a percentage `left` resolves against the
  // rail's BORDER box while the labels live in its PADDING box.
  //
  // The fill is now the selected cell's own backgroundColor, so the layout engine
  // places it exactly where it places the label.
  const chip = code(CHIP);

  // Act
  const perCellFill = /isSelected && \{ backgroundColor: t\.primary \}/.test(chip);

  // Assert
  assert.ok(perCellFill, 'the selected segment does not paint its own fill');
});

test('there is no overlay to position', () => {
  // Arrange — an overlay that has to REPRODUCE a flex layout will keep disagreeing
  // with it. That is the structural fault behind every previous version.
  const chip = code(CHIP);

  // Assert
  assert.doesNotMatch(chip, /position:\s*'absolute'/, 'an absolutely positioned pill is back');
  assert.doesNotMatch(chip, /translateX/, 'a pixel offset is back');
  assert.doesNotMatch(chip, /useAnimatedStyle/, 'an animated position is back');
});

test('the label colour is the only per-segment selection style left', () => {
  // Arrange — the fill handles "which one is chosen"; the label only has to stay
  // legible on it.
  const chip = code(CHIP);

  // Act
  const tint = /tint\s*=\s*isSelected\s*\?\s*t\.onPrimary\s*:\s*t\.text/.test(chip);

  // Assert
  assert.ok(tint, 'the label does not invert on the selected fill');
});

test('a full-screen error state can fill and centre', () => {
  // Arrange
  const state = code('src/components/states/ErrorState.tsx');

  // Act / Assert
  assert.ok(/centered/.test(state), 'the error state has no centred variant');
  assert.ok(
    /flex:\s*1/.test(state),
    'the centred error does not claim the height — it cannot centre within it',
  );
});

test('a full-screen empty state can fill and centre', () => {
  // Arrange
  const state = code('src/components/ui/EmptyState.tsx');

  // Act / Assert
  assert.ok(/centered/.test(state), 'the empty state has no centred variant');
  assert.ok(/flex:\s*1/.test(state), 'the centred empty state does not claim the height');
});

test('the times list uses both centred variants', () => {
  // Arrange
  const time = code('app/event/[id]/time.tsx');

  // Act — the two states the request named.
  const emptyIsCentred = /emptyTitle[\s\S]{0,400}?centered/.test(time);
  const errorIsCentred = /slots-error[\s\S]{0,200}?centered|centered[\s\S]{0,200}?slots-error/.test(time);

  // Assert
  assert.ok(emptyIsCentred, 'the "no times yet" state is not centred');
  assert.ok(errorIsCentred, 'the times error state is not centred');
});

test('the event history header has no raised back control and a centred title', () => {
  // Arrange
  const activity = code('app/event/[id]/activity.tsx');

  // Act / Assert — the 44pt circle with a fill and a border made the one header
  // on which the back control read as a floating action.
  assert.ok(!/backIconCircle/.test(activity), 'the back icon still sits in a filled circle');
  assert.ok(
    /headerSpacer/.test(activity),
    'the title is not centred — a symmetric spacer is what centres it on the screen',
  );
});
