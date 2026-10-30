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

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('the segment indicator is animated, not a background swap', () => {
  // Arrange
  const chip = code('src/components/ui/Chip.tsx');

  // Act / Assert — an animated PERCENTAGE `left` driven by reanimated is what makes
  // it slide. It is not a delta on top of a styled position: that pair cannot
  // animate, because the rest moves in style on the same commit the transform
  // starts moving from — the pill teleports and then settles.
  assert.ok(/useAnimatedStyle/.test(chip), 'the segmented control has no animated style');
  assert.ok(
    /left:\s*`\$\{animatedOffset\.value\}%`/.test(chip),
    'the indicator does not animate its position',
  );
  assert.ok(/withTiming|withSpring/.test(chip), 'the slide is not driven by reanimated');
});

test('the indicator is not the selected segment repainting itself', () => {
  // Arrange
  const chip = code('src/components/ui/Chip.tsx');

  // Act — the old ternary applied `backgroundColor: t.primary` to the selected
  // segment's inner view.
  const repaintsSegment = /isSelected && \{ backgroundColor: t\.primary \}/.test(chip);

  // Assert — the fill belongs to the indicator; the label colour is the only
  // per-segment selection style that should remain.
  assert.equal(repaintsSegment, false, 'the selected segment still repaints its own background');
});

test('the indicator respects Reduce Motion', () => {
  // Arrange
  const chip = code('src/components/ui/Chip.tsx');

  // Act / Assert — Style Guide §7.7: the pill jumps instead of sliding, and the
  // control still works.
  assert.ok(/useMotion/.test(chip), 'the segmented control ignores Reduce Motion');
  assert.ok(/motion\.reduce/.test(chip), 'the control reads no reduce flag');
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
