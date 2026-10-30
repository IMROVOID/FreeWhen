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
 * ★ THE OLD NOTE HERE SAID THE PILL'S WIDTH CAME FROM `trackWidth`.
 *
 * It does not any more, and that change is the fix for the pill being invisible on
 * a device: the width is `100/count` of the track, resolved by the layout engine.
 * `tests/ui/segmented-inside-rail.test.ts` owns that contract.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const CHIP = 'src/components/ui/Chip.tsx';

test('an unselected label is full-strength text, not textMuted', () => {
  // Arrange
  const chip = code(CHIP);

  // Act — the tint of a non-selected segment.
  const usesMuted = /tint\s*=\s*isSelected\s*\?\s*t\.onPrimary\s*:\s*t\.textMuted/.test(chip);

  // Assert
  assert.equal(usesMuted, false, 'the unselected label is textMuted, which reads as disabled');
  assert.match(
    chip,
    /tint\s*=\s*isSelected\s*\?\s*t\.onPrimary\s*:\s*t\.text/,
    'the unselected label does not use full-strength text',
  );
});

test('the two label weights match, so the choice is not read from weight', () => {
  // Arrange
  const chip = code(CHIP);

  // Assert — one weight for the label, chosen by selection only for the ICON.
  const labelWeights = [...chip.matchAll(/<Text[^>]*variant="body"[^>]*>/g)].map((m) => m[0]);
  const weighty = labelWeights.filter((tag) => /weight=\{/.test(tag));

  assert.equal(weighty.length, 0, `a label sets its own weight: ${weighty[0]}`);
});

test('the indicator has an opaque fill', () => {
  // Arrange — a translucent pill would leave both labels half-legible mid-slide.
  const chip = code(CHIP);

  // Assert
  assert.match(chip, /backgroundColor:\s*t\.primary/, 'the indicator has no opaque fill');
  assert.doesNotMatch(
    chip,
    /backgroundColor:\s*t\.primary[^,}]*opacity/,
    'the indicator fill carries an opacity',
  );
});

test('the fill is never translucent', () => {
  // Arrange — a translucent fill leaves the selected label half-legible against the
  // rail. There is no slide to fade now, but the fill could still carry an opacity.
  const chip = code(CHIP);

  // Act — the selected cell's fill expression.
  const fill = /isSelected && \{ backgroundColor: t\.primary \}/.exec(chip)?.[0] ?? '';

  // Assert
  assert.ok(fill.length > 0, 'the selected cell has no fill');
  assert.doesNotMatch(fill, /opacity/, 'the fill carries an opacity');
});
