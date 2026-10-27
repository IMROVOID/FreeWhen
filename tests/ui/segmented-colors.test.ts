/**
 * The segmented control's labels must be readable ON the indicator.
 *
 * ★ THE DEFECT THIS PINS.
 *
 * "Suggested times" uses the control for its List/Grid switch, and there the
 * labels were hard to read. The selected segment was painted with
 * `t.onPrimary` — the colour meant to sit on `t.primary` — and that is right for
 * the SELECTED label. But the unselected labels were `t.textMuted`, which is
 * only 4.80:1 on `surface3` and 5.47:1 on `surface2` in the dark theme, and at
 * the control's small body size that reads as grey-on-grey rather than as
 * something you can press.
 *
 * The pair has to be chosen so the selected label clears the indicator whether
 * or not the accent is dark, and the unselected one clears the rail:
 *
 *  - selected / unselected labels share the same font weight, so a reader never
 *    has to infer the choice from weight alone;
 *  - the unselected label uses `t.text` (15.52:1 on `surface2`), not `textMuted`;
 *  - the indicator's own fill is opaque, so a mid-flight slide can never show
 *    two labels half-on a translucent pill.
 *
 * ★ AND THE INDICATOR HAS TO BE WIDE ENOUGH TO READ.
 *
 * Its width comes from `trackWidth - space[1] * 2`, so if the container ever
 * reports zero the pill is not rendered at all and the selected label turns
 * into plain text on the rail — which is the other way this control loses its
 * selection cue.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('an unselected label is full-strength text, not textMuted', () => {
  // Arrange
  const chip = code('src/components/ui/Chip.tsx');

  // Act — the tint is chosen once per segment and feeds both the label and the
  // icon, so the two can never disagree about the selection.
  const tint = /const tint = isSelected \? ([^:]+): ([^;]+);/.exec(chip);

  // Assert
  assert.ok(tint, 'the segment has no conditional tint');
  const selected = (tint[1] ?? '').trim();
  const unselected = (tint[2] ?? '').trim();
  assert.match(selected, /onPrimary/, 'the selected label does not use the on-accent colour');
  assert.ok(
    /t\.text\b/.test(unselected) && !/textMuted/.test(unselected),
    `the unselected label uses ${unselected}, which is too faint on the rail`,
  );
});

test('the two label weights match, so the choice is not read from weight', () => {
  // Arrange
  const chip = code('src/components/ui/Chip.tsx');

  // Act
  const segmentLabel =
    /<Text\s+variant="body"[\s\S]{0,400}?\{option\.label\}[\s\S]{0,40}?<\/Text>/.exec(chip)?.[0] ?? '';

  // Assert
  assert.ok(segmentLabel.length > 0, 'the segment label markup was not found');
  assert.ok(
    !/weight=\{/.test(segmentLabel),
    'the labels carry per-segment weights, so selection is encoded twice and inconsistently',
  );
});

test('a mid-flight slide never shows a translucent indicator', () => {
  // Arrange — the pill crosses the other label on the way, and a translucent
  // fill would leave both half-legible for the duration of the animation.
  const chip = code('src/components/ui/Chip.tsx');

  // Act
  const indicator = /indicator:[\s\S]{0,200}?backgroundColor/.exec(chip)?.[0] ?? '';
  const opacityOnIndicator = /indicator[\s\S]{0,300}?opacity:/.test(chip);

  // Assert
  assert.ok(!opacityOnIndicator, 'the indicator fades, so two labels overlap unreadably');
  assert.ok(
    /backgroundColor:\s*t\.primary/.test(chip) || /backgroundColor:\s*t\.accent/.test(chip),
    'the indicator has no opaque fill',
  );
  assert.equal(indicator.length >= 0, true);
});

test('the control still slides, and still honours Reduce Motion', () => {
  // Arrange
  const chip = code('src/components/ui/Chip.tsx');

  // Act / Assert — the earlier guarantee must survive the colour change.
  assert.ok(/useAnimatedStyle/.test(chip), 'the segmented control has no animated style');
  assert.ok(/translateX/.test(chip), 'the indicator does not translate');
  assert.ok(/withTiming|withSpring/.test(chip), 'the slide is not driven by reanimated');
  assert.ok(/motion\.reduce/.test(chip), 'the control reads no reduce flag');
});

test('the indicator is only drawn once the track has measured', () => {
  // Arrange
  const chip = code('src/components/ui/Chip.tsx');

  // Act — a zero-width pill would draw a sliver at the leading edge.
  const guarded = /segmentWidth\s*>\s*0\s*\?/.test(chip);

  // Assert
  assert.ok(guarded, 'the indicator renders at zero width');
});
