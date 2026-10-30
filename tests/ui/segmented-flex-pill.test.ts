/**
 * The pill must be placed BY THE SAME FLEX LAYOUT THAT PLACES THE LABELS.
 *
 * ★ FIVE ATTEMPTS, AND THE MEASUREMENTS THAT KILLED FOUR OF THEM.
 *
 * `uiautomator dump` on the emulator, against the shipped v0.1.4:
 *
 * ```
 * theme rail      : [53,823]..[1028,938]        W=975        (border box)
 * light  option   : [64,834]..[382,929]         w=318        (padding box)
 * system option   : [382,834]..[700,929]        w=318
 * dark   option   : [700,834]..[1018,929]       w=318
 * pill            : [371,834]..[689,929]        w=318   <-- 11px LEFT of its option
 * ```
 *
 * The WIDTH is right — one segment, 318px. The POSITION is wrong by exactly the
 * rail's padding (11px), because a `left` percentage resolves against the rail's
 * BORDER box while the labels live in its PADDING box. Every previous attempt
 * tried to correct that difference by arithmetic, and each correction was right
 * about one platform and one direction.
 *
 * ★ THE ARITHMETIC IS THE PROBLEM, NOT THE NUMBERS.
 *
 * An absolutely-positioned overlay that has to reproduce a flex layout's result
 * will keep disagreeing with it — on padding, on direction, on rounding, on which
 * box a percentage resolves against. The layout engine already knows where each
 * option is. So the pill is placed by the SAME mechanism: it becomes a sibling of
 * the labels inside the same row, with the same `flex: 1` per option, and the
 * selected one renders the fill.
 *
 * That makes the pill's geometry a non-question: it cannot be offset from its
 * label because it is in the same cell, and it cannot be mirrored separately
 * because the row mirrors both together.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const CHIP = 'src/components/ui/Chip.tsx';

test('the pill is not positioned by an absolute offset', () => {
  // Arrange — every absolute placement tried so far (logical inset, physical
  // `left`, pixel transform, percentage `left`) had to be corrected for the rail's
  // padding and for the layout direction, and each correction was right in exactly
  // one combination of platform and language.
  const chip = code(CHIP);

  // Act
  const absolute = /position:\s*'absolute'/.test(chip);

  // Assert
  assert.equal(
    absolute,
    false,
    'the pill is still absolutely positioned, so its geometry is re-derived rather than shared with the labels',
  );
});

test('the pill is placed by the same flex row as the labels', () => {
  // Arrange — a sibling in the same row cannot be offset from the cell it sits in.
  const chip = code(CHIP);

  // Act
  const inRow = /segmented:\s*\{[^}]*flexDirection:\s*'row'/.test(chip);

  // Assert
  assert.ok(inRow, 'the rail is not a row, so nothing can be placed by it');
  assert.doesNotMatch(chip, /left:\s*`\$\{/, 'the pill still computes a percentage position');
  assert.doesNotMatch(chip, /translateX/, 'the pill still computes a pixel position');
});

test('each option owns its own cell, so the fill cannot drift from the label', () => {
  // Arrange — the selected option draws the fill behind its own content.
  const chip = code(CHIP);

  // Act
  const perOptionFill = /isSelected[\s\S]{0,400}?backgroundColor:\s*t\.primary/.test(chip);

  // Assert
  assert.ok(perOptionFill, 'the selected option does not own its fill');
});

test('the rail’s padding is the only inset', () => {
  // Arrange — with the pill inside the row, the rail's `padding` is what separates
  // it from the rail's edge. No second inset may be applied.
  const chip = code(CHIP);

  // Act
  const railPad = /segmented:\s*\{[^}]*padding:\s*space\[1\]/.test(chip);
  const pillInset = /indicator:\s*\{[^}]*(top|left|insetInlineStart):\s*space\[1\]/.test(chip);

  // Assert
  assert.ok(railPad, 'the rail lost its padding');
  assert.equal(pillInset, false, 'the pill insets itself a second time');
});

test('no measurement is threaded into the geometry', () => {
  const chip = code(CHIP);

  assert.doesNotMatch(chip, /trackWidth/, 'a measured width is back in the geometry');
  assert.doesNotMatch(chip, /onLayout=/, 'the rail measures itself again');
});
